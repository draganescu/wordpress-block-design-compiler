// Stage 1 — html-to-blocks, per page. Fixed sequence:
//   analyze_mockup (tool) -> plan (judgment) -> custom blocks (scaffold tool +
//   judgment source) -> author tree (judgment) -> bounded repair loop
//   (build_page tool + judgment fix).
//
// Each judgment step is one `claude -p` call returning structured data the CLI
// then writes; the model never drives, never wanders.

import path from 'node:path';
import { skillContext, HARNESS_PREAMBLE, SERIALIZER_CONSTRAINTS } from '../prompts/skill-context.mjs';
import { runBoundedLoop } from '../loops.mjs';
import {
    readWs, readJsonWs, writeWs, writeJsonWs, clip, planToMarkdown, normalizeTree,
} from './helpers.mjs';

const PLAN_SCHEMA = {
    type: 'object', additionalProperties: false, required: ['sections'],
    properties: {
        sections: {
            type: 'array',
            items: {
                type: 'object', additionalProperties: false, required: ['name', 'strategy'],
                properties: {
                    name: { type: 'string' },
                    mockupSelector: { type: 'string' },
                    strategy: { type: 'string', enum: ['core', 'custom', 'standin'] },
                    coreBlocks: { type: 'array', items: { type: 'string' } },
                    reason: { type: 'string' },
                    styling: { type: 'string' },
                },
            },
        },
        customBlocks: {
            type: 'array',
            items: {
                type: 'object', additionalProperties: false, required: ['name'],
                properties: {
                    name: { type: 'string' },
                    title: { type: 'string' },
                    form: { type: 'boolean' },
                    reason: { type: 'string' },
                    attributes: {
                        type: 'array',
                        items: {
                            type: 'object', additionalProperties: true, required: ['name', 'type'],
                            properties: { name: { type: 'string' }, type: { type: 'string' }, role: { type: 'string' } },
                        },
                    },
                },
            },
        },
        notes: { type: 'string' },
    },
};

// One block's finalized source. Authored one call per block (see customBlocksStep).
const ONE_BLOCK_SCHEMA = {
    type: 'object', additionalProperties: false, required: ['indexJs', 'styleCss'],
    properties: { indexJs: { type: 'string' }, styleCss: { type: 'string' } },
};

const AUTHOR_SCHEMA = {
    type: 'object', additionalProperties: false, required: ['blockTree'],
    properties: {
        blockTree: { type: 'object' },
        pageCss: { type: 'string' },
        previewContext: { type: 'object' },
    },
};

const REPAIR_SCHEMA = {
    type: 'object', additionalProperties: false, required: ['blockTree'],
    properties: {
        blockTree: { type: 'object' },
        pageCss: { type: 'string' },
        note: { type: 'string' },
    },
};

const PLAN_SYS = () => `${HARNESS_PREAMBLE}\n\n${skillContext([
    'skills/html-to-blocks/SKILL.md',
    'skills/html-to-blocks/references/core-block-selection.md',
    'skills/html-to-blocks/references/block-planning.md',
])}`;

const AUTHOR_SYS = () => `${HARNESS_PREAMBLE}\n\n${SERIALIZER_CONSTRAINTS}\n\n${skillContext([
    'skills/html-to-blocks/SKILL.md',
    'skills/html-to-blocks/references/custom-block-standards.md',
])}`;

const REPAIR_SYS = () => `${HARNESS_PREAMBLE}\n\n${SERIALIZER_CONSTRAINTS}\n\n${skillContext([
    'skills/html-to-blocks/references/repair-loop.md',
    'skills/html-to-blocks/references/css-transfer-gotchas.md',
])}`;

// ---- individual steps -------------------------------------------------------

