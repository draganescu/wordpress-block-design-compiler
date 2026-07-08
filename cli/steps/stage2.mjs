// Stage 2 — blocks-to-theme. Deterministic-heavy: evidence + parts + fonts +
// scaffold + validate are tools; the two judgment calls are the theme plan
// (whose structured output IS the scaffold args) and the gate repairs.

import fs from 'node:fs';
import path from 'node:path';
import { skillContext, HARNESS_PREAMBLE, HARNESS_PREAMBLE_VISION, SERIALIZER_CONSTRAINTS } from '../prompts/skill-context.mjs';
import { runBoundedLoop } from '../loops.mjs';
import { readWs, readJsonWs, writeWs, writeJsonWs, judgeParams } from './helpers.mjs';

const THEME_PLAN_SCHEMA = {
    type: 'object', additionalProperties: false,
    required: ['slug', 'name', 'tokenMap', 'themeSettings', 'themeStyles', 'parts', 'templates', 'pages'],
    properties: {
        slug: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        tokenMap: { type: 'object' },
        themeSettings: { type: 'object' },
        themeStyles: { type: 'object' },
        // parts: [{ slug, area, source:{ page, index } }]
        parts: {
            type: 'array',
            items: {
                type: 'object', additionalProperties: true, required: ['slug', 'area'],
                properties: { slug: { type: 'string' }, area: { type: 'string' }, source: { type: 'object' } },
            },
        },
        // templates: each value is an ARRAY of entries, entry = {type:'part',slug}
        // or {type:'tree',blocks:[...]}. The tool rejects any non-array value.
        templates: {
            type: 'object',
            additionalProperties: {
                type: 'array',
                items: {
                    type: 'object', additionalProperties: true, required: ['type'],
                    properties: { type: { type: 'string', enum: ['part', 'tree'] }, slug: { type: 'string' }, blocks: { type: 'array' } },
                },
            },
        },
        // pages: [{ page, slug, title, front?, stripIndexes?, sourceFile? }]
        pages: {
            type: 'array',
            items: {
                type: 'object', additionalProperties: true, required: ['page', 'slug', 'title'],
                properties: {
                    page: { type: 'string' }, slug: { type: 'string' }, title: { type: 'string' },
                    front: { type: 'boolean' }, stripIndexes: { type: 'boolean' }, sourceFile: { type: 'string' },
                },
            },
        },
        mediaMap: { type: 'object' },
        customCss: { type: 'string' },
        themePlanMd: { type: 'string' },
    },
};

// appendCss exists because re-emitting the full theme stylesheet (the entire
// design system) is what makes gate repairs slow — a fix is usually a handful
// of rules, so let the model return just those.
const THEME_FIX_SCHEMA = {
    type: 'object', additionalProperties: false,
    properties: {
        themeJson: { type: 'object' },
        themeStyleCss: { type: 'string' },
        appendCss: { type: 'string' },
        note: { type: 'string' },
    },
};

const PLAN_SYS = () => `${HARNESS_PREAMBLE}\n\n${SERIALIZER_CONSTRAINTS}\n\n${skillContext([
    'skills/blocks-to-theme/SKILL.md',
    'skills/blocks-to-theme/references/theme-json-mapping.md',
    'skills/blocks-to-theme/references/template-planning.md',
    'skills/blocks-to-theme/references/template-part-inference.md',
])}`;

const GATE_SYS = () => `${HARNESS_PREAMBLE}\n\n${skillContext([
    'skills/blocks-to-theme/SKILL.md',
    'skills/blocks-to-theme/references/playground-gate.md',
])}`;

const GATE_VISION_SYS = () => `${HARNESS_PREAMBLE_VISION}\n\n${skillContext([
    'skills/blocks-to-theme/SKILL.md',
    'skills/blocks-to-theme/references/playground-gate.md',
])}`;

