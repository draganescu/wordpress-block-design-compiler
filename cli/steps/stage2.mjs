// Stage 2 — blocks-to-theme. Deterministic-heavy: evidence + parts + fonts +
// scaffold + validate are tools; the two judgment calls are the theme plan
// (whose structured output IS the scaffold args) and the gate repairs.

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

const THEME_FIX_SCHEMA = {
    type: 'object', additionalProperties: false,
    properties: {
        themeJson: { type: 'object' },
        themeStyleCss: { type: 'string' },
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
}

async function playgroundGate(ctx, slug) {
    const th = ctx.options.thresholds;
    return runBoundedLoop({
        maxIters: ctx.options.maxRepair,
        plateauDelta: 0.3,
        log: (m) => ctx.log.debug(`[theme] ${m}`),
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
            const images = (report.pages || [])
                .flatMap((p) => (p.results || []).flatMap((r) => [r.diff, r.mockup, r.candidate]))
                .filter((v, i, a) => v && a.indexOf(v) === i)
                .slice(0, 6);
            const prompt = [
                'Repair the block theme so every page passes the Playground gate at both viewports.',
                'FIRST Read the diff screenshots below to see the concrete visual differences, then edit ONLY theme.json and/or the theme style.css — never the content payloads. Return only the file(s) you changed (omit the other).',
                images.length ? `\nSCREENSHOTS (Read these; diff images show mismatching pixels in red):\n${images.join('\n')}` : '',
                `\nGATE REPORT:\n${JSON.stringify({ passed: report.passed, aggregates: report.aggregates, pages: report.pages }, null, 0)}`,
                `\nCURRENT theme.json:\n${JSON.stringify(themeJson)}`,
                `\nCURRENT theme style.css:\n${themeCss.slice(0, 60000)}`,
            ].join('\n');
            const res = await ctx.harness.complete({
                id: `theme_repair:${iter}`, systemPrompt: images.length ? GATE_VISION_SYS() : GATE_SYS(), prompt, schema: THEME_FIX_SCHEMA,
                allowedTools: images.length ? ['Read'] : undefined, maxTurns: 24,
                ...judgeParams(ctx, 'repair'),
            });
            if (!res.ok) { ctx.log.warn(`[theme] repair ${iter} failed: ${res.error}`); return false; }
            applyThemeFix(ctx, slug, res.data);
            return true;
        },
    });
}

export async function runStage2(ctx) {
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

export const _schemas = { THEME_PLAN_SCHEMA, THEME_FIX_SCHEMA };