async function planStep(ctx, entry, isFoundation) {
    const { page } = entry;
    const mockupHtml = clip(readWs(ctx.workspaceRoot, entry.mockupPath));
    const mockupCss = clip(readWs(ctx.workspaceRoot, 'mockup/style.css'), 80000);
    const inventory = readJsonWs(ctx.workspaceRoot, `analysis/${page}.content-inventory.json`)
        || readJsonWs(ctx.workspaceRoot, 'analysis/content-inventory.json');
    const analysis = readJsonWs(ctx.workspaceRoot, `analysis/${page}.analysis.json`)
        || readJsonWs(ctx.workspaceRoot, 'analysis/analysis.json');

    const noCustom = ctx.options.noCustomBlocks;
    const sharedBlocks = ctx.shared.customBlocks.length
        ? `\nSHARED CUSTOM BLOCKS already defined by the foundation page (reuse them, do not redefine): ${JSON.stringify(ctx.shared.customBlocks)}`
        : '';

    const customLine = noCustom
        ? 'CORE BLOCKS ONLY: do NOT propose any custom blocks. customBlocks MUST be []. Express everything with core blocks + supports + CSS.'
        : (isFoundation
            ? 'This is the FOUNDATION page: plan the shared custom blocks the whole site will reuse. List them in customBlocks.'
            : 'This is a secondary page. Reuse the shared custom blocks; only add a new one if this page genuinely needs it.');

    const prompt = [
        `Produce the block plan for page "${page}".`,
        customLine,
        `\nBRIEF:\n${ctx.brief}`,
        `\nSECTION ANALYSIS:\n${JSON.stringify(analysis?.sections || [], null, 0)}`,
        `\nCONTENT INVENTORY (forms/links counts):\n${JSON.stringify({ forms: inventory?.forms?.length, links: inventory?.links?.length }, null, 0)}`,
        sharedBlocks,
        `\nMOCKUP HTML:\n${mockupHtml}`,
        `\nMOCKUP CSS:\n${mockupCss}`,
        '\nReturn the plan JSON.',
    ].join('\n');

    const res = await ctx.harness.complete({ id: `plan:${page}`, systemPrompt: PLAN_SYS(), prompt, schema: PLAN_SCHEMA, model: ctx.options.model });
    if (!res.ok) throw new Error(`plan:${page} failed — ${res.error}`);
    const plan = res.data;
    // Enforce the no-custom-blocks mode even if the model still proposed some.
    if (noCustom) plan.customBlocks = [];
    writeJsonWs(ctx.workspaceRoot, 'plan/block-plan.json', plan);
    writeWs(ctx.workspaceRoot, `plan/${page}.block-plan.md`, planToMarkdown(plan, page));
    return plan;
}

async function customBlocksStep(ctx, entry, plan) {
    const blocks = plan.customBlocks || [];
    if (!blocks.length) return [];
    const { page } = entry;

    // Deterministic baseline first: scaffold_custom_block writes a correct
    // block.json + vanilla-JS baseline from the planned attributes. The judgment
    // step then only rewrites index.js/style.css to match the mockup.
    const baselines = [];
    for (const b of blocks) {
        const slug = b.name.split('/')[1];
        // Already scaffolded by an earlier page? Skip re-scaffolding shared blocks.
        if (ctx.shared.customBlocks.some((c) => c.name === b.name)) continue;
        await ctx.client.call('scaffold_custom_block', {
            workspaceRoot: ctx.workspaceRoot,
            name: b.name,
            title: b.title || undefined,
            form: Boolean(b.form),
            attributes: (b.attributes || []).map((a) => ({ name: a.name, type: a.type, role: a.role })),
        });
        baselines.push({
            slug,
            name: b.name,
            reason: b.reason,
            blockJson: readWs(ctx.workspaceRoot, `wordpress/blocks/${slug}/block.json`),
            indexJs: readWs(ctx.workspaceRoot, `wordpress/blocks/${slug}/index.js`),
            styleCss: readWs(ctx.workspaceRoot, `wordpress/blocks/${slug}/style.css`),
        });
        ctx.shared.customBlocks.push({ name: b.name, attributes: b.attributes || [] });
    }
    if (!baselines.length) return [];

    const mockupHtml = clip(readWs(ctx.workspaceRoot, entry.mockupPath), 70000);
    const mockupCss = clip(readWs(ctx.workspaceRoot, 'mockup/style.css'), 50000);

    // One call PER block, not one call for all of them. Batching several full
    // block sources into a single generation is what blew the timeout on a big
    // page. A block that still fails keeps its (valid, generic) scaffold baseline
    // instead of crashing the run — the repair loop can refine it later.
    await Promise.all(baselines.map(async (b) => {
        const prompt = [
            `Finalize the custom block "${b.name}" (slug "${b.slug}") so its edit() and save() match the mockup exactly.`,
            'Return the full replacement index.js and style.css. Keep the scaffolded block.json contract; vanilla JS with WordPress globals, no JSX/build.',
            b.reason ? `\nWHY THIS BLOCK EXISTS: ${b.reason}` : '',
            `\nSCAFFOLDED BASELINE:\n--- block.json ---\n${b.blockJson}\n--- index.js ---\n${b.indexJs}\n--- style.css ---\n${b.styleCss}`,
            `\nMOCKUP HTML (locate this block's section):\n${mockupHtml}`,
            `\nMOCKUP CSS:\n${mockupCss}`,
        ].join('\n');
        const res = await ctx.harness.complete({ id: `custom_blocks:${page}:${b.slug}`, systemPrompt: AUTHOR_SYS(), prompt, schema: ONE_BLOCK_SCHEMA, model: ctx.options.model });
        if (!res.ok) {
            ctx.log.warn(`[${page}] custom block ${b.slug} not finalized (${res.error}); keeping scaffold baseline`);
            return;
        }
        if (typeof res.data.indexJs === 'string') writeWs(ctx.workspaceRoot, `wordpress/blocks/${b.slug}/index.js`, res.data.indexJs);
        if (typeof res.data.styleCss === 'string') writeWs(ctx.workspaceRoot, `wordpress/blocks/${b.slug}/style.css`, res.data.styleCss);
    }));
    return baselines.map((b) => b.name);
}

