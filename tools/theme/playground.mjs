// tools/theme/playground.mjs
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { resolvePath, readJson, writeJson } from '../lib/workspace.mjs';
import { loadCaptureDeps, serveDirectory, captureUrl, comparePngs, DEFAULT_VIEWPORTS, launchBrowser } from '../lib/capture.mjs';
import { PLUGIN_ROOT } from '../lib/workspace.mjs';
import { writeGateMuPlugin } from './generate/gate-muplugin.mjs';
import { makeKey, getOrBoot, stop, setHashes } from './playground-server.mjs';
import { hashInputs, classifyChange } from './playground-changes.mjs';
import { validateStoredContent } from './editor-validate.mjs';
import * as profile from '../lib/profile.mjs';

// Above this many ms, the server-ready wait almost certainly included a cold
// WordPress build download (first run); below it the Playground CLI hit its
// cache. Used to infer and tag the run's cold/warm state for the profiler.
const COLD_SERVER_WAIT_MS = 20000;

// Pin the WordPress version so a warm-then-reboot cycle (and reruns weeks apart)
// boots byte-identical core, keeping the visual gate's diffs attributable to the
// theme rather than a silently bumped "latest". The CLI cleanly supports --wp
// (server --help: --wp [default: "latest"]), so pinning never risks the boot.
const WP_VERSION = '6.8';

export function buildBlueprint({ slug, hasBlocksPlugin, contentModel }) {
    const prefix = slug.replace(/-/g, '_') + '_content';
    return {
        landingPage: '/',
        steps: [
            // The content-model plugin registers the CPTs/taxonomies the hydrated
            // query loops iterate, and seeds them so those loops render real
            // entries — without it a hydrated archive/grid renders empty.
            ...(contentModel ? [{ step: 'activatePlugin', pluginPath: `${contentModel.slug}/${contentModel.slug}.php` }] : []),
            ...(hasBlocksPlugin ? [{ step: 'activatePlugin', pluginPath: `${slug}-blocks/${slug}-blocks.php` }] : []),
            { step: 'activatePlugin', pluginPath: `${slug}-content/${slug}-content.php` },
            { step: 'activateTheme', themeFolderName: slug },
            // wp_set_current_user(1): without unfiltered_html, kses strips the
            // form/select/input markup from imported page content — a real
            // admin clicking the Import button has that capability
            ...(contentModel ? [{ step: 'runPHP', code: `<?php require '/wordpress/wp-load.php'; wp_set_current_user(1); ${contentModel.prefix}_import_seed_content();` }] : []),
            { step: 'runPHP', code: `<?php require '/wordpress/wp-load.php'; wp_set_current_user(1); var_export(${prefix}_import_pages());` },
        ],
    };
}

export function buildCliArgs({ slug, themeDir, pluginDirs, blueprintPath, port, gateFile }) {
    return [
        'server',
        `--port=${port}`,
        `--wp=${WP_VERSION}`,
        `--blueprint=${blueprintPath}`,
        `--mount=${themeDir}:/wordpress/wp-content/themes/${slug}`,
        ...pluginDirs.map((dir) => `--mount=${dir}:/wordpress/wp-content/plugins/${path.basename(dir)}`),
        // The gate mu-plugin is mounted, never shipped in the theme; it exposes
        // the localhost dump/flush/reimport endpoints the Node gate calls.
        `--mount=${gateFile}:/wordpress/wp-content/mu-plugins/wbdc-gate.php`,
    ];
}

export function pageUrl(base, page) {
    return page.front ? `${base}/` : `${base}/?pagename=${page.slug}`;
}

// Detect a content-model plugin produced by the content-modeling skill so its
// CPTs/taxonomies/seeds are available to hydrated query loops. Returns the
// mount dir, plugin slug, and PHP function prefix, or null when absent.
export function resolveContentModelPlugin(workspaceRoot) {
    const manifestPath = path.join(workspaceRoot, 'content-model/plugin-manifest.json');
    if (!fs.existsSync(manifestPath)) return null;
    const manifest = readJson(manifestPath);
    const dir = path.join(workspaceRoot, manifest.pluginRoot);
    if (!fs.existsSync(dir)) return null;
    const pluginSlug = manifest.plugin.slug;
    return { dir, slug: pluginSlug, prefix: pluginSlug.replace(/-/g, '_') };
}