async function themePlanStep(ctx, evidence, parts) {
    const manifest = ctx.pages.map((p) => ({ page: p.page, sourceFile: p.sourceFile, primary: p.primary }));
    const prompt = [
        'Produce the WordPress block theme plan. Your JSON IS the scaffold_block_theme argument object.',
        'Build the token map from the ranked evidence. Every non-media/pseudo/position/blend/grid/interaction/selector CSS rule must lift into theme.json (lift-first gate). No template part without a cited occurrence group.',
        'templates must include index plus generic archive/single/404. pages entries: { page, slug, title, front?, stripIndexes?, sourceFile }. Set sourceFile to the original mockup filename so cross-page links resolve.',
        'EXACT SHAPES — scaffold rejects anything else, so copy these patterns literally:',
        '  parts: [{"slug":"header","area":"header","source":{"page":"index","index":0}}, {"slug":"footer","area":"footer","source":{"page":"index","index":2}}] — source.index is the ZERO-BASED position of that block among the page\'s top-level blocks (header is usually 0, footer usually the last index, e.g. 2 of 3 blocks); negative indexes are invalid.',
        '  templates: {"index":[{"type":"part","slug":"header"},{"type":"tree","blocks":[]},{"type":"part","slug":"footer"}]} — EVERY template value is an ARRAY of {type:"part"|"tree"} entries; never true/false, never a string, never a bare object.',
        '  pages: [{"page":"index","slug":"home","title":"Home","front":true,"sourceFile":"index.html"}]',
        `\nPAGE MANIFEST:\n${JSON.stringify(manifest, null, 0)}`,
        `\nTHEME EVIDENCE (ranked summary):\n${JSON.stringify(evidence, null, 0)}`,
        `\nTEMPLATE-PART EVIDENCE:\n${JSON.stringify(parts, null, 0)}`,
        '\nReturn the theme plan JSON.',
    ].join('\n');

    const res = await ctx.harness.complete({ id: 'theme_plan', systemPrompt: PLAN_SYS(), prompt, schema: THEME_PLAN_SCHEMA, ...judgeParams(ctx, 'build') });
    if (!res.ok) throw new Error(`theme_plan failed — ${res.error}`);
    if (res.data.themePlanMd) writeWs(ctx.workspaceRoot, 'plan/theme-plan.md', res.data.themePlanMd);
    return res.data;
}

function toScaffoldArgs(ctx, plan, fontFamilies) {
    const args = {
        workspaceRoot: ctx.workspaceRoot,
        slug: plan.slug,
        name: plan.name,
        description: plan.description,
        tokenMap: plan.tokenMap,
        themeSettings: plan.themeSettings,
        themeStyles: plan.themeStyles,
        parts: plan.parts,
        templates: plan.templates,
        pages: plan.pages,
        mediaMap: plan.mediaMap,
    };
    if (fontFamilies && fontFamilies.length) args.fontFamilies = fontFamilies;
    if (typeof plan.customCss === 'string') args.customCss = plan.customCss;
    return args;
}

// scaffold_block_theme validates its args and throws a very descriptive error on
// a shape mismatch (e.g. templates not arrays of entries). Feed that error back
// to a plan-fix judgment step and retry, rather than crashing the run.
async function scaffoldWithFix(ctx, plan, fontFamilies) {
    let current = plan;
    for (let iter = 1; iter <= ctx.options.maxRepair; iter++) {
        try {
            await ctx.client.call('scaffold_block_theme', toScaffoldArgs(ctx, current, fontFamilies));
            return current;
        } catch (err) {
            ctx.log.warn(`scaffold rejected the theme plan (attempt ${iter}): ${err.message.split('\n')[0]}`);
            if (iter === ctx.options.maxRepair) throw err;
            const fix = await ctx.harness.complete({
                id: `theme_plan_fix:${iter}`, systemPrompt: PLAN_SYS(), schema: THEME_PLAN_SCHEMA, ...judgeParams(ctx, 'repair'),
                prompt: [
                    'scaffold_block_theme rejected your theme plan. Return the FULL corrected plan JSON (same schema).',
                    'The error text below states the exact expected shapes — conform to them precisely.',
                    `\nERROR:\n${err.message}`,
                    `\nYOUR PLAN:\n${JSON.stringify(current)}`,
                ].join('\n'),
            });
            if (!fix.ok) throw new Error(`theme_plan_fix failed — ${fix.error}`);
            current = { ...current, ...fix.data };
            if (fix.data.themePlanMd) writeWs(ctx.workspaceRoot, 'plan/theme-plan.md', fix.data.themePlanMd);
        }
    }
    return current;
}

