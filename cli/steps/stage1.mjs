// Stage 1 — html-to-blocks, per page. Fixed sequence:
//   analyze_mockup (tool) -> plan (judgment) -> custom blocks (scaffold tool +
//   judgment source) -> author tree (judgment) -> bounded repair loop
//   (build_page tool + judgment fix).
//
// Each judgment step is one `claude -p` call returning structured data the CLI
// then writes; the model never drives, never wanders.

import path from 'node:path';
import { skillContext, HARNESS_PREAMBLE, HARNESS_PREAMBLE_VISION, SERIALIZER_CONSTRAINTS } from '../prompts/skill-context.mjs';
import { runBoundedLoop } from '../loops.mjs';
import {
    readWs, readJsonWs, writeWs, writeJsonWs, clip, planToMarkdown, normalizeTree, judgeParams,
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

// blockTree is OPTIONAL on repairs: most drift fixes are CSS-only, and
// re-emitting a full 40KB tree per iteration is what makes repair calls slow
// (and occasionally blow the call timeout). Omitting blockTree keeps the
// current tree; the loop still rebuilds and re-measures either way.
const REPAIR_SCHEMA = {
    type: 'object', additionalProperties: false,
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

const REPAIR_SYS = () => `${HARNESS_PREAMBLE_VISION}\n\n${SERIALIZER_CONSTRAINTS}\n\n${skillContext([
    'skills/html-to-blocks/references/repair-loop.md',
    'skills/html-to-blocks/references/css-transfer-gotchas.md',
])}`;

// Fast core-only author: planning knowledge inlined (core-block-selection), no
// custom-block standards — there are no custom blocks to write.
const FAST_AUTHOR_SYS = () => `${HARNESS_PREAMBLE}\n\n${SERIALIZER_CONSTRAINTS}\n\n${skillContext([
    'skills/html-to-blocks/SKILL.md',
    'skills/html-to-blocks/references/core-block-selection.md',
])}`;

const FAST_AUTHOR_VISION_SYS = () => `${HARNESS_PREAMBLE_VISION}\n\n${SERIALIZER_CONSTRAINTS}\n\n${skillContext([
    'skills/html-to-blocks/SKILL.md',
    'skills/html-to-blocks/references/core-block-selection.md',
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

    const res = await ctx.harness.complete({ id: `plan:${page}`, systemPrompt: PLAN_SYS(), prompt, schema: PLAN_SCHEMA, ...judgeParams(ctx, 'build') });
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
        const res = await ctx.harness.complete({ id: `custom_blocks:${page}:${b.slug}`, systemPrompt: AUTHOR_SYS(), prompt, schema: ONE_BLOCK_SCHEMA, ...judgeParams(ctx, 'build') });
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

    const res = await ctx.harness.complete({ id: `author:${page}`, systemPrompt: AUTHOR_SYS(), prompt, schema: AUTHOR_SCHEMA, ...judgeParams(ctx, 'build') });
    if (!res.ok) throw new Error(`author:${page} failed — ${res.error}`);
    // Only the foundation page owns wordpress/preview-context.json, so parallel
    // secondary pages never race on that one shared file.
    applyTree(ctx, entry, res.data, { writePreview: isFoundation });
    return res.data;
}

// Merged plan+author for core-blocks-only pages (fast mode). The separate plan
// step earns its keep by deciding custom blocks and documenting strategy; with
// custom blocks off, its output feeds nothing downstream — so plan internally,
// emit only the tree, and save a full judgment call on the page's critical path.
async function fastAuthorStep(ctx, entry, isFoundation) {
    const { page } = entry;
    const mockupHtml = clip(readWs(ctx.workspaceRoot, entry.mockupPath));
    const mockupCss = clip(readWs(ctx.workspaceRoot, 'mockup/style.css'), 100000);
    const analysis = readJsonWs(ctx.workspaceRoot, `analysis/${page}.analysis.json`)
        || readJsonWs(ctx.workspaceRoot, 'analysis/analysis.json');

    // Author with eyes: a desktop screenshot of the mockup grounds section
    // sizing far better than HTML text alone — the dominant first-build drift
    // is structurally mis-sized sections, and every repair iteration avoided
    // saves minutes. Best-effort: on any failure the author runs text-only.
    let mockupShot = null;
    try {
        const shot = await ctx.buildSemaphore.run(() => ctx.client.call('screenshot_html', {
            workspaceRoot: ctx.workspaceRoot,
            targets: [{ name: `${page}-mockup`, path: entry.mockupPath }],
            viewports: [{ name: 'desktop', width: 1440, height: 900 }],
        }));
        mockupShot = (shot?.screenshots || []).map((s) => s.path).find(Boolean) || null;
    } catch { /* text-only author */ }

    // Shared chrome (authored once per run). When the chrome author is running,
    // this author only produces the <main> sections; the chrome result is only
    // needed at SPLICE time, after this author's own generation — so don't
    // serialize behind it here (~4 min of critical path saved per run).
    const chromeExpected = Boolean(ctx.shared.chromePromise);

    // NOTE: authoring the page's sections as parallel per-section calls was
    // tried (2026-07-07) and reverted: first-build fidelity dropped from 5-9%
    // to 10-13% mismatch (sections authored in isolation lose the cross-
    // section rhythm), author cost tripled (every call re-ingests the full
    // mockup), and occasional malformed section envelopes broke serialization.
    // Whole-page authoring is load-bearing for quality — same reason the
    // chrome is authored once, not per page.
    const prompt = [
        chromeExpected
            ? `Author the data-only block tree (MAIN CONTENT ONLY) and page CSS for page "${page}" from the mockup's <main>. The site header and footer are authored separately — do NOT include them; your blocks array starts at the first section inside <main>.`
            : `Author the data-only block tree and page CSS for page "${page}" from the mockup (including the header and footer chrome). Plan the section-to-block mapping internally; return only the finished tree.`,
        'The mockup is a DESIGN GUIDE, not a pixel contract — the user never sees it. Carry over its content VERBATIM, its section order, and its style (colors, typography, spacing rhythm, mood); you do not need pixel-exact geometry.',
        'LEAN TREES: reuse the shared design-system class names via className and let the stylesheet do the styling. Avoid per-block style/layout attrs unless a section genuinely needs one, and omit attributes that restate defaults — smaller trees author faster and edit cleaner.',
        'blockTree is { version, contract:"data-only", blocks:[...] }; every block is { blockName, attrs, innerBlocks }.',
        'NO raw markup fields (htmlLines/innerHTML/markup/sourceHtml).',
        'CORE BLOCKS ONLY: no custom blocks and no stand-ins — this is static brochure content; core group/columns/heading/paragraph/image/buttons/quote/list.',
        'IMAGES: reproduce each mockup <img> as core/image with the EXACT same relative url (images/<name>.jpg) and the same alt text — the files exist under those names.',
        'The MOCKUP CSS below is the shared design system and is ALREADY linked on the rendered page — do NOT repeat its rules in pageCss; pageCss is ONLY for page-specific rules the shared stylesheet lacks.',
        'Cover EVERY section in the section analysis below — dropped sections are the most common failure, and section coverage IS the gate.',
        mockupShot ? `\nMOCKUP SCREENSHOT (Read this first to see the intended layout, section proportions, and rhythm):\n${mockupShot}` : '',
        `\nSECTION ANALYSIS:\n${JSON.stringify(analysis?.sections || [], null, 0)}`,
        `\nMOCKUP HTML:\n${mockupHtml}`,
        `\nMOCKUP CSS (already linked — reuse class names, do not duplicate):\n${mockupCss}`,
        '\nReturn { blockTree, pageCss, previewContext? }.',
    ].join('\n');

    const res = await ctx.harness.complete({
        id: `author:${page}`, systemPrompt: mockupShot ? FAST_AUTHOR_VISION_SYS() : FAST_AUTHOR_SYS(),
        prompt, schema: AUTHOR_SCHEMA,
        allowedTools: mockupShot ? ['Read'] : undefined, maxTurns: 16,
        ...judgeParams(ctx, 'build'),
    });
    if (!res.ok) throw new Error(`author:${page} failed — ${res.error}`);
    let data = res.data;
    if (chromeExpected) {
        // Splice: header chrome + <main> wrapper around the authored sections +
        // footer chrome. Identical chrome on every page, by construction. Await
        // the chrome only now — it authored concurrently with this call.
        // Never mutate res.data: the harness may hand out shared objects.
        const chrome = await ctx.shared.chromePromise;
        if (!chrome) throw new Error(`author:${page} produced main-only content but chrome authoring failed`);
        const main = normalizeTree(data.blockTree);
        data = {
            ...data,
            blockTree: {
                version: main.version, contract: 'data-only',
                blocks: [
                    ...chrome.headerBlocks,
                    { blockName: 'core/group', attrs: { tagName: 'main' }, innerBlocks: main.blocks },
                    ...chrome.footerBlocks,
                ],
            },
        };
    }
    applyTree(ctx, entry, data, { writePreview: isFoundation });
    return data;
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

// ---- suggestion gate (fast brochure) -----------------------------------------
//
// Fast brochure mode treats the generated mockup as a DESIGN GUIDE, not a
// pixel contract — the user never sees the mockup, so pixel parity with it is
// not the product. Pages gate on sanity instead: the tree serializes and
// renders, and every mockup section made it into the tree (dropped sections
// are the historical #1 authoring failure). Pixel metrics are still measured
// and reported, but only as information.

function buildPageOnce(ctx, entry) {
    const th = ctx.options.thresholds;
    return ctx.buildSemaphore.run(() => ctx.client.call('build_page', {
        workspaceRoot: ctx.workspaceRoot,
        page: entry.page,
        mockupPath: entry.mockupPath,
        compareEditor: ctx.options.compareEditor !== false,
        maxMismatchPercent: th.mismatch,
        maxHeightDelta: th.height,
    }));
}

export function collectTreeText(blocks, out = []) {
    for (const b of blocks || []) {
        if (!b || typeof b !== 'object') continue;
        for (const key of ['content', 'label', 'text', 'citation', 'value', 'summary']) {
            if (typeof b.attrs?.[key] === 'string') out.push(b.attrs[key]);
        }
        collectTreeText(b.innerBlocks, out);
    }
    return out;
}

export function normText(text) {
    return String(text || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
        .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
        .toLowerCase().replace(/\s+/g, ' ').trim();
}

// Which mockup sections' headings are absent from the authored tree. Headings
// transfer verbatim (the author transcribes content), so a missing heading
// means a dropped section, not a rewording.
export function missingHeadings(sections, tree) {
    const text = normText(collectTreeText(tree?.blocks).join(' '));
    return (sections || [])
        .map((s) => (typeof s.heading === 'string' ? s.heading.trim() : ''))
        .filter((h) => h.length >= 4)
        .filter((h) => !text.includes(normText(h).slice(0, 60)));
}

// One bounded fix call — used for the two sanity failures a page can have.
async function sanityFixStep(ctx, entry, { id, instructions }) {
    const { page } = entry;
    const tree = readJsonWs(ctx.workspaceRoot, entry.suggested.treePath);
    const mockupHtml = clip(readWs(ctx.workspaceRoot, entry.mockupPath), 60000);
    const res = await ctx.harness.complete({
        id, systemPrompt: REPAIR_SYS(), schema: REPAIR_SCHEMA, maxTurns: 8,
        prompt: [
            instructions,
            'Return the FULL corrected blockTree (and pageCss additions only if needed). Keep everything that is already correct unchanged.',
            `\nCURRENT BLOCK TREE:\n${JSON.stringify(tree)}`,
            `\nMOCKUP HTML (reference):\n${mockupHtml}`,
        ].join('\n'),
        ...judgeParams(ctx, 'repair'),
    });
    if (!res.ok || !res.data.blockTree) return false;
    applyTree(ctx, entry, res.data);
    return true;
}

async function suggestionGatePage(ctx, entry) {
    const { page } = entry;
    const analysis = readJsonWs(ctx.workspaceRoot, `analysis/${page}.analysis.json`)
        || readJsonWs(ctx.workspaceRoot, 'analysis/analysis.json');
    const sections = analysis?.sections || [];

    let report = null;
    let iters = 1;
    try {
        report = await buildPageOnce(ctx, entry);
    } catch (err) {
        // A tree that cannot serialize/render is broken product, not drift —
        // one mandatory fix attempt.
        ctx.log.warn(`[${page}] build failed (${String(err?.message || err).split('\n')[0]}); one serialize-fix pass`);
        const fixed = await sanityFixStep(ctx, entry, {
            id: `repair:${page}:serialize`,
            instructions: `The block tree for page "${page}" FAILED to serialize/render with:\n${err?.message || err}\nFix the tree so it serializes.`,
        });
        iters = 2;
        if (fixed) report = await buildPageOnce(ctx, entry).catch(() => null);
        if (!report) {
            return { page, status: 'errored', passed: false, iters, metric: 999, error: String(err?.message || err) };
        }
    }

    let missing = missingHeadings(sections, readJsonWs(ctx.workspaceRoot, entry.suggested.treePath));
    if (missing.length) {
        ctx.log.warn(`[${page}] ${missing.length} mockup section(s) missing from the tree; one coverage-fix pass`);
        const fixed = await sanityFixStep(ctx, entry, {
            id: `repair:${page}:coverage`,
            instructions: [
                `The authored tree for page "${page}" DROPPED these mockup sections (their headings appear nowhere in the tree):`,
                ...missing.map((h) => `- ${h}`),
                'Add the missing sections in their mockup order with their full content.',
            ].join('\n'),
        });
        iters += 1;
        if (fixed) {
            report = await buildPageOnce(ctx, entry).catch(() => report);
            missing = missingHeadings(sections, readJsonWs(ctx.workspaceRoot, entry.suggested.treePath));
        }
    }

    const passed = missing.length === 0;
    const metric = metricOf(report);
    (passed ? ctx.log.ok : ctx.log.warn).call(ctx.log,
        `[${page}] ${passed ? 'passed' : 'incomplete'} · sections ${sections.length - missing.length}/${sections.length} · informational mismatch≈${metric}`);
    return {
        page,
        status: passed ? 'passed' : 'incomplete',
        passed,
        iters,
        metric,
        metrics: report?.metrics || null,
        informationalMetrics: true,
        ...(missing.length ? { missingSections: missing } : {}),
    };
}

async function repairLoop(ctx, entry, plan) {
    const { page } = entry;
    const th = ctx.options.thresholds;

    return runBoundedLoop({
        maxIters: ctx.options.maxRepair,
        plateauDelta: 0.3,
        log: (m) => ctx.log.debug(`[${page}] ${m}`),
        // Fast mode only chases misses a single repair round can plausibly
        // close. Profiling showed repairs on far-off pages are the worst spend
        // in the run (multi-minute calls that plateau above the gate anyway).
        // A build that THREW is always repairable: its carried-over metric is
        // meaningless and the fix (make the tree serialize) is mandatory.
        shouldRepair: ctx.options.fast
            ? (result) => Boolean(result.threw || result.report?.error) || result.metric <= th.mismatch * 2
            : null,
        // Keep-best: a repair must never leave the page worse than its best
        // build (observed: a repair pushing a 10% page to 57%). State is the
        // pair of files a build measures.
        snapshot: () => ({
            tree: readWs(ctx.workspaceRoot, entry.suggested.treePath),
            css: readWs(ctx.workspaceRoot, pageCssPath(entry)),
        }),
        restore: (state) => {
            if (state.tree) writeWs(ctx.workspaceRoot, entry.suggested.treePath, state.tree);
            writeWs(ctx.workspaceRoot, pageCssPath(entry), state.css || '');
        },
        build: async () => {
            const report = await ctx.buildSemaphore.run(() => ctx.client.call('build_page', {
                workspaceRoot: ctx.workspaceRoot,
                page,
                mockupPath: entry.mockupPath,
                compareEditor: ctx.options.compareEditor !== false,
                maxMismatchPercent: th.mismatch,
                maxHeightDelta: th.height,
            }));
            return { passed: report.passed, metric: metricOf(report), report };
        },
        repair: async (report, iter) => {
            const tree = readJsonWs(ctx.workspaceRoot, entry.suggested.treePath);
            const css = readWs(ctx.workspaceRoot, pageCssPath(entry));
            // Repair calls are the run's single worst time sink (observed
            // 4–10min each), and most of that is context the fix never needed.
            // Classify the miss and size the call to it: a page whose pixels
            // already sit under the mismatch gate but whose HEIGHT drifts is a
            // vertical-rhythm problem — one offset to find, no need to re-read
            // 80k of mockup HTML through 24 vision turns.
            const m = report.metrics || {};
            const worstMismatch = Math.max(m.rendered?.maxMismatchPercent ?? 0, m.editor?.maxMismatchPercent ?? 0);
            const worstHeight = Math.max(m.rendered?.maxHeightDelta ?? 0, m.editor?.maxHeightDelta ?? 0);
            const heightOnly = !report.error && worstMismatch <= th.mismatch && worstHeight > th.height;
            const maxImages = heightOnly ? 3 : 4;
            const mockupHtml = clip(readWs(ctx.workspaceRoot, entry.mockupPath), heightOnly ? 30000 : 50000);
            // The comparison screenshots ARE the ground truth the numbers only
            // summarize. Give the repair call eyes: it may Read the mockup /
            // rendered / diff images named in the tasks before deciding a fix.
            const images = (report.tasks || [])
                .flatMap((t) => Object.values(t.images || {}))
                .filter((v, i, a) => v && a.indexOf(v) === i)
                // Diff images first — they say the most per token. Few images, so
                // the turn budget is spent fixing, not looking.
                .sort((a, b) => (b.includes('diff') ? 1 : 0) - (a.includes('diff') ? 1 : 0))
                .slice(0, maxImages);
            const prompt = [
                heightOnly
                    ? `Repair page "${page}": the pixels already match (${worstMismatch}% ≤ ${th.mismatch}%) but the page is ${worstHeight}px off the mockup's height (gate: ${th.height}px). Find the vertical drift — one wrong margin/padding/gap, a stretched section, or a missing/duplicated section — and fix THAT. Return pageCss ONLY; include a full blockTree only if a section must be added or removed.`
                    : `Repair page "${page}". Return the updated pageCss and, ONLY IF block structure/content must change, the FULL updated blockTree (omit blockTree for CSS-only fixes — smaller answers apply faster).`,
                heightOnly
                    ? 'The diff screenshot\'s first red band marks where the layouts diverge (see firstDiffY in the tasks) — the cause sits AT or ABOVE that y. Compare section heights between mockup and rendered screenshots; do not restyle anything that already matches.'
                    : 'FIRST look at the diff screenshots (Read the image paths below), identify the concrete visual differences (offsets, alignment, sizing, colors, missing chrome), then fix the largest drift first. A uniform ghosting of all text below some y usually means ONE early vertical gap — fix that single offset. Do not chase the ~1% webfont antialiasing floor.',
                report.error ? `\nThe previous tree FAILED TO SERIALIZE with: ${report.error}\nFix the tree so it serializes (this needs the full blockTree back).` : '',
                images.length ? `\nSCREENSHOTS (Read these; diff images show mismatching pixels in red):\n${images.join('\n')}` : '',
                `\nBUILD REPORT:\n${JSON.stringify({
                    passed: report.passed, metrics: report.metrics, driftedSections: report.driftedSections,
                    tasks: report.tasks, bodyHeight: report.bodyHeight, style: report.style,
                }, null, 0)}`,
                `\nCURRENT BLOCK TREE:\n${JSON.stringify(tree)}`,
                `\nCURRENT PAGE CSS:\n${clip(css, 60000)}`,
                `\nMOCKUP HTML (reference):\n${mockupHtml}`,
            ].join('\n');
            const res = await ctx.harness.complete({
                id: `repair:${page}:${iter}`, systemPrompt: REPAIR_SYS(), prompt, schema: REPAIR_SCHEMA,
                allowedTools: images.length ? ['Read'] : undefined, maxTurns: heightOnly ? 12 : 16,
                ...judgeParams(ctx, 'repair'),
            });
            if (!res.ok) { ctx.log.warn(`[${page}] repair ${iter} failed: ${res.error}`); return false; }
            if (!res.data.blockTree && typeof res.data.pageCss !== 'string') {
                ctx.log.warn(`[${page}] repair ${iter} returned neither blockTree nor pageCss`);
                return false;
            }
            if (res.data.blockTree) {
                applyTree(ctx, entry, res.data);
            } else {
                writeWs(ctx.workspaceRoot, pageCssPath(entry), res.data.pageCss);
            }
            return true;
        },
    });
}

// ---- page runner ------------------------------------------------------------

export async function runStage1Page(ctx, entry, { foundation = false, fastAuthor = false } = {}) {
    const { page } = entry;
    ctx.log.step(`stage1 · ${page}${foundation ? ' (foundation)' : ''}${fastAuthor ? ' (fast)' : ''}`);

    await ctx.client.call('analyze_mockup', { workspaceRoot: ctx.workspaceRoot, htmlPath: entry.mockupPath });
    let plan = null;
    if (fastAuthor && ctx.options.noCustomBlocks) {
        await fastAuthorStep(ctx, entry, foundation);
        // Fast brochure: the mockup is a design guide, not a pixel target —
        // sanity gates (serializes, renders, full section coverage) instead of
        // the pixel repair loop.
        return suggestionGatePage(ctx, entry);
    }
    plan = await planStep(ctx, entry, foundation);
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
