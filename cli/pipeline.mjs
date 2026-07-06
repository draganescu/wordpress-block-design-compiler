// The pipeline runner — owns the fixed step order the agent used to rediscover
// every run. Setup -> Stage 1 (foundation then parallel pages) -> Stage 0
// (content model + hydration) -> Stage 2 (theme) -> run report. The run is done
// when this function returns; there is no open-ended agent loop left.

import fs from 'node:fs';
import path from 'node:path';
import { McpToolClient } from './tool-client.mjs';
import { getHarness } from './harness/index.mjs';
import { Logger } from './lib/log.mjs';
import { CommandLog } from './lib/command-log.mjs';
import { skillContext, HARNESS_PREAMBLE } from './prompts/skill-context.mjs';
import { writeWs, writeJsonWs } from './steps/helpers.mjs';
import { runStage1Page } from './steps/stage1.mjs';
import { classifyContent, runContentModel, runHydration } from './steps/stage0.mjs';
import { runStage2 } from './steps/stage2.mjs';

// Turn a step id (plan:index, custom_blocks:index, repair:shop-all:2) into a
// readable label so the per-call log lines name the phase.
function label(id = '') {
    return id.replace(/_/g, ' ').replace(/:/g, ' · ');
}

function logHarnessEvent(log, e) {
    const secs = e.elapsedMs ? ` ${(e.elapsedMs / 1000).toFixed(0)}s` : '';
    if (e.type === 'call:start') log.info(`→ ${label(e.id)}${e.attempt > 1 ? ` (retry ${e.attempt})` : ''} … (claude)`);
    else if (e.type === 'call:progress') log.info(`  … ${label(e.id)} still working${secs}`);
    else if (e.type === 'call:ok') {
        const cost = typeof e.meta?.costUsd === 'number' ? ` · $${e.meta.costUsd.toFixed(2)}` : '';
        log.ok(`${label(e.id)} done${secs}${cost}`);
    }
    else if (e.type === 'call:invalid') log.warn(`${label(e.id)} output rejected, retrying`);
    else if (e.type === 'call:error') log.warn(`${label(e.id)} call failed`);
}

const DESIGN_SCHEMA = {
    type: 'object', additionalProperties: false, required: ['html', 'css'],
    properties: { html: { type: 'string' }, css: { type: 'string' }, js: { type: 'string' } },
};

function singlePageEntry() {
    return {
        page: 'index', sourceFile: 'index.html', primary: true, mockupPath: 'mockup/index.html',
        suggested: {
            treePath: 'wordpress/block-tree.json', contentPath: 'wordpress/content.html',
            renderedPath: 'rendered/rendered-blocks.html', editorPath: 'editor/block-editor.html',
            reportPath: 'reports/comparison.json', tasksPath: 'reports/repair-tasks.md',
        },
    };
}

async function designMockup(ctx) {
    ctx.log.step('design · generate mockup from brief');
    const sys = `${HARNESS_PREAMBLE}\n\n${skillContext(['skills/html-to-blocks/references/design-prompt.md'])}`;
    const prompt = [
        'Generate one strong, self-contained HTML/CSS mockup (optional JS) for this brief.',
        'No network assets, no remote fonts except a Google Fonts @import, no build tools. Inspectable and deterministic.',
        `\nBRIEF:\n${ctx.brief}`,
        '\nReturn { html, css, js? }.',
    ].join('\n');
    const res = await ctx.harness.complete({ id: 'design_mockup', systemPrompt: sys, prompt, schema: DESIGN_SCHEMA, model: ctx.options.model });
    if (!res.ok) throw new Error(`design_mockup failed — ${res.error}`);
    writeWs(ctx.workspaceRoot, 'mockup/index.html', res.data.html);
    writeWs(ctx.workspaceRoot, 'mockup/style.css', res.data.css);
    if (res.data.js) writeWs(ctx.workspaceRoot, 'mockup/script.js', res.data.js);
}

async function setup(ctx, sourceHtmlPath) {
    await ctx.client.call('create_workspace', { workspaceRoot: ctx.workspaceRoot, prompt: ctx.brief || 'html-to-blocks run', force: true });
    if (sourceHtmlPath) {
        const imported = await ctx.client.call('import_provided_markup', {
            workspaceRoot: ctx.workspaceRoot,
            sourceHtmlPath: path.resolve(sourceHtmlPath),
        });
        ctx.pages = imported.pages && imported.pages.length ? imported.pages : [singlePageEntry()];
        ctx.log.info(`imported ${ctx.pages.length} page(s): ${ctx.pages.map((p) => p.page).join(', ')}`);
    } else {
        await designMockup(ctx);
        ctx.pages = [singlePageEntry()];
    }
    // Foundation first, remaining after.
    const foundationIdx = Math.max(0, ctx.pages.findIndex((p) => p.primary));
    const foundation = ctx.pages[foundationIdx];
    const rest = ctx.pages.filter((_, i) => i !== foundationIdx);
    return { foundation, rest };
}