async function validateLoop(ctx, slug) {
    for (let iter = 1; iter <= ctx.options.maxRepair; iter++) {
        const report = await ctx.client.call('validate_block_theme', { workspaceRoot: ctx.workspaceRoot, slug });
        const errors = report.errors || [];
        if (!errors.length) { ctx.log.ok(`theme validation clean`); return { passed: true, iters: iter }; }
        ctx.log.debug(`validate iteration ${iter}: ${errors.length} error(s)`);
        if (iter === ctx.options.maxRepair) return { passed: false, iters: iter, errors };

        // Non-canonical part/template markup has a deterministic fix the LLM
        // step cannot even express (its schema only returns theme.json and
        // style.css) — route those errors to fix_block_markup and re-validate.
        const markupFiles = [...new Set(errors
            .map((e) => (String(e).match(/^((?:parts|templates)\/[^:]+\.html): invalid block markup/) || [])[1])
            .filter(Boolean))];
        if (markupFiles.length) {
            ctx.log.info(`canonicalizing ${markupFiles.length} theme file(s) via fix_block_markup`);
            await ctx.client.call('fix_block_markup', { workspaceRoot: ctx.workspaceRoot, paths: markupFiles.map((f) => `theme/${slug}/${f}`) });
            continue;
        }

        const themeJson = readJsonWs(ctx.workspaceRoot, `theme/${slug}/theme.json`);
        const themeCss = readWs(ctx.workspaceRoot, `theme/${slug}/style.css`);
        const prompt = [
            `Fix the block theme so validate_block_theme reports zero errors.`,
            `Return the corrected theme.json (full object) and/or the full theme style.css (keep the WordPress theme header comment).`,
            `\nVALIDATION ERRORS:\n${JSON.stringify(errors, null, 0)}`,
            `\nCURRENT theme.json:\n${JSON.stringify(themeJson)}`,
            `\nCURRENT theme style.css:\n${themeCss.slice(0, 60000)}`,
        ].join('\n');
        const res = await ctx.harness.complete({ id: `theme_fix:${iter}`, systemPrompt: GATE_SYS(), prompt, schema: THEME_FIX_SCHEMA, ...judgeParams(ctx, 'repair') });
        if (!res.ok) return { passed: false, iters: iter, errors, note: res.error };
        applyThemeFix(ctx, slug, res.data);
    }
    return { passed: false, iters: ctx.options.maxRepair };
}

function applyThemeFix(ctx, slug, data) {
    if (data.themeJson && Object.keys(data.themeJson).length) {
        writeJsonWs(ctx.workspaceRoot, `theme/${slug}/theme.json`, data.themeJson);
    }
    if (typeof data.themeStyleCss === 'string' && data.themeStyleCss.trim()) {
        writeWs(ctx.workspaceRoot, `theme/${slug}/style.css`, data.themeStyleCss);
    }
    if (typeof data.appendCss === 'string' && data.appendCss.trim()) {
        const current = readWs(ctx.workspaceRoot, `theme/${slug}/style.css`);
        writeWs(ctx.workspaceRoot, `theme/${slug}/style.css`, `${current}\n/* --- gate repair --- */\n${data.appendCss.trim()}\n`);
    }
}

