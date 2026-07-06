// Setup verification + provisioning. Every `run` calls this first; `wbdc doctor`
// runs it standalone. Two hard rules from the goal:
//   1. If `claude` is not set up, the CLI exits (nothing else can proceed).
//   2. The CLI can download/set up the deterministic components it needs —
//      node deps, the Playwright Chromium used for screenshots, and the
//      WordPress Playground CLI used by the Stage 2 gate.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function has(bin, args = ['--version']) {
    const r = spawnSync(bin, args, { encoding: 'utf8' });
    return { ok: !r.error && r.status === 0, out: (r.stdout || '').trim(), err: r.error };
}

function run(cmd, args, log) {
    log.info(`$ ${cmd} ${args.join(' ')}`);
    const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });
    return !r.error && r.status === 0;
}

async function chromiumPresent() {
    try {
        const { chromium } = await import('playwright');
        const exe = chromium.executablePath();
        return Boolean(exe) && fs.existsSync(exe);
    } catch {
        return false;
    }
}

// checks -> [{ name, ok, required, detail, fixable }]
export async function runDoctor({ install = true, needPlayground = true, log } = {}) {
    const checks = [];

    // 1) claude — REQUIRED, never auto-installable.
    const claude = has('claude', ['--version']);
    checks.push({ name: 'claude CLI', ok: claude.ok, required: true, detail: claude.ok ? claude.out : 'not found on PATH', fixable: false });

    // 2) node deps.
    const depsOk = fs.existsSync(path.join(ROOT, 'node_modules', '@wordpress', 'blocks'));
    if (!depsOk && install) {
        log?.step('installing node dependencies');
        const done = run('npm', ['install'], log);
        checks.push({ name: 'node_modules', ok: done, required: true, detail: done ? 'installed' : 'npm install failed', fixable: true });
    } else {
        checks.push({ name: 'node_modules', ok: depsOk, required: true, detail: depsOk ? 'present' : 'missing (run with --install)', fixable: true });
    }

    // 3) Playwright Chromium (screenshots/diffs).
    let chromeOk = await chromiumPresent();
    if (!chromeOk && install) {
        log?.step('installing Playwright Chromium');
        run('npx', ['--yes', 'playwright', 'install', 'chromium'], log);
        chromeOk = await chromiumPresent();
    }
    checks.push({ name: 'Playwright Chromium', ok: chromeOk, required: true, detail: chromeOk ? 'present' : 'missing (run with --install)', fixable: true });

    // 4) WordPress Playground CLI (Stage 2 gate) — only required when theming.
    if (needPlayground) {
        let pgOk = fs.existsSync(path.join(ROOT, 'node_modules', '@wp-playground', 'cli'));
        if (!pgOk && install) {
            log?.step('installing @wp-playground/cli');
            run('npm', ['install', '--no-save', '@wp-playground/cli@^3.1.38'], log);
            pgOk = fs.existsSync(path.join(ROOT, 'node_modules', '@wp-playground', 'cli'));
        }
        checks.push({ name: 'WordPress Playground CLI', ok: pgOk, required: false, detail: pgOk ? 'present' : 'missing (Stage 2 only)', fixable: true });
    }

    const requiredFailures = checks.filter((c) => c.required && !c.ok);
    return { ok: requiredFailures.length === 0, checks, requiredFailures };
}

export function reportDoctor(result, log) {
    for (const c of result.checks) {
        const mark = c.ok ? 'ok' : (c.required ? 'error' : 'warn');
        log[mark](`${c.name}: ${c.detail}`);
    }
}