// Never let one page's exception (a timeout, a step failure) crash the whole run
// with a stack trace — record it as an errored page and keep going to a report.
async function safePage(ctx, entry, opts) {
    try {
        return await runStage1Page(ctx, entry, opts);
    } catch (err) {
        ctx.log.error(`[${entry.page}] errored: ${err?.message || err}`);
        return { page: entry.page, status: 'errored', passed: false, error: String(err?.message || err) };
    }
}

async function runStage1(ctx, foundation, rest) {
    const results = [];
    const found = await safePage(ctx, foundation, { foundation: true });
    results.push(found);

    // The foundation locks the shared chrome, tokens, and custom blocks. If it
    // never produced a tree, secondary pages have nothing to build on — stop and
    // report rather than fan out N failing sessions.
    if (found.status === 'errored') {
        ctx.log.error('foundation page failed; skipping the remaining pages');
        return results;
    }

    if (rest.length) {
        ctx.log.step(`stage1 · ${rest.length} secondary page(s), up to ${ctx.options.concurrency} in parallel`);
        // Each page is an independent plan->author->repair sequence; the harness
        // semaphore bounds how many claude sessions run at once. This is the
        // "run multiple claude -p sessions" fan-out.
        const settled = await Promise.all(rest.map((entry) => safePage(ctx, entry, { foundation: false })));
        results.push(...settled);
    }
    return results;
}

export async function runPipeline({ workspaceRoot, brief = '', source = null, options, harness: harnessInstance = null }) {
    const log = new Logger({ verbose: options.verbose });
    // Verbatim record of every tool call and every claude -p invocation.
    const commandLog = new CommandLog(options.commandLog === false ? null : path.join(workspaceRoot, 'reports/commands.log'));
    const client = new McpToolClient({
        onLog: (l) => log.debug(l.trimEnd()),
        onCommand: (c) => log.debug(commandLog.tool(c.name, c.args)),
    });
    const harness = harnessInstance || getHarness(options.harness, {
        maxConcurrent: options.concurrency, model: options.model, timeoutMs: options.callTimeoutMs,
        onEvent: (e) => logHarnessEvent(log, e),
        onCommand: (c) => log.info(commandLog.claude(c)),
    });
    await client.start();

    const ctx = {
        client, harness, log, workspaceRoot, brief, options,
        pages: [], shared: { customBlocks: [] },
    };
    const report = { workspaceRoot, startedAt: new Date().toISOString(), stages: {}, harness: options.harness };

    try {
        const { foundation, rest } = await setup(ctx, source);

        if (options.stages.has(1)) {
            report.stages.stage1 = await runStage1(ctx, foundation, rest);
        }

        if (options.stages.has(0)) {
            try {
                const needed = await classifyContent(ctx);
                if (needed) {
                    const model = await runContentModel(ctx);
                    report.stages.stage0 = { needed: true, model };
                    if (options.stages.has(1)) report.stages.stage0.hydration = await runHydration(ctx);
                } else {
                    report.stages.stage0 = { needed: false };
                }
            } catch (err) {
                log.error(`stage 0 (content modeling) failed: ${err.message}`);
                report.stages.stage0 = { error: String(err.message || err) };
            }
        }

        if (options.stages.has(2)) {
            try {
                report.stages.stage2 = await runStage2(ctx);
            } catch (err) {
                log.error(`stage 2 (theme) failed: ${err.message}`);
                report.stages.stage2 = { error: String(err.message || err) };
            }
        }

        report.harnessCostUsd = harness.costUsd;
        report.harnessCalls = harness.calls;
        report.finishedAt = new Date().toISOString();
        report.outcome = summarize(report);
        writeJsonWs(workspaceRoot, 'reports/run-report.json', report);
        return report;
    } finally {
        await client.close();
    }
}

function summarize(report) {
    const pages = report.stages.stage1 || [];
    const blocked = pages.filter((p) => !p.passed);
    const gate = report.stages.stage2?.gate;
    const themeOk = !report.stages.stage2 || (report.stages.stage2.validation?.passed && (!gate || gate.status === 'passed'));
    return {
        pagesTotal: pages.length,
        pagesPassed: pages.length - blocked.length,
        pagesBlocked: blocked.map((p) => ({ page: p.page, status: p.status, metric: p.metric })),
        themeValidated: report.stages.stage2?.validation?.passed ?? null,
        themeGate: gate?.status ?? null,
        complete: true,
        allPassed: blocked.length === 0 && themeOk,
    };
}

export default runPipeline;
