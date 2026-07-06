// `wbdc serve` — boot the built block theme + generated content in WordPress
// Playground and LEAVE IT RUNNING so you can open it in a browser. This reuses
// the same blueprint the Stage 2 gate uses (activate the CPT/blocks/content
// plugins, import the pages), but serves interactively instead of screenshotting
// and exiting.

import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildBlueprint, resolveContentModelPlugin } from '../tools/theme/playground.mjs';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WP_VERSION = '6.8';

function detectSlug(workspaceRoot) {
    const themeRoot = path.join(workspaceRoot, 'theme');
    if (!fs.existsSync(themeRoot)) return null;
    const dirs = fs.readdirSync(themeRoot, { withFileTypes: true })
        .filter((e) => e.isDirectory() && fs.existsSync(path.join(themeRoot, e.name, 'theme.json')))
        .map((e) => e.name);
    return dirs[0] || null;
}

function freePort(preferred) {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.once('error', () => {
            // Preferred port busy — let the OS pick any free one.
            const any = net.createServer();
            any.once('error', reject);
            any.listen(0, '127.0.0.1', () => { const p = any.address().port; any.close(() => resolve(p)); });
        });
        srv.listen(preferred, '127.0.0.1', () => { srv.close(() => resolve(preferred)); });
    });
}

// Boots Playground and resolves once it is serving. Keeps the process alive; the
// caller stops it (Ctrl-C / SIGTERM).
export async function runServe({ workspaceRoot, slug, port = 9400, log }) {
    workspaceRoot = path.resolve(workspaceRoot);
    // Distinguish "wrong path" from "Stage 2 hasn't run" — they look the same
    // otherwise and cost a confusing debugging detour.
    if (!fs.existsSync(workspaceRoot)) {
        throw new Error(`Workspace not found: ${workspaceRoot} (check the --workspace path).`);
    }
    const themeRoot = path.join(workspaceRoot, 'theme');
    if (!fs.existsSync(themeRoot)) {
        throw new Error(`No theme/ directory in ${workspaceRoot}. Either the path is wrong or Stage 2 has not produced a theme yet.`);
    }
    slug = slug || detectSlug(workspaceRoot);
    if (!slug) throw new Error(`theme/ exists in ${workspaceRoot} but no subfolder has a theme.json — Stage 2 did not finish scaffolding. Re-run with --stages 2.`);

    const themeDir = path.join(workspaceRoot, 'theme', slug);
    if (!fs.existsSync(path.join(themeDir, 'theme.json'))) throw new Error(`theme/${slug}/theme.json not found in ${workspaceRoot}.`);

    const blocksDir = path.join(workspaceRoot, 'theme-plugin', `${slug}-blocks`);
    const contentDir = path.join(workspaceRoot, 'theme-plugin', `${slug}-content`);
    const contentModel = resolveContentModelPlugin(workspaceRoot);
    const hasBlocksPlugin = fs.existsSync(blocksDir);
    const hasContent = fs.existsSync(contentDir);

    const outDir = path.join(workspaceRoot, 'reports/playground');
    fs.mkdirSync(outDir, { recursive: true });
    const blueprintPath = path.join(outDir, 'serve-blueprint.json');
    fs.writeFileSync(blueprintPath, JSON.stringify(buildBlueprint({ slug, hasBlocksPlugin, contentModel }), null, 2));

    const usePort = await freePort(port);
    const pluginDirs = [blocksDir, contentDir, contentModel && contentModel.dir].filter((d) => d && fs.existsSync(d));
    const args = [
        '@wp-playground/cli', 'server',
        `--port=${usePort}`,
        `--wp=${WP_VERSION}`,
        `--blueprint=${blueprintPath}`,
        `--mount=${themeDir}:/wordpress/wp-content/themes/${slug}`,
        ...pluginDirs.map((dir) => `--mount=${dir}:/wordpress/wp-content/plugins/${path.basename(dir)}`),
    ];

    log?.step(`serve · booting WordPress ${WP_VERSION} (theme "${slug}"${hasContent ? ', importing pages' : ''})`);
    log?.info('first boot downloads WordPress — this can take a minute');

    const base = `http://127.0.0.1:${usePort}`;
    const proc = spawn('npx', args, { cwd: PLUGIN_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let logs = '';
    const onData = (d) => {
        logs += d;
        // The CLI prints the server URL when ready; surface boot lines verbatim.
        process.stderr.write(d);
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);

    await waitForServer(base, proc);
    log?.ok(`WordPress is serving at ${base}`);
    log?.info(`open ${base}/ in your browser · Ctrl-C to stop`);

    // Keep the process alive until the child exits or we're signalled.
    const stop = () => { try { proc.kill('SIGTERM'); } catch { /* gone */ } };
    process.on('SIGINT', () => { stop(); process.exit(0); });
    process.on('SIGTERM', () => { stop(); process.exit(0); });
    return { proc, url: base, port: usePort };
}

async function waitForServer(base, proc, timeoutMs = 180000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (proc.exitCode !== null) throw new Error(`Playground exited during boot (code ${proc.exitCode}).`);
        try {
            const res = await fetch(`${base}/`, { redirect: 'manual' });
            if (res.status && res.status < 500) return;
        } catch { /* not up yet */ }
        await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`Playground did not become ready within ${timeoutMs / 1000}s.`);
}

export default runServe;