export async function playgroundRender(args) {
    const workspaceRoot = resolvePath(args.workspaceRoot);
    const slug = args.slug;
    const themeDir = path.join(workspaceRoot, 'theme', slug);
    const blocksDir = path.join(workspaceRoot, 'theme-plugin', `${slug}-blocks`);
    const contentDir = path.join(workspaceRoot, 'theme-plugin', `${slug}-content`);
    const manifest = readJson(path.join(contentDir, 'content/manifest.json'));
    const hasBlocksPlugin = fs.existsSync(blocksDir);
    const contentModel = resolveContentModelPlugin(workspaceRoot);
    const contentPrefix = slug.replace(/-/g, '_') + '_content';
    const outDir = path.join(workspaceRoot, 'reports/playground');
    fs.mkdirSync(outDir, { recursive: true });

    const blueprintPath = path.join(outDir, 'blueprint.json');
    writeJson(blueprintPath, buildBlueprint({ slug, hasBlocksPlugin, contentModel }));
    profile.setRunMeta({ tool: 'playground_render', slug });

    // Boot the warm-registry's WordPress: generate a fresh gate token, write the
    // gate mu-plugin, spawn the CLI with it mounted, then wait for server+import.
    // Returns the registry entry shape; the registry owns the proc lifetime.
    const bootFn = async () => {
        const gateToken = randomUUID();
        const gateFile = path.join(outDir, 'wbdc-gate.php');
        writeGateMuPlugin(gateFile, { token: gateToken, contentPrefix, contentModelPrefix: contentModel?.prefix });
        // A free port per boot, never a shared default: two warm servers from
        // different workspaces on a fixed 9400 would answer each other's health
        // probe and cross-contaminate. A reboot also gets a fresh port, so it
        // never races the old server still releasing the previous one.
        const port = args.port || await getFreePort();
        // detached:true makes the child a process-group leader so the registry
        // can kill the real @wp-playground/cli process, not just the npx wrapper.
        const proc = profile.span('playground.cli.spawn', () => spawn('npx', ['@wp-playground/cli', ...buildCliArgs({
            slug, themeDir, blueprintPath, port, gateFile,
            pluginDirs: [blocksDir, contentDir, contentModel && contentModel.dir].filter((d) => d && fs.existsSync(d)),
        })], { cwd: PLUGIN_ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: true }));
        let logs = '';
        proc.stdout.on('data', (d) => { logs += d; });
        proc.stderr.on('data', (d) => { logs += d; });
        proc.__logs = () => logs;
        const base = `http://127.0.0.1:${port}`;
        await bootWait({ proc, base, manifest });
        return { proc, port, base, gateToken, hashes: hashInputs(workspaceRoot, slug) };
    };

    const key = makeKey(workspaceRoot, slug);
    let acquired = await getOrBoot(key, bootFn);
    // Pillar 3: hash the inputs and decide the cheapest re-check. A structural
    // (plugin code) or first-seen change can only be trusted after a cold boot;
    // a content edit reimports; a theme edit just flushes the style caches; an
    // unchanged workspace needs nothing. Cold boot only when we reused a warm one.
    const next = hashInputs(workspaceRoot, slug);
    const kind = classifyChange(acquired.entry.hashes, next);
    try {
        if (acquired.reused && (kind === 'structural' || kind === 'first')) {
            await stop(key);
            acquired = await getOrBoot(key, bootFn);
        } else if (kind === 'content') {
            await gateFetch(acquired.entry.base + '/?wbdc_gate=reimport&token=' + acquired.entry.gateToken);
        } else if (kind === 'theme-only') {
            await gateFetch(acquired.entry.base + '/?wbdc_gate=flush&token=' + acquired.entry.gateToken);
        }
        setHashes(key, next);
    } catch (error) {
        await stop(key);
        throw new Error(`playground_render failed: ${error.message}\n--- playground logs (tail) ---\n${acquired.entry.proc.__logs?.().slice(-2000) ?? ''}`);
    }

    const entry = acquired.entry;
    const base = entry.base;
    try {
        const { chromium, PNG, pixelmatch } = await loadCaptureDeps(PLUGIN_ROOT);
        const thresholds = { maxMismatchPercent: args.maxMismatchPercent ?? 1, maxHeightDelta: args.maxHeightDelta ?? 8 };
        const pagesReport = [];
        // Acquire browser + static server inside the try so the finally closes
        // the browser even if serveDirectory throws after launch. The Playground
        // proc is owned by the registry and is NOT killed here.
        let browser;
        let server;
        try {
            browser = await launchBrowser(chromium, { headless: true }, { tool: 'playground_render' });
            server = await serveDirectory(workspaceRoot); // mockup screenshots through the same pipeline
            for (const page of manifest.pages) {
                const mockupPath = page.mockupPath || inferMockupPath(workspaceRoot, page);
                const results = [];
                for (const viewport of args.viewports || DEFAULT_VIEWPORTS) {
                    const mockShot = path.join(outDir, `${page.slug}-mockup-${viewport.name}.png`);
                    const wpShot = path.join(outDir, `${page.slug}-wp-${viewport.name}.png`);
                    const diffShot = path.join(outDir, `${page.slug}-diff-${viewport.name}.png`);
                    const capMeta = { page: page.slug, viewport: viewport.name };
                    await profile.span('playground.capture.mockup', () => captureUrl(browser, server.urlFor(path.join(workspaceRoot, mockupPath)), mockShot, viewport), capMeta);
                    await profile.span('playground.capture.wp', () => captureUrl(browser, pageUrl(base, page), wpShot, viewport), capMeta);
                    results.push(profile.span('playground.compare', () => comparePngs({ target: 'wordpress', mockupShot: mockShot, candidateShot: wpShot, diffShot, viewport, PNG, pixelmatch }), capMeta));
                }
                const aggregate = {
                    maxMismatchPercent: Math.max(...results.map((r) => r.mismatchPercent)),
                    maxHeightDelta: Math.max(...results.map((r) => r.heightDelta)),
                };
                pagesReport.push({ page: page.slug, mockupPath, results, aggregate,
                    passed: aggregate.maxMismatchPercent <= thresholds.maxMismatchPercent && aggregate.maxHeightDelta <= thresholds.maxHeightDelta });
            }
        } finally {
            await browser?.close();
            await server?.close?.();
        }
        // Headless editor validation: read each page's stored post_content back
        // from the warm WordPress via the gate dump endpoint and run the same
        // @wordpress/blocks parse() the editor runs, in Node. A block whose
        // isValid===false is a validation failure — no per-page editor boot.
        const validation = await profile.span('playground.editorValidation',
            () => validateStoredContent({ base, gateToken: entry.gateToken, workspaceRoot, slug }),
            { pages: manifest.pages.length });
        for (const entryReport of pagesReport) {
            // A page absent from the dump never got validated — it may have
            // failed to import (slug collision / error) or WordPress sanitized
            // its post_name away from the manifest slug. Treat that as a hard
            // failure rather than a clean zero, so the gate can never green a
            // page it never actually saw.
            entryReport.editorValidation = validation.get(entryReport.page)
                ?? { failures: 1, samples: [`page "${entryReport.page}" not found in stored content dump (import may have failed)`] };
            if ((entryReport.editorValidation.failures ?? 0) > 0) entryReport.passed = false;
        }
        const report = {
            generatedAt: new Date().toISOString(), thresholds, pages: pagesReport,
            aggregates: {
                maxMismatchPercent: Math.max(...pagesReport.map((p) => p.aggregate.maxMismatchPercent)),
                maxHeightDelta: Math.max(...pagesReport.map((p) => p.aggregate.maxHeightDelta)),
            },
            passed: pagesReport.every((p) => p.passed && (p.editorValidation?.failures ?? 0) === 0),
        };
        writeJson(path.join(workspaceRoot, 'reports/theme-comparison.json'), report);
        return report;
    } catch (error) {
        // A hard error may mean the server is wedged; stop it so a broken boot
        // does not persist in the registry. The registry, not this finally,
        // owns the proc lifetime on the happy path.
        await stop(key);
        throw new Error(`playground_render failed: ${error.message}\n--- playground logs (tail) ---\n${entry.proc.__logs?.().slice(-2000) ?? ''}`);
    }
}