async function playgroundGate(ctx, slug) {
    const th = ctx.options.thresholds;
    return runBoundedLoop({
        maxIters: ctx.options.maxRepair,
        plateauDelta: 0.3,
        log: (m) => ctx.log.debug(`[theme] ${m}`),
        // Keep-best: a theme repair that regresses the gate metric is rolled
        // back to the best-seen theme.json + style.css pair.
        snapshot: () => ({
            themeJson: readWs(ctx.workspaceRoot, `theme/${slug}/theme.json`),
            styleCss: readWs(ctx.workspaceRoot, `theme/${slug}/style.css`),
        }),
        restore: (state) => {
            if (state.themeJson) writeWs(ctx.workspaceRoot, `theme/${slug}/theme.json`, state.themeJson);
            if (state.styleCss) writeWs(ctx.workspaceRoot, `theme/${slug}/style.css`, state.styleCss);
        },
        build: async () => {
            const report = await ctx.client.call('playground_render', {
                workspaceRoot: ctx.workspaceRoot, slug,
                maxMismatchPercent: th.mismatch, maxHeightDelta: th.height,
            });
            return { passed: report.passed, metric: report.aggregates?.maxMismatchPercent ?? 999, report };
        },
        repair: async (report, iter) => {
            const themeJson = readJsonWs(ctx.workspaceRoot, `theme/${slug}/theme.json`);
            const themeCss = readWs(ctx.workspaceRoot, `theme/${slug}/style.css`);
            // Same miss-sizing as the page repairs: a gate failing on height
            // alone is a vertical-rhythm problem, not a restyling problem.
            const agg = report.aggregates || {};
            const heightOnly = (agg.maxMismatchPercent ?? 0) <= th.mismatch && (agg.maxHeightDelta ?? 0) > th.height;
            const images = (report.pages || [])
                .flatMap((p) => (p.results || []).flatMap((r) => [r.diff, r.mockup, r.candidate]))
                .filter((v, i, a) => v && a.indexOf(v) === i)
                .slice(0, heightOnly ? 3 : 4);
            const prompt = [
                heightOnly
                    ? `Repair the block theme: pages already match visually (${agg.maxMismatchPercent}% ≤ ${th.mismatch}%) but the worst page is ${agg.maxHeightDelta}px off its mockup height (gate: ${th.height}px). Find the vertical drift — a WordPress layout margin, block gap, or a stretched section — and fix THAT; do not restyle anything that matches.`
                    : 'Repair the block theme so every page passes the Playground gate at both viewports.',
                'FIRST Read the diff screenshots below to see the concrete visual differences, then edit ONLY theme.json and/or the theme stylesheet — never the content payloads.',
                'Prefer returning appendCss with ONLY the new/changed rules (it is appended to the theme stylesheet, so later rules win); re-emit the full themeStyleCss only when existing rules must be REMOVED or rewritten.',
                images.length ? `\nSCREENSHOTS (Read these; diff images show mismatching pixels in red):\n${images.join('\n')}` : '',
                `\nGATE REPORT:\n${JSON.stringify({ passed: report.passed, aggregates: report.aggregates, pages: report.pages }, null, 0)}`,
                `\nCURRENT theme.json:\n${JSON.stringify(themeJson)}`,
                `\nCURRENT theme style.css:\n${themeCss.slice(0, 60000)}`,
            ].join('\n');
            const res = await ctx.harness.complete({
                id: `theme_repair:${iter}`, systemPrompt: images.length ? GATE_VISION_SYS() : GATE_SYS(), prompt, schema: THEME_FIX_SCHEMA,
                allowedTools: images.length ? ['Read'] : undefined, maxTurns: heightOnly ? 12 : 16,
                ...judgeParams(ctx, 'repair'),
            });
            if (!res.ok) { ctx.log.warn(`[theme] repair ${iter} failed: ${res.error}`); return false; }
            applyThemeFix(ctx, slug, res.data);
            return true;
        },
    });
}

export async function runStage2(ctx) {
    // Fast brochure runs recorded the theme's structure as a fact (see
    // runStage2Brochure) — assemble it in code instead of re-deriving it.
    if (ctx.shared?.brochureAssembly) return runStage2Brochure(ctx);
    return runStage2Planned(ctx);
}

async function runStage2Planned(ctx) {
    ctx.log.step('stage2 · blocks-to-theme');

    const evidence = await ctx.client.call('analyze_theme_evidence', { workspaceRoot: ctx.workspaceRoot });
    const parts = await ctx.client.call('infer_template_parts', { workspaceRoot: ctx.workspaceRoot });
    const plan = await themePlanStep(ctx, evidence, parts);

    let fontFamilies = [];
    try {
        const fonts = await ctx.client.call('fetch_theme_fonts', { workspaceRoot: ctx.workspaceRoot, slug: plan.slug });
        fontFamilies = fonts.fontFamilies || [];
        ctx.log.debug(`fetched ${fontFamilies.length} font family/-ies`);
    } catch (err) {
        ctx.log.warn(`fetch_theme_fonts skipped: ${err.message}`);
    }

    await scaffoldWithFix(ctx, plan, fontFamilies);

    const validation = await validateLoop(ctx, plan.slug);
    if (!validation.passed) {
        ctx.log.error(`theme validation did not reach zero errors`);
        return { slug: plan.slug, validation, gate: null };
    }

    let gate = null;
    if (ctx.options.playground) {
        gate = await playgroundGate(ctx, plan.slug);
        (gate.status === 'passed' ? ctx.log.ok : ctx.log.warn).call(ctx.log, `[theme] gate ${gate.status} after ${gate.iters} iter(s) · mismatch≈${gate.metric}`);
        await ctx.client.call('playground_stop', { workspaceRoot: ctx.workspaceRoot, slug: plan.slug }).catch(() => {});
    } else {
        ctx.log.info('playground gate skipped (--no-playground)');
    }

    return { slug: plan.slug, validation, gate };
}

// ---- deterministic brochure assembly ----------------------------------------
//
// Fast brochure pages are spliced by the pipeline as [header, main, footer]
// around ONE authored chrome, so the theme's structure is known by
// construction: lift the header/footer blocks as template parts, render page
// content through post-content, strip the chrome from each page's payload.
// Everything visible stays exactly as the creative calls authored it — chrome
// design, page trees, all CSS. Only the bookkeeping the LLM plan used to
// spend ~9 minutes re-deriving (sometimes wrongly) is done in code.

