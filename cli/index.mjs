#!/usr/bin/env node
// wbdc — the deterministic runner for the html-to-blocks workflow.
//
//   wbdc run --source <html-export> --workspace <dir> [options]
//   wbdc run --brief "<text|@file>" --workspace <dir> [options]
//   wbdc doctor
//
// The CLI owns the step order; `claude -p` is called only for the judgment steps,
// each as one structured-output turn. See docs/superpowers/specs/*-workflow-cli-*.

import fs from 'node:fs';
import path from 'node:path';
import { Logger } from './lib/log.mjs';
import { runDoctor, reportDoctor } from './doctor.mjs';
import { runPipeline } from './pipeline.mjs';
import { runServe } from './serve.mjs';

function parseArgs(argv) {
    const out = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith('--no-')) { out[a.slice(5)] = false; continue; }
        if (a.startsWith('--')) {
            const key = a.slice(2);
            const next = argv[i + 1];
            if (next === undefined || next.startsWith('--')) { out[key] = true; }
            else { out[key] = next; i++; }
            continue;
        }
        out._.push(a);
    }
    return out;
}

function readBrief(value) {
    if (!value || value === true) return '';
    if (value.startsWith('@')) return fs.readFileSync(value.slice(1), 'utf8');
    return value;
}

function resolveSource(source) {
    if (!source || source === true) return null;
    const abs = path.resolve(source);
    if (!fs.existsSync(abs)) throw new Error(`--source not found: ${abs}`);
    if (fs.statSync(abs).isDirectory()) {
        const index = path.join(abs, 'index.html');
        if (!fs.existsSync(index)) throw new Error(`--source directory has no index.html: ${abs}`);
        return index;
    }
    return abs;
}

function parseStages(value) {
    if (value === undefined) return new Set([0, 1, 2]);
    return new Set(String(value).split(/[, ]+/).filter(Boolean).map(Number).filter((n) => [0, 1, 2].includes(n)));
}

function buildOptions(args) {
    const stages = parseStages(args.stages);
    const brochure = Boolean(args.brochure);
    return {
        harness: args.harness || 'claude',
        model: args.model || undefined,
        concurrency: Math.max(1, Number(args.concurrency || 3)),
        maxRepair: Math.max(1, Number(args['max-repair'] || 6)),
        callTimeoutMs: Math.max(30, Number(args['call-timeout'] || 600)) * 1000,
        thresholds: { mismatch: Number(args['threshold-mismatch'] || 1), height: Number(args['threshold-height'] || 8) },
        stages,
        // Brochure mode: a minimal N-page static site from a brief — no content
        // model, no custom blocks. Applies to brief starts only (see run below).
        brochure,
        pages: Math.max(1, Number(args.pages || 5)),
        noCustomBlocks: brochure || Boolean(args['no-custom-blocks']),
        stage0: brochure ? 'off' : (args.stage0 || 'auto'),
        playground: args.playground !== false && stages.has(2),
        compareEditor: args.editor !== false,
        commandLog: args['command-log'] !== false,
        verbose: Boolean(args.verbose),
        install: args.install !== false,
    };
}

const USAGE = `wbdc — deterministic html-to-blocks workflow runner

Usage:
  wbdc run --workspace <dir> (--source <html-export> | --brief <text|@file>) [options]
  wbdc serve --workspace <dir> [--slug <slug>] [--port <n>]   # boot the built theme in WordPress
  wbdc doctor [--no-install] [--no-playground]

Options:
  --source <path>            HTML export file or directory (multi-page supported)
  --brief <text|@file>       Design brief (generates a mockup when no --source)
  --brochure                 Brief only: minimal N-page brochure site — no content
                             model, no custom blocks (see --pages). Ignored with --source.
  --pages <n>                Brochure page count (default: 5)
  --no-custom-blocks         Core blocks only (implied by --brochure)
  --workspace <dir>          Run workspace directory (required for run)
  --stages 0,1,2             Which stages to run (default: 0,1,2)
  --stage0 auto|on|off       Content-modeling gate (default: auto)
  --harness claude|mock      Judgment backend (default: claude)
  --model <id>               Model override for judgment calls
  --concurrency <n>          Max parallel claude sessions (default: 3)
  --max-repair <n>           Repair/gate loop cap per page/theme (default: 6)
  --call-timeout <seconds>   Per claude -p call timeout (default: 600)
  --threshold-mismatch <n>   Pixel mismatch % threshold (default: 1)
  --threshold-height <n>     Height delta px threshold (default: 8)
  --no-editor                Skip the editor-surface comparison (offline/faster)
  --no-playground            Skip the Stage 2 Playground gate
  --no-command-log           Don't write reports/commands.log (verbatim commands)
  --no-install               Doctor checks only, no auto-install
  --verbose                  Per-call debug logging
`;

