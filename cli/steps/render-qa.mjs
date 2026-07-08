// Render QA gate — the fixing step for "renders broken in real WordPress".
//
// Every other gate in the pipeline checks a proxy: the tree serializes, the
// theme validates, every mockup section is present, pixels match a mockup the
// user never sees. None of them LOOK at the shipped site. This loop does:
// after the Playground render, one vision judgment call per page names
// anything visibly BROKEN in the real WordPress screenshots (defects, not
// taste — see references/render-qa.md), and a bounded loop repairs until the
// defect list is empty, stops shrinking, or hits the cap.
//
// Detection is deliberately open-ended: a checklist of known symptoms (nav
// wrap, overflow, blank images) goes stale the day it ships; "look at the
// page like a visitor" does not. The harness stays deterministic about
// everything it CAN own — the loop, the stopping rules, keep-best rollback,
// and the whitelist of files a fix may touch.

import fs from 'node:fs';
import path from 'node:path';
import { skillContext, HARNESS_PREAMBLE_VISION, SERIALIZER_CONSTRAINTS } from '../prompts/skill-context.mjs';
import { runBoundedLoop } from '../loops.mjs';
import { readWs, readJsonWs, writeWs, writeJsonWs, judgeParams, clip } from './helpers.mjs';

// The judge returns a flat defect list; page attribution is added by the
// harness (one judge call per page), never trusted to the model.
const DEFECTS_SCHEMA = {
    type: 'object', additionalProperties: false, required: ['defects'],
    properties: {
        defects: {
            type: 'array',
            items: {
                type: 'object', additionalProperties: false, required: ['where', 'description'],
                properties: {
                    where: { type: 'string' },
                    description: { type: 'string' },
                    viewport: { type: 'string' },
                },
            },
        },
    },
};

// Unlike THEME_FIX_SCHEMA, a render QA fix may also edit block markup files
// (a stray element or a wrong navigation attribute is not expressible as
// CSS) — but only files from the editable whitelist, and every markup write
// is re-canonicalized through fix_block_markup before it can reach
// Playground's stored-content validation.
const RENDER_FIX_SCHEMA = {
    type: 'object', additionalProperties: false,
    properties: {
        appendCss: { type: 'string' },
        themeJson: { type: 'object' },
        files: {
            type: 'array',
            items: {
                type: 'object', additionalProperties: false, required: ['path', 'content'],
                properties: { path: { type: 'string' }, content: { type: 'string' } },
            },
        },
        note: { type: 'string' },
    },
};

const JUDGE_SYS = () => `${HARNESS_PREAMBLE_VISION}\n\n${skillContext([
    'skills/blocks-to-theme/references/render-qa.md',
])}`;

const FIX_SYS = () => `${HARNESS_PREAMBLE_VISION}\n\n${SERIALIZER_CONSTRAINTS}\n\n${skillContext([
    'skills/blocks-to-theme/SKILL.md',
    'skills/blocks-to-theme/references/render-qa.md',
])}`;

// The complete set of files a fix call may rewrite: template parts, templates,
// and the per-page content payloads. Enumerated from disk on every call, so a
// fix can never create a new file — only rewrite one the scaffold produced.
export function editableFiles(ws, slug) {
    const rels = [];
    for (const sub of ['parts', 'templates']) {
        const dir = path.join(ws, 'theme', slug, sub);
        if (!fs.existsSync(dir)) continue;
        for (const f of fs.readdirSync(dir)) if (f.endsWith('.html')) rels.push(`theme/${slug}/${sub}/${f}`);
    }
    const contentDir = path.join(ws, 'theme-plugin', `${slug}-content`, 'content');
    if (fs.existsSync(contentDir)) {
        for (const f of fs.readdirSync(contentDir)) if (f.endsWith('.html')) rels.push(`theme-plugin/${slug}-content/content/${f}`);
    }
    return rels;
}

export async function applyRenderFix(ctx, slug, data) {
    const ws = ctx.workspaceRoot;
    const allowed = new Set(editableFiles(ws, slug));
    let applied = false;
    const markupWrites = [];
    for (const f of data.files || []) {
        if (!allowed.has(f.path)) {
            ctx.log.warn(`render QA fix touched a non-editable path, skipped: ${f.path}`);
            continue;
        }
        if (typeof f.content !== 'string' || !f.content.trim()) continue;
        writeWs(ws, f.path, f.content);
        markupWrites.push(f.path);
        applied = true;
    }
    if (data.themeJson && Object.keys(data.themeJson).length) {
        writeJsonWs(ws, `theme/${slug}/theme.json`, data.themeJson);
        applied = true;
    }
    if (typeof data.appendCss === 'string' && data.appendCss.trim()) {
        const current = readWs(ws, `theme/${slug}/style.css`);
        writeWs(ws, `theme/${slug}/style.css`, `${current}\n/* --- render qa --- */\n${data.appendCss.trim()}\n`);
        applied = true;
    }
    if (markupWrites.length) {
        await ctx.client.call('fix_block_markup', { workspaceRoot: ws, paths: markupWrites });
    }
    return applied;
}