// Wait for the spawned server, then for the content import to finish. Split out
// of playgroundRender so bootFn (and a reboot) reuse the exact same readiness +
// cold-detection logic the original inline path used.
async function bootWait({ proc, base, manifest }) {
    // The server-ready wait subsumes the cold WordPress build download on a
    // first run; timing it (and whether it crossed the cold threshold or the
    // CLI logged a download) is how we infer and tag cold vs warm.
    const serverWaitTok = profile.mark('playground.wait.server');
    const serverWaitStart = performance.now();
    await waitForServer(base, 120000, () => proc.exitCode);
    const serverWaitMs = performance.now() - serverWaitStart;
    const cold = serverWaitMs > COLD_SERVER_WAIT_MS || /\b(download|fetch)ing wordpress/i.test(proc.__logs?.() ?? '');
    profile.measure(serverWaitTok, { cold, waitMs: serverWaitMs });
    profile.setRunMeta({ cold });
    // the server answers before the blueprint's runPHP import step finishes;
    // capturing early races the import (front page = blog index). The last
    // manifest page resolving proves the import ran to completion.
    const lastPage = manifest.pages[manifest.pages.length - 1];
    if (lastPage) {
        const importTok = profile.mark('playground.wait.import');
        await waitForImport(pageUrl(base, { ...lastPage, front: false }), 120000, () => proc.exitCode);
        profile.measure(importTok, { cold });
    }
}