function slugify(text, fallback = 'brochure-site') {
    const slug = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');
    return slug || fallback;
}

// The site design's free-form tokens object, sanitized into valid theme.json
// settings. Deterministic and defensive: junk entries drop, slugs dedupe —
// bad LLM data must never fail theme validation.
function tokensToThemeSettings(tokens = {}) {
    const entries = (list, valueKey) => {
        const seen = new Set();
        return (Array.isArray(list) ? list : [])
            .filter((t) => t && typeof t === 'object' && t[valueKey] && String(t[valueKey]).trim())
            .map((t, i) => ({
                slug: slugify(t.slug || t.name || `token-${i + 1}`, `token-${i + 1}`),
                name: String(t.name || t.slug || `Token ${i + 1}`),
                [valueKey]: String(t[valueKey]).trim(),
            }))
            .filter((t) => (seen.has(t.slug) ? false : seen.add(t.slug)));
    };
    const settings = {};
    const palette = entries(tokens.colors, 'color');
    if (palette.length) settings.color = { palette };
    const fontSizes = entries(tokens.fontSizes, 'size');
    if (fontSizes.length) settings.typography = { fontSizes };
    const spacingSizes = entries(tokens.spacing, 'size');
    if (spacingSizes.length) settings.spacing = { spacingSizes };
    return settings;
}

// A tree with an item missing blockName/name would crash serialization inside
// scaffold_block_theme and take the whole theme down with it. Exclude such
// pages (they failed their gate anyway) instead of crashing.
function treeIsSane(blocks) {
    return (blocks || []).every((b) => b && typeof b === 'object'
        && typeof (b.blockName || b.name) === 'string'
        && treeIsSane(b.innerBlocks));
}

// Repairs may return a full restructured tree — scan for the chrome, never
// assume the splice positions survived.
function chromeIndexes(tree) {
    const blocks = tree?.blocks || [];
    const tag = (b) => b?.attrs?.tagName;
    const header = blocks.findIndex((b) => tag(b) === 'header');
    let footer = -1;
    for (let i = blocks.length - 1; i >= 0; i--) {
        if (tag(blocks[i]) === 'footer') { footer = i; break; }
    }
    return { header, footer };
}