async function main() {
    const argv = process.argv.slice(2);
    const args = parseArgs(argv);
    const command = args._[0];
    const log = new Logger({ verbose: Boolean(args.verbose) });

    if (!command || args.help || command === 'help') {
        process.stdout.write(USAGE);
        process.exit(command ? 0 : 1);
    }

    if (command === 'serve') {
        const workspace = args.workspace && args.workspace !== true ? path.resolve(args.workspace) : (args._[1] ? path.resolve(args._[1]) : null);
        if (!workspace) { log.error('usage: wbdc serve --workspace <dir> [--slug <slug>] [--port <n>]'); process.exit(1); }
        await runServe({
            workspaceRoot: workspace,
            slug: args.slug && args.slug !== true ? args.slug : undefined,
            port: Number(args.port || 9400),
            log,
        });
        // runServe keeps the Playground process alive; hold the event loop open.
        await new Promise(() => {});
        return;
    }

    if (command === 'doctor') {
        const result = await runDoctor({ install: args.install !== false, needPlayground: args.playground !== false, log });
        reportDoctor(result, log);
        if (!result.ok) { log.error('setup incomplete'); process.exit(1); }
        log.ok('setup ready');
        process.exit(0);
    }

    if (command !== 'run') { log.error(`unknown command: ${command}`); process.stdout.write(USAGE); process.exit(1); }

    const options = buildOptions(args);
    const workspace = args.workspace && args.workspace !== true ? path.resolve(args.workspace) : null;
    if (!workspace) { log.error('--workspace is required'); process.exit(1); }
    const source = resolveSource(args.source);
    const brief = readBrief(args.brief);
    if (!source && !brief) { log.error('provide --source or --brief'); process.exit(1); }
    // Brochure mode is a prompt-only shortcut; an import must respect the real site.
    if (options.brochure && source) { log.warn('--brochure ignored for --source imports (imports respect the provided site)'); options.brochure = false; options.noCustomBlocks = false; }

    // Setup gate: claude absent => exit. Playground only needed for Stage 2.
    log.step('doctor · verifying setup');
    const doctor = await runDoctor({ install: options.install, needPlayground: options.playground, log });
    reportDoctor(doctor, log);
    if (!doctor.ok) {
        const missingClaude = doctor.requiredFailures.some((c) => c.name === 'claude CLI');
        if (missingClaude) log.error('claude CLI is required. Install it and run `claude login`, then retry.');
        process.exit(1);
    }

    log.step(`run · workspace ${workspace}`);
    const report = await runPipeline({ workspaceRoot: workspace, brief, source, options });

    const o = report.outcome;
    log.step('done');
    log.info(`pages: ${o.pagesPassed}/${o.pagesTotal} passed` + (o.pagesBlocked.length ? `; blocked: ${o.pagesBlocked.map((p) => p.page).join(', ')}` : ''));
    if (report.stages.stage2) log.info(`theme: validated=${o.themeValidated} gate=${o.themeGate ?? 'skipped'} (${report.stages.stage2.slug})`);
    log.info(`claude calls: ${report.harnessCalls} · est. cost: $${(report.harnessCostUsd || 0).toFixed(2)}`);
    log.info(`run report: ${path.join(workspace, 'reports/run-report.json')}`);
    if (options.commandLog) log.info(`commands log: ${path.join(workspace, 'reports/commands.log')} (verbatim)`);

    process.exit(o.allPassed ? 0 : 3);
}

main().catch((err) => {
    process.stderr.write(`\x1b[31mfatal:\x1b[0m ${err?.stack || err}\n`);
    process.exit(1);
});