function pageCssPath(entry) {
    // Multi-page runs get per-page CSS so parallel sessions never touch one file.
    return entry.suggested.treePath.startsWith('wordpress/pages/')
        ? `wordpress/pages/${entry.page}.css`
        : 'wordpress/style.css';
}

async function authorStep(ctx, entry, plan, isFoundation) {
    const { page } = entry;
    const mockupHtml = clip(readWs(ctx.workspaceRoot, entry.mockupPath));
    const mockupCss = clip(readWs(ctx.workspaceRoot, 'mockup/style.css'), 100000);
    const customBlocks = ctx.shared.customBlocks;

    const noCustom = ctx.options.noCustomBlocks;
    const prompt = [
        `Author the data-only block tree and page CSS for page "${page}" to reproduce the mockup.`,
        'blockTree is { version, contract:"data-only", blocks:[...] }; every block is { blockName, attrs, innerBlocks }.',
        'NO raw markup fields (htmlLines/innerHTML/markup/sourceHtml). Put styling in block support attributes first, page CSS last.',
        noCustom
            ? 'CORE BLOCKS ONLY: no custom blocks and no stand-ins — this is static brochure content. Chrome uses real core blocks (core/navigation, core/site-title); everything else is core group/columns/heading/paragraph/image/buttons.'
            : 'Mark data-driven regions with attrs.metadata.standin per the stand-in rules. Use real core dynamic blocks (navigation/search/site-title/query-pagination), never custom stand-ins.',
        (!noCustom && customBlocks.length) ? `\nAVAILABLE CUSTOM BLOCKS: ${JSON.stringify(customBlocks)}` : '',
        `\nBLOCK PLAN:\n${JSON.stringify(plan, null, 0)}`,
        `\nMOCKUP HTML:\n${mockupHtml}`,
        `\nMOCKUP CSS:\n${mockupCss}`,
        '\nReturn { blockTree, pageCss, previewContext? }.',
    ].join('\n');

    const res = await ctx.harness.complete({ id: `author:${page}`, systemPrompt: AUTHOR_SYS(), prompt, schema: AUTHOR_SCHEMA, model: ctx.options.model });
    if (!res.ok) throw new Error(`author:${page} failed — ${res.error}`);
    // Only the foundation page owns wordpress/preview-context.json, so parallel
    // secondary pages never race on that one shared file.
    applyTree(ctx, entry, res.data, { writePreview: isFoundation });
    return res.data;
}