// Ask the OS for an unused loopback port. A tiny TOCTOU window exists between
// close and the CLI binding it, acceptable for a local single-user gate and far
// safer than a fixed port shared across workspaces.
function getFreePort() {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.once('error', reject);
        srv.listen(0, '127.0.0.1', () => {
            const { port } = srv.address();
            srv.close(() => resolve(port));
        });
    });
}

// Fetch a gate endpoint (reimport/flush) and surface a non-2xx as an error so a
// silently-failing re-check never reads as a clean incremental update.
async function gateFetch(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`gate request ${url} returned ${res.status} ${res.statusText}`);
    return res.json().catch(() => ({}));
}

async function waitForServer(base, timeoutMs, exited) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (exited() !== null) throw new Error('playground process exited before becoming ready');
        try {
            const res = await fetch(base, { redirect: 'manual' });
            if (res.status < 500) return;
        } catch { /* not up yet */ }
        await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`playground server not ready after ${timeoutMs}ms`);
}

async function waitForImport(url, timeoutMs, exited) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (exited() !== null) throw new Error('playground process exited during content import');
        try {
            const res = await fetch(url, { redirect: 'manual' });
            if (res.status === 200) return;
        } catch { /* still importing */ }
        await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`content import did not complete within ${timeoutMs}ms (${url} never returned 200)`);
}

function inferMockupPath(workspaceRoot, page) {
    for (const candidate of [`mockup/${page.sourceFile || ''}`, `mockup/${page.page || page.slug}.html`, 'mockup/index.html']) {
        if (candidate !== 'mockup/' && fs.existsSync(path.join(workspaceRoot, candidate))) return candidate;
    }
    throw new Error(`No mockup found for page ${page.slug}; pass mockupPath in the manifest page entry.`);
}