async function runStage2Brochure(ctx) {
    const { site } = ctx.shared.brochureAssembly;
    ctx.log.step('stage2 · blocks-to-theme (deterministic brochure assembly)');

    // Only pages that produced a sane tree ship (errored pages have none;
    // a malformed tree would crash scaffold serialization for everyone).
    const pages = [];
    for (const entry of ctx.pages) {
        const tree = readJsonWs(ctx.workspaceRoot, entry.suggested.treePath);
        if (!tree || !Array.isArray(tree.blocks)) continue;
        if (!treeIsSane(tree.blocks)) {
            ctx.log.warn(`[theme] excluding page "${entry.page}" — its tree has items without blockName`);
            continue;
        }
        pages.push({ entry, chrome: chromeIndexes(tree) });
    }
    if (!pages.length) throw new Error('no page trees available to assemble a theme from');

    const source = pages.find((p) => p.chrome.header !== -1 && p.chrome.footer !== -1 && p.chrome.header < p.chrome.footer);
    if (!source) {
        ctx.log.warn('no page kept the [header, main, footer] shape; falling back to the planned theme path');
        return runStage2Planned(ctx);
    }

    const name = (site.siteName || '').trim() || ctx.brief.trim().split(/\s+/).slice(0, 4).join(' ') || 'Brochure Site';
    const slug = slugify(name);

    let fontFamilies = [];
    try {
        const fonts = await ctx.client.call('fetch_theme_fonts', { workspaceRoot: ctx.workspaceRoot, slug });
        fontFamilies = fonts.fontFamilies || [];
        ctx.log.debug(`fetched ${fontFamilies.length} font family/-ies`);
    } catch (err) {
        ctx.log.warn(`fetch_theme_fonts skipped: ${err.message}`);
    }

    const titles = new Map((ctx.shared.brochureAssembly.pages || []).map((p) => [p.slug, p.title]));
    const args = {
        workspaceRoot: ctx.workspaceRoot,
        slug,
        name,
        // Playground renders core/site-title from the blogname option; the
        // content plugin sets it from this so the wordmark matches the design.
        siteTitle: name,
        description: `Block theme generated from a brief: ${ctx.brief.trim().slice(0, 140)}`,
        // No token renames: the LLM-authored CSS is the design system and
        // ships verbatim (scaffold defaults customCss to wordpress/style.css
        // and bundles every wordpress/pages/*.css). theme.json settings carry
        // the site design's structured tokens so the user gets a real palette/
        // typography/spacing experience in the editor.
        tokenMap: {},
        themeSettings: tokensToThemeSettings(site.tokens),
        themeStyles: {},
        parts: [
            { slug: 'header', area: 'header', source: { page: source.entry.page, index: source.chrome.header } },
            { slug: 'footer', area: 'footer', source: { page: source.entry.page, index: source.chrome.footer } },
        ],
        templates: {
            index: [
                { type: 'part', slug: 'header' },
                { type: 'post-content' },
                { type: 'part', slug: 'footer' },
            ],
        },
        pages: pages.map(({ entry, chrome }) => ({
            page: entry.page,
            slug: entry.page === 'index' ? 'home' : entry.page,
            title: titles.get(entry.page) || entry.page,
            front: Boolean(entry.primary),
            sourceFile: entry.sourceFile,
            // The template parts provide the chrome; a payload keeping its own
            // copy would render a double header/footer.
            stripIndexes: [chrome.header, chrome.footer].filter((i) => i !== -1),
        })),
    };
    if (fontFamilies.length) args.fontFamilies = fontFamilies;
    await ctx.client.call('scaffold_block_theme', args);

    // Canonicalize EVERYTHING the theme stores as block markup (parse →
    // recreate → serialize): parts, templates, AND the per-page content
    // payloads. Authored attrs occasionally don't byte-match save() output
    // (observed: a core/spacer in a payload failing the Playground stored-
    // content validation); the fix is mechanical, so never leave it to a loop.
    const themeFiles = [
        ...['parts', 'templates'].flatMap((sub) => {
            const dir = path.join(ctx.workspaceRoot, 'theme', slug, sub);
            if (!fs.existsSync(dir)) return [];
            return fs.readdirSync(dir).filter((f) => f.endsWith('.html')).map((f) => `theme/${slug}/${sub}/${f}`);
        }),
        ...(() => {
            const dir = path.join(ctx.workspaceRoot, 'theme-plugin', `${slug}-content`, 'content');
            if (!fs.existsSync(dir)) return [];
            return fs.readdirSync(dir).filter((f) => f.endsWith('.html')).map((f) => `theme-plugin/${slug}-content/content/${f}`);
        })(),
    ];
    if (themeFiles.length) {
        await ctx.client.call('fix_block_markup', { workspaceRoot: ctx.workspaceRoot, paths: themeFiles });
    }

    const validation = await validateLoop(ctx, slug);
    if (!validation.passed) {
        ctx.log.error('theme validation did not reach zero errors');
        return { slug, validation, gate: null, deterministic: true };
    }

    // Brochure themes are built from a generated design the user never sees,
    // so the Playground check is a SMOKE render, not a pixel gate: every page
    // must render in real WordPress; the mismatch numbers are informational.
    let gate = null;
    if (ctx.options.playground) {
        try {
            const report = await ctx.client.call('playground_render', {
                workspaceRoot: ctx.workspaceRoot, slug,
                maxMismatchPercent: 100, maxHeightDelta: 1000000,
            });
            gate = {
                status: report.passed ? 'passed' : 'failed', smoke: true, iters: 1,
                metric: report.aggregates?.maxMismatchPercent ?? null,
                aggregates: report.aggregates || null,
            };
            (gate.status === 'passed' ? ctx.log.ok : ctx.log.warn).call(ctx.log,
                `[theme] smoke render ${gate.status} · informational mismatch≈${gate.metric} · height Δ≈${report.aggregates?.maxHeightDelta ?? '?'}px`);
        } catch (err) {
            gate = { status: 'failed', smoke: true, iters: 1, error: String(err?.message || err) };
            ctx.log.error(`[theme] smoke render failed: ${gate.error}`);
        }
        await ctx.client.call('playground_stop', { workspaceRoot: ctx.workspaceRoot, slug }).catch(() => {});
    } else {
        ctx.log.info('playground smoke render skipped (--no-playground)');
    }

    return { slug, validation, gate, deterministic: true };
}

export const _schemas = { THEME_PLAN_SCHEMA, THEME_FIX_SCHEMA };