function applyTree(ctx, entry, data, { writePreview = false } = {}) {
    const tree = normalizeTree(data.blockTree);
    writeJsonWs(ctx.workspaceRoot, entry.suggested.treePath, tree);
    if (typeof data.pageCss === 'string' && data.pageCss.trim()) {
        writeWs(ctx.workspaceRoot, pageCssPath(entry), data.pageCss);
    }
    if (writePreview && data.previewContext && Object.keys(data.previewContext).length) {
        writeJsonWs(ctx.workspaceRoot, 'wordpress/preview-context.json', data.previewContext);
    }
}

function metricOf(report) {
    const r = report?.metrics?.rendered?.maxMismatchPercent ?? 999;
    const e = report?.metrics?.editor?.maxMismatchPercent ?? 999;
    return Math.max(r, e);
}

async function repairLoop(ctx, entry, plan) {
    const { page } = entry;
    const th = ctx.options.thresholds;

    return runBoundedLoop({
        maxIters: ctx.options.maxRepair,
        plateauDelta: 0.3,
        log: (m) => ctx.log.debug(`[${page}] ${m}`),
        build: async () => {
            const report = await ctx.client.call('build_page', {
                workspaceRoot: ctx.workspaceRoot,
                page,
                mockupPath: entry.mockupPath,
                compareEditor: ctx.options.compareEditor !== false,
                maxMismatchPercent: th.mismatch,
                maxHeightDelta: th.height,
            });
            return { passed: report.passed, metric: metricOf(report), report };
        },
        repair: async (report, iter) => {
            const tree = readJsonWs(ctx.workspaceRoot, entry.suggested.treePath);
            const css = readWs(ctx.workspaceRoot, pageCssPath(entry));
            const mockupHtml = clip(readWs(ctx.workspaceRoot, entry.mockupPath), 80000);
            const prompt = [
                `Repair page "${page}". Return the FULL updated blockTree and pageCss (not a diff).`,
                'Fix the largest drift first (driftedSections by |deltaHeight|), then the listed tasks. Do not chase the ~1% webfont antialiasing floor.',
                report.error ? `\nThe previous tree FAILED TO SERIALIZE with: ${report.error}\nFix the tree so it serializes.` : '',
                `\nBUILD REPORT:\n${JSON.stringify({
                    passed: report.passed, metrics: report.metrics, driftedSections: report.driftedSections,
                    tasks: report.tasks, bodyHeight: report.bodyHeight, style: report.style,
                }, null, 0)}`,
                `\nCURRENT BLOCK TREE:\n${JSON.stringify(tree)}`,
                `\nCURRENT PAGE CSS:\n${clip(css, 60000)}`,
                `\nMOCKUP HTML (reference):\n${mockupHtml}`,
            ].join('\n');
            const res = await ctx.harness.complete({ id: `repair:${page}:${iter}`, systemPrompt: REPAIR_SYS(), prompt, schema: REPAIR_SCHEMA, model: ctx.options.model });
            if (!res.ok) { ctx.log.warn(`[${page}] repair ${iter} failed: ${res.error}`); return false; }
            applyTree(ctx, entry, res.data);
            return true;
        },
    });
}

// ---- page runner ------------------------------------------------------------

export async function runStage1Page(ctx, entry, { foundation = false } = {}) {
    const { page } = entry;
    ctx.log.step(`stage1 · ${page}${foundation ? ' (foundation)' : ''}`);

    await ctx.client.call('analyze_mockup', { workspaceRoot: ctx.workspaceRoot, htmlPath: entry.mockupPath });
    const plan = await planStep(ctx, entry, foundation);
    if (!ctx.options.noCustomBlocks) await customBlocksStep(ctx, entry, plan);
    await authorStep(ctx, entry, plan, foundation);
    const loop = await repairLoop(ctx, entry, plan);

    const passed = loop.status === 'passed';
    (passed ? ctx.log.ok : ctx.log.warn).call(ctx.log, `[${page}] ${loop.status} after ${loop.iters} iter(s) · mismatch≈${loop.metric}`);
    return {
        page,
        status: loop.status,
        passed,
        iters: loop.iters,
        metric: loop.metric,
        metrics: loop.report?.metrics || null,
    };
}

export const _schemas = { PLAN_SCHEMA, ONE_BLOCK_SCHEMA, AUTHOR_SCHEMA, REPAIR_SCHEMA };
