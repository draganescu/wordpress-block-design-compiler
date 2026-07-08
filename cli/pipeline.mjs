// The pipeline runner — owns the fixed step order the agent used to rediscover
// every run. Setup -> Stage 1 (foundation then parallel pages) -> Stage 0
// (content model + hydration) -> Stage 2 (theme) -> run report. The run is done
// when this function returns; there is no open-ended agent loop left.

import fs from 'node:fs';
import path from 'node:path';
import { McpToolClient } from './tool-client.mjs';
import { getHarness } from './harness/index.mjs';
import { Logger } from './lib/log.mjs';
import { Semaphore } from './lib/semaphore.mjs';
import { createGeminiImageClient, generateWorkspaceImages } from './lib/images.mjs';
import { CommandLog } from './lib/command-log.mjs';
import { skillContext, HARNESS_PREAMBLE, SERIALIZER_CONSTRAINTS } from './prompts/skill-context.mjs';
import { writeWs, writeJsonWs, judgeParams } from './steps/helpers.mjs';
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
    else if (e.type === 'call:invalid') log.warn(`${label(e.id)} output rejected, retrying — ${String(e.error || '').slice(0, 200)}`);
    else if (e.type === 'call:error') log.warn(`${label(e.id)} call failed${secs} — ${String(e.error || '').slice(0, 200)}`);
}

const DESIGN_SCHEMA = {
    type: 'object', additionalProperties: false, required: ['html', 'css'],
    properties: { html: { type: 'string' }, css: { type: 'string' }, js: { type: 'string' } },
};

// Brochure mode: one shared design system + N page specs, then each page's <main>.
const SITE_DESIGN_SCHEMA = {
    type: 'object', additionalProperties: false, required: ['pages', 'sharedCss', 'headerHtml', 'footerHtml'],
    properties: {
        pages: {
            type: 'array',
            items: {
                type: 'object', additionalProperties: false, required: ['slug', 'title', 'purpose'],
                properties: { slug: { type: 'string' }, title: { type: 'string' }, purpose: { type: 'string' } },
            },
        },
        sharedCss: { type: 'string' },
        headerHtml: { type: 'string' },
        footerHtml: { type: 'string' },
        siteName: { type: 'string' },
        // Free-form on purpose: the CLI sanitizes tokens deterministically
        // before they reach theme.json, so a loose shape here never costs a
        // schema-validation retry.
        tokens: { type: 'object' },
        designNotes: { type: 'string' },
    },
};