// One judge call per rendered page: the WordPress screenshots for every
// viewport, and nothing else — no mockup, no diff. The gate is absolute
// ("does this read as broken?"), not parity.
async function judgePage(ctx, pageReport, iter) {
    const page = pageReport.page;
    const shots = [...new Set((pageReport.results || []).map((r) => r.candidate).filter(Boolean))];
    if (!shots.length) return [];
    const shotLines = (pageReport.results || [])
        .filter((r) => r.candidate)
        .map((r) => `${r.viewport}: ${r.candidate}`);
    const prompt = [
        `Look at the WordPress-rendered screenshots of the "${page}" page — Read every path below (one per viewport) before answering.`,
        'List every visible DEFECT: something a typical visitor would call broken without knowing the design intent (unreadable or clipped text, overlapping or orphaned elements, layout overflowing the viewport or a container, navigation wrapped onto multiple lines, empty boxes where content obviously belongs, blank sections).',
        'Do NOT report taste — color, typography, spacing, or wording choices are not defects. If the page reads as intact, return {"defects":[]}; finding nothing is a normal outcome.',
        'Each defect: description (one plain sentence), where (the region), viewport (desktop/mobile/both).',
        `\nSCREENSHOTS:\n${shotLines.join('\n')}`,
    ].join('\n');
    const res = await ctx.harness.complete({
        id: `render_qa:${page}:${iter}`, systemPrompt: JUDGE_SYS(), prompt, schema: DEFECTS_SCHEMA,
        allowedTools: ['Read'], maxTurns: 8,
        ...judgeParams(ctx, 'repair'),
    });
    if (!res.ok) throw new Error(`render QA judge failed for "${page}" — ${res.error}`);
    return (res.data.defects || []).map((d) => ({ page, ...d }));
}

async function fixStep(ctx, slug, report, iter) {
    const ws = ctx.workspaceRoot;
    const defects = report?.defects || [];
    if (!defects.length) return false; // a threw render has nothing a QA fix can act on
    const files = editableFiles(ws, slug);
    const defectPages = new Set(defects.map((d) => d.page));
    const shots = (report.render?.pages || [])
        .filter((p) => defectPages.has(p.page))
        .flatMap((p) => (p.results || []).map((r) => r.candidate))
        .filter((v, i, a) => v && a.indexOf(v) === i)
        .slice(0, 6);
    // Chrome files are small and often the culprit (header/footer are shared);
    // content payloads are large, so only the pages with defects ride along.
    const markupSections = files
        .filter((rel) => !rel.includes('-content/content/') || defectPages.has(path.basename(rel, '.html')))
        .map((rel) => `----- ${rel} -----\n${clip(readWs(ws, rel), 20000)}`);
    const prompt = [
        'Fix the visible defects below so the render QA judge finds none. FIRST Read the screenshots to see each defect, then make the smallest change that removes it — never restyle anything that already reads correct.',
        'Prefer appendCss with ONLY the new rules (appended to the theme stylesheet, so later rules win). Use files entries ONLY when CSS cannot express the fix (a stray element to remove, a wrong navigation attribute) — full corrected file content, canonical block markup, content text verbatim.',
        `files paths MUST be from this editable set, verbatim:\n${files.join('\n')}`,
        `\nDEFECTS:\n${JSON.stringify(defects, null, 0)}`,
        shots.length ? `\nSCREENSHOTS (Read these):\n${shots.join('\n')}` : '',
        `\nCURRENT theme.json:\n${JSON.stringify(readJsonWs(ws, `theme/${slug}/theme.json`))}`,
        `\nCURRENT theme style.css:\n${clip(readWs(ws, `theme/${slug}/style.css`), 60000)}`,
        `\nEDITABLE MARKUP FILES:\n${markupSections.join('\n')}`,
    ].join('\n');
    const res = await ctx.harness.complete({
        id: `render_qa_fix:${iter}`, systemPrompt: FIX_SYS(), prompt, schema: RENDER_FIX_SCHEMA,
        allowedTools: ['Read'], maxTurns: 12,
        ...judgeParams(ctx, 'repair'),
    });
    if (!res.ok) {
        ctx.log.warn(`[theme] render QA fix ${iter} failed: ${res.error}`);
        return false;
    }
    return applyRenderFix(ctx, slug, res.data);
}

export async function renderQaLoop(ctx, slug) {
    const ws = ctx.workspaceRoot;
    // Keep-best must cover every file a fix may touch.
    const snapshotFiles = () => [`theme/${slug}/theme.json`, `theme/${slug}/style.css`, ...editableFiles(ws, slug)];

    const loop = await runBoundedLoop({
        maxIters: ctx.options.maxRepair,
        // Defect counts are integers: two consecutive rounds without a net
        // improvement mean the fixes stopped landing — stop.
        plateauDelta: 0.5,
        log: (m) => ctx.log.debug(`[theme] render QA ${m}`),
        snapshot: () => Object.fromEntries(snapshotFiles().map((rel) => [rel, readWs(ws, rel)])),
        restore: (state) => {
            for (const [rel, content] of Object.entries(state)) if (content) writeWs(ws, rel, content);
        },
        build: async (iter) => {
            // Parity with the generated mockup stays informational (the user
            // never sees it) — smoke thresholds keep the render from gating
            // on pixels while the judge gates on visible defects.
            const render = await ctx.client.call('playground_render', {
                workspaceRoot: ws, slug,
                maxMismatchPercent: 100, maxHeightDelta: 1000000,
            });
            const defects = (await Promise.all((render.pages || []).map((p) => judgePage(ctx, p, iter)))).flat();
            writeJsonWs(ws, 'reports/render-qa.json', {
                iteration: iter,
                defectCount: defects.length,
                defects,
                aggregates: render.aggregates || null,
            });
            return { passed: defects.length === 0, metric: defects.length, report: { render, defects } };
        },
        repair: (report, iter) => fixStep(ctx, slug, report, iter),
    });

    return {
        status: loop.status, qa: true, iters: loop.iters, metric: loop.metric,
        defects: loop.report?.defects ?? null,
        aggregates: loop.report?.render?.aggregates ?? null,
        ...(loop.error ? { error: loop.error } : {}),
        ...(loop.restored ? { restored: true } : {}),
    };
}

export const _schemas = { DEFECTS_SCHEMA, RENDER_FIX_SCHEMA };