const PAGE_DESIGN_SCHEMA = {
    type: 'object', additionalProperties: false, required: ['mainHtml'],
    properties: { mainHtml: { type: 'string' }, extraCss: { type: 'string' } },
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

// A multi-page manifest entry matching import_provided_markup's shape, so Stage 1
// and Stage 2 treat brochure pages exactly like imported ones.
function pageEntry(slug, { primary = false } = {}) {
    return {
        page: slug, sourceFile: `${slug}.html`, primary, mockupPath: `mockup/${slug}.html`,
        suggested: {
            treePath: `wordpress/pages/${slug}.block-tree.json`,
            contentPath: `wordpress/pages/${slug}.content.html`,
            renderedPath: `rendered/${slug}.html`,
            editorPath: `editor/${slug}.html`,
            reportPath: `reports/${slug}.comparison.json`,
            tasksPath: `reports/${slug}.repair-tasks.md`,
        },
    };
}

function assembleBrochurePage({ title, headerHtml, mainHtml, footerHtml, extraCss }) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="style.css">
${extraCss ? `<style>\n${extraCss}\n</style>` : ''}
</head>
<body>
${headerHtml}
<main>
${mainHtml}
</main>
${footerHtml}
</body>
</html>
`;
}

// Core-block chrome vs mockup parity. The design system styles plain elements
// (a.btn-primary, a.wordmark, nav a); the serialized blocks put those classes
// on WRAPPERS and add block-library chrome of their own (button-link padding,
// site-title heading, nav item padding). Every button/nav on every brochure
// page drifts identically without this — observed as a constant vertical
// offset ghosting the whole page at 6-8% mismatch. All :where() so any
// authored rule outranks it.
const BLOCK_CHROME_PARITY_CSS = `
/* --- block-chrome parity (seeded; design system owns all visual styling) --- */
:where(.wp-block-site-title) { margin: 0; font-size: inherit; line-height: inherit; }
:where(.wp-block-site-title a) { color: inherit; text-decoration: inherit; font: inherit; }
:where(.wp-block-navigation a.wp-block-navigation-item__content) { padding: 0; }
/* The preview surfaces emit the nav as a bare <ul> (real WP adds is-layout-flex
   via layout support). Without this, the nav stacks vertically, inflates the
   header, and ghosts EVERY page below it — observed as a uniform ~25% mismatch
   across all pages whenever the design's CSS didn't happen to style the ul. */
:where(.wp-block-navigation) { display: flex; align-items: center; }
:where(.wp-block-navigation ul.wp-block-navigation__container) {
    display: flex; align-items: center; gap: inherit;
    list-style: none; margin: 0; padding: 0;
}
:where(.wp-block-navigation-item) { display: inline-flex; align-items: center; }
/* Buttons: the design class lands on the WRAPPER (WP puts className there),
   so the wrapper owns the visual and the inner link must be invisible chrome.
   NOT :where() on purpose: in real WordPress, global styles paint
   .wp-element-button with its own background/padding at class specificity —
   this rule must outrank it (theme CSS also loads after global styles). */
.wp-block-button > .wp-block-button__link {
    all: unset; cursor: pointer; display: inline; text-align: inherit;
    font: inherit; color: inherit; text-decoration: inherit;
}
/* The buttons ROW renders as a bare div on the preview surfaces (real WP adds
   is-layout-flex) — same class of bug as the nav ul. Keep rows horizontal. */
:where(.wp-block-buttons) { display: flex; flex-wrap: wrap; align-items: center; gap: inherit; }
`;

const DESIGN_SYS = () => `${HARNESS_PREAMBLE}\n\n${skillContext(['skills/html-to-blocks/references/design-prompt.md'])}`;

// The placeholder contract for --with-images: the design names each photo,
// the generation pass creates the exact files, the theme bundles them.
const IMAGE_CONTRACT = [
    'IMAGES: include photographic <img> placeholders where photography serves the design (hero, cards, texture bands).',
    'Every <img> MUST have: src="images/<descriptive-kebab-name>.jpg" (unique per subject — reuse the exact name to reuse the same photo), real alt text, data-image-prompt="subject, setting, composition — concrete and specific, NO style words (art direction is applied globally)", and optionally data-image-aspect="16:9|4:3|3:4|1:1" (default 16:9).',
    'The files do not exist yet — a generation pass creates each one from its data-image-prompt. Size and crop with CSS (object-fit: cover).',
].join(' ');

// One design-system call locks the shared chrome + CSS + page list for the
// whole brochure. Returns the site payload plus the normalized page list.
async function siteDesignStep(ctx, n) {
    const sitePrompt = [
        `Design a cohesive ${n}-page brochure website from the brief. Return the shared design system and the page list.`,
        `- pages: EXACTLY ${n} entries { slug, title, purpose }. The FIRST page is the home page; give it slug "index". Use short kebab-case slugs for the rest (e.g. about, services, work, contact).`,
        '- sharedCss: the complete design system — tokens, base/typography, layout, and the header/nav/footer styles. One Google Fonts @import is allowed; no other network assets, no build tools.',
        '- headerHtml: a <header> with a <nav> linking every page by "<slug>.html". footerHtml: a <footer>.',
        '- siteName: the site\'s name as it appears in the header wordmark.',
        '- tokens: the design tokens as structured data — { colors: [{slug,name,color}], fontSizes: [{slug,name,size}], spacing: [{slug,name,size}], radius, mood, artDirection, layoutDirection }. These seed the theme.json palette/typography/spacing the user edits in the WordPress editor, so name them like a designer would. artDirection is one sentence of photographic art direction for the site\'s imagery.',
        ctx.images ? IMAGE_CONTRACT : 'Use NO <img> elements — the design must work with color, typography, and CSS shapes alone.',
        'This is a static brochure: no forms, no data-driven grids, no login. Make one strong visual direction, not a generic template.',
        `\nBRIEF:\n${ctx.brief}`,
        '\nReturn { pages, sharedCss, headerHtml, footerHtml, siteName, tokens, designNotes? }.',
    ].join('\n');

    const site = await ctx.harness.complete({ id: 'site_design', systemPrompt: DESIGN_SYS(), prompt: sitePrompt, schema: SITE_DESIGN_SCHEMA, ...judgeParams(ctx, 'design') });
    if (!site.ok) throw new Error(`site_design failed — ${site.error}`);

    let pages = (site.data.pages || []).slice(0, n);
    if (!pages.length) throw new Error('site_design returned no pages');
    // Guarantee a stable home slug so foundation detection + front page are clean.
    pages[0] = { ...pages[0], slug: 'index' };
    writeWs(ctx.workspaceRoot, 'mockup/style.css', site.data.sharedCss || '');
    // The rendered and editor surfaces link wordpress/style.css, not the mockup
    // stylesheet. In import flows that separation is the point (the theme must
    // own the styles it lifts) — but the brochure design system is OUR generated
    // CSS, shared by every page. Seed it deterministically so pages start at
    // near-parity instead of asking the repair loop to re-derive a design
    // system per page, one multi-minute LLM call at a time.
    writeWs(ctx.workspaceRoot, 'wordpress/style.css', `${site.data.sharedCss || ''}\n${BLOCK_CHROME_PARITY_CSS}`);
    // The preview surfaces render core/site-title from this context and default
    // to the literal text "Site Title" — a guaranteed header mismatch against
    // the mockup's real wordmark on every page. Seed the real name.
    if (site.data.siteName && site.data.siteName.trim()) {
        writeJsonWs(ctx.workspaceRoot, 'wordpress/preview-context.json', { siteTitle: site.data.siteName.trim() });
    }
    if (site.data.tokens && Object.keys(site.data.tokens).length) {
        writeJsonWs(ctx.workspaceRoot, 'plan/design-tokens.json', site.data.tokens);
    }
    // Shared art direction for every generated image (see lib/images.mjs).
    ctx.shared.imageArt = {
        artDirection: site.data.tokens?.artDirection,
        mood: site.data.tokens?.mood,
    };
    if (site.data.designNotes) writeWs(ctx.workspaceRoot, 'plan/design-notes.md', `${site.data.designNotes}\n`);
    ctx.log.info(`brochure pages: ${pages.map((p) => p.slug).join(', ')}`);
    return { site: site.data, pages };
}

// One page's <main>, wrapped with the shared chrome into mockup/<slug>.html.
async function pageDesignStep(ctx, site, p, pageList) {
    const prompt = [
        `Write the <main> content for the "${p.title}" page (slug "${p.slug}") of this brochure site.`,
        `Page purpose: ${p.purpose}`,
        // Fast mode never pixel-gates against this mockup — it is the block
        // author's reference. Clean semantic structure beats pixel detailing.
        ctx.options.fast
            ? 'This mockup is internal reference for a WordPress block build (the user never sees it). Favor clean semantic <section> structure and the design-system classes over intricate bespoke detailing.'
            : '',
        ctx.images
            ? `${IMAGE_CONTRACT} Reuse an image name the site design already declared when the subject repeats.`
            : 'Use NO <img> elements — express the design with color, typography, and CSS shapes alone.',
        'Reuse the shared design system below; only add page-specific CSS in extraCss when needed. Static content only — no forms or data grids.',
        `Link to other pages by "<slug>.html" where relevant. All pages: ${pageList}.`,
        `\nBRIEF:\n${ctx.brief}`,
        `\nSHARED CSS (already linked as style.css — do not repeat it):\n${site.sharedCss}`,
        `\nSHARED HEADER (already on the page):\n${site.headerHtml}`,
        '\nReturn { mainHtml, extraCss? }.',
    ].join('\n');
    const res = await ctx.harness.complete({ id: `page_design:${p.slug}`, systemPrompt: DESIGN_SYS(), prompt, schema: PAGE_DESIGN_SCHEMA, ...judgeParams(ctx, 'design') });
    if (!res.ok) throw new Error(`page_design:${p.slug} failed — ${res.error}`);
    const html = assembleBrochurePage({
        title: p.title, headerHtml: site.headerHtml, footerHtml: site.footerHtml,
        mainHtml: res.data.mainHtml, extraCss: res.data.extraCss,
    });
    writeWs(ctx.workspaceRoot, `mockup/${p.slug}.html`, html);
}

// Brief -> a cohesive N-page brochure site. One design-system call locks the
// shared chrome + CSS + page list; each page's <main> is then generated
// concurrently and wrapped by the CLI so every page shares the same header,
// footer, and stylesheet. Static content only — no data model, no custom blocks.
async function designBrochure(ctx, n) {
    ctx.log.step(`design · ${n}-page brochure from brief`);
    const { site, pages } = await siteDesignStep(ctx, n);
    const pageList = pages.map((p) => `${p.slug}.html — ${p.title}`).join('; ');
    await Promise.all(pages.map(async (p) => {
        await pageDesignStep(ctx, site, p, pageList);
        // Generate this page's images before Stage 1 captures it.
        await generateWorkspaceImages(ctx, [`mockup/${p.slug}.html`]);
    }));
    ctx.pages = pages.map((p, i) => pageEntry(p.slug, { primary: i === 0 }));
}

// The brochure chrome (header + footer) is IDENTICAL on every page — the CLI
// assembles the mockups that way. Author its block form ONCE per run and let
// the CLI splice it around each page's <main> tree: five authors stop
// re-deriving (or forgetting) the same header, cross-page chrome is identical
// by construction, and each author's output shrinks.
const CHROME_SCHEMA = {
    type: 'object', additionalProperties: false, required: ['headerBlocks', 'footerBlocks'],
    properties: {
        headerBlocks: { type: 'array' },
        footerBlocks: { type: 'array' },
        chromeCss: { type: 'string' },
    },
};

async function chromeAuthorStep(ctx, site) {
    const sys = `${HARNESS_PREAMBLE}\n\n${SERIALIZER_CONSTRAINTS}\n\n${skillContext(['skills/html-to-blocks/references/core-block-selection.md'])}`;
    const prompt = [
        'Author the shared site chrome as core-block trees: the <header> and <footer> below, faithfully.',
        'headerBlocks: an array with ONE core/group (tagName "header", same className as the mockup header) containing core/site-title and core/navigation (core/navigation-link children for every nav item, label/url verbatim) plus any other header elements (buttons etc.).',
        'On core/navigation set overlayMenu to match the mockup CSS: "mobile" if the shared CSS collapses the nav behind a hamburger at small widths, otherwise "never".',
        'footerBlocks: an array with ONE core/group (tagName "footer", mockup className) reproducing the footer content with core group/columns/paragraph blocks.',
        'Reuse the shared CSS class names verbatim; chromeCss is ONLY for chrome-specific rules the shared stylesheet cannot express through those classes.',
        `\nHEADER HTML:\n${site.headerHtml}`,
        `\nFOOTER HTML:\n${site.footerHtml}`,
        `\nSHARED CSS (already linked on every page):\n${clipText(site.sharedCss, 60000)}`,
        '\nReturn { headerBlocks, footerBlocks, chromeCss? }.',
    ].join('\n');
    const res = await ctx.harness.complete({ id: 'chrome_author', systemPrompt: sys, prompt, schema: CHROME_SCHEMA, ...judgeParams(ctx, 'build') });
    if (!res.ok) {
        ctx.log.warn(`chrome_author failed (${res.error}); page authors will emit full pages`);
        return null;
    }
    if (res.data.chromeCss && res.data.chromeCss.trim()) {
        const file = path.join(ctx.workspaceRoot, 'wordpress/style.css');
        fs.appendFileSync(file, `\n/* --- chrome-specific (chrome_author) --- */\n${res.data.chromeCss}\n`);
    }
    // Guarantee exactly ONE top-level block per chrome side. Downstream relies
    // on it: the splice makes every page [header, main, footer], and the
    // deterministic theme assembly lifts each side as ONE template-part block.
    const oneBlock = (blocks, tagName) => {
        const list = (Array.isArray(blocks) ? blocks : []).filter(Boolean);
        if (list.length === 1) return list;
        return [{ blockName: 'core/group', attrs: { tagName }, innerBlocks: list }];
    };
    return { headerBlocks: oneBlock(res.data.headerBlocks, 'header'), footerBlocks: oneBlock(res.data.footerBlocks, 'footer') };
}

function clipText(text, max) {
    if (!text) return '';
    return text.length <= max ? text : `${text.slice(0, max)}\n/* …truncated… */`;
}

// Fast brochure path: pages share no custom blocks, so nothing forces the
// foundation-first barrier or the "design everything, then build everything"
// phasing. After the one site_design call, every page runs its own
// design -> analyze -> author -> repair chain concurrently; wall time is the
// slowest page, not the sum of phases. Gates and thresholds are unchanged.
async function runBrochureFast(ctx, n) {
    ctx.log.step(`design+build · ${n}-page brochure from brief (fast: pipelined pages)`);
    const { site, pages } = await siteDesignStep(ctx, n);
    const pageList = pages.map((p) => `${p.slug}.html — ${p.title}`).join('; ');
    ctx.pages = pages.map((p, i) => pageEntry(p.slug, { primary: i === 0 }));

    // Chrome authors once, concurrently with the page-design fan-out — the
    // page authors only need it at tree-assembly time, minutes from now.
    ctx.shared.chromePromise = chromeAuthorStep(ctx, site);

    const results = await Promise.all(pages.map(async (p, i) => {
        const entry = ctx.pages[i];
        try {
            await pageDesignStep(ctx, site, p, pageList);
            // Images must exist before this page's screenshot and build —
            // per-image failures inside the pass warn and skip, never throw.
            await generateWorkspaceImages(ctx, [`mockup/${p.slug}.html`]);
        } catch (err) {
            ctx.log.error(`[${entry.page}] design errored: ${err?.message || err}`);
            return { page: entry.page, status: 'errored', passed: false, error: String(err?.message || err) };
        }
        return safePage(ctx, entry, { foundation: i === 0, fastAuthor: true });
    }));

    // Every fast-brochure page tree is [header, main, footer] by construction
    // (the splice above). Record that fact so Stage 2 can assemble the theme
    // deterministically — the parts split is known, not something to re-derive.
    const chrome = await ctx.shared.chromePromise;
    if (chrome) ctx.shared.brochureAssembly = { site, pages };
    return results;
}

async function designMockup(ctx) {
    ctx.log.step('design · generate mockup from brief');
    const sys = `${HARNESS_PREAMBLE}\n\n${skillContext(['skills/html-to-blocks/references/design-prompt.md'])}`;
    const prompt = [
        'Generate one strong, self-contained HTML/CSS mockup (optional JS) for this brief.',
        'No network assets, no remote fonts except a Google Fonts @import, no build tools. Inspectable and deterministic.',
        ctx.images ? IMAGE_CONTRACT : '',
        `\nBRIEF:\n${ctx.brief}`,
        '\nReturn { html, css, js? }.',
    ].join('\n');
    const res = await ctx.harness.complete({ id: 'design_mockup', systemPrompt: sys, prompt, schema: DESIGN_SCHEMA, ...judgeParams(ctx, 'design') });
    if (!res.ok) throw new Error(`design_mockup failed — ${res.error}`);
    writeWs(ctx.workspaceRoot, 'mockup/index.html', res.data.html);
    writeWs(ctx.workspaceRoot, 'mockup/style.css', res.data.css);
    if (res.data.js) writeWs(ctx.workspaceRoot, 'mockup/script.js', res.data.js);
    await generateWorkspaceImages(ctx, ['mockup/index.html']);
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
    } else if (ctx.options.brochure) {
        await designBrochure(ctx, ctx.options.pages);
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

    // --with-images: real photos for the design's placeholders. No API key is
    // a warning, not an error — the design prompts then forbid <img> instead.
    // options.imageClient injects a fake for tests.
    let images = null;
    if (options.withImages) {
        if (options.imageClient) {
            images = options.imageClient;
        } else if (process.env.GEMINI_API_KEY) {
            images = createGeminiImageClient({ apiKey: process.env.GEMINI_API_KEY, model: options.imageModel });
        } else {
            log.warn('--with-images: GEMINI_API_KEY is not set — generating without images');
        }
    }

    const ctx = {
        client, harness, log, workspaceRoot, brief, options,
        images,
        imageSemaphore: new Semaphore(6),
        imageLog: [],
        judge: {
            design: { model: options.models?.design, effort: options.efforts?.design },
            build: { model: options.models?.build, effort: options.efforts?.build },
            repair: { model: options.models?.repair, effort: options.efforts?.repair },
        },
        pages: [], shared: { customBlocks: [] },
        // build_page runs serializer CPU + three browser surfaces per call; N
        // unbounded concurrent builds starve the editor capture into 60s
        // waitForSelector timeouts (observed at concurrency 5). Bound it
        // independently of the claude-session semaphore.
        buildSemaphore: new Semaphore(Math.max(1, Number(options.buildConcurrency || 2))),
    };
    const report = { workspaceRoot, startedAt: new Date().toISOString(), stages: {}, harness: options.harness };

    try {
        // Fast brochure runs fuse design + Stage 1 into one per-page pipeline;
        // everything else keeps the phased setup -> stage1 order.
        const fastBrochure = Boolean(options.fast && options.brochure && !source && options.stages.has(1));
        if (fastBrochure) {
            await ctx.client.call('create_workspace', { workspaceRoot: ctx.workspaceRoot, prompt: ctx.brief || 'html-to-blocks run', force: true });
            report.stages.stage1 = await runBrochureFast(ctx, options.pages);
        } else {
            const { foundation, rest } = await setup(ctx, source);
            if (options.stages.has(1)) {
                report.stages.stage1 = await runStage1(ctx, foundation, rest);
            }
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
        // Always leave the time profile behind, even when the run crashed —
        // failed runs are exactly the ones worth profiling.
        try {
            writeJsonWs(workspaceRoot, 'reports/timings.json', {
                startedAt: report.startedAt,
                wroteAt: new Date().toISOString(),
                harnessCalls: harness.callLog || [],
                toolCalls: client.callLog || [],
                imageCalls: ctx.imageLog || [],
            });
        } catch { /* profiling must never mask the real outcome */ }
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
