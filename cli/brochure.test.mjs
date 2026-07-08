// Brochure mode wiring, no LLM / no network: a MockHarness returns the site
// design + per-page content + a core-only block tree, and we assert the CLI
// produced N assembled pages with shared chrome and skipped custom blocks even
// though the plan proposed one.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getHarness } from './harness/index.mjs';
import { runPipeline } from './pipeline.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORE_TREE = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/profile/fixture/wordpress/block-tree.json'), 'utf8'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wbdc-brochure-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('brochure mode builds N assembled pages, shared chrome, and no custom blocks', async () => {
    const workspace = path.join(tmp, 'run');

    const harness = getHarness('mock', {
        responses: {
            site_design: {
                pages: [
                    { slug: 'index', title: 'Home', purpose: 'welcome' },
                    { slug: 'about', title: 'About', purpose: 'story' },
                ],
                sharedCss: 'body{font-family:serif}',
                headerHtml: '<header class="site"><nav><a href="index.html">Home</a><a href="about.html">About</a></nav></header>',
                footerHtml: '<footer>© Test</footer>',
                designNotes: 'warm editorial',
            },
            'page_design:': (req) => ({ mainHtml: `<h1>${req.id}</h1><p>content</p>` }),
            // Plan proposes a custom block on purpose — brochure mode must drop it.
            'plan:': { sections: [], customBlocks: [{ name: 'x/should-not-build', reason: 'nope' }] },
            'author:': { blockTree: CORE_TREE, pageCss: '' },
        },
    });

    const options = {
        harness: 'mock', model: undefined, concurrency: 2, maxRepair: 2, callTimeoutMs: 600000,
        thresholds: { mismatch: 100, height: 100000 },
        stages: new Set([1]), stage0: 'off', playground: false, compareEditor: false,
        brochure: true, pages: 2, noCustomBlocks: true, commandLog: false, verbose: false, install: false,
    };

    const report = await runPipeline({ workspaceRoot: workspace, brief: 'a tiny brochure', source: null, options, harness });

    // Two assembled mockups with shared header + per-page main + shared css.
    for (const slug of ['index', 'about']) {
        const html = fs.readFileSync(path.join(workspace, `mockup/${slug}.html`), 'utf8');
        assert.match(html, /<header class="site">/, `${slug} has shared header`);
        assert.match(html, /<footer>© Test<\/footer>/, `${slug} has shared footer`);
        assert.match(html, /<link rel="stylesheet" href="style.css">/);
    }
    assert.equal(fs.readFileSync(path.join(workspace, 'mockup/style.css'), 'utf8'), 'body{font-family:serif}');

    // Both pages ran through Stage 1.
    assert.equal(report.outcome.pagesTotal, 2);

    // No custom blocks were scaffolded despite the plan proposing one.
    const blocksDir = path.join(workspace, 'wordpress/blocks');
    const built = fs.existsSync(blocksDir) ? fs.readdirSync(blocksDir) : [];
    assert.equal(built.length, 0, `expected no custom blocks, found: ${built.join(',')}`);

    // No custom-block authoring calls happened.
    assert.equal(harness.log.filter((c) => c.id.startsWith('custom_blocks:')).length, 0);
    // Site + per-page design calls did happen.
    assert.ok(harness.log.some((c) => c.id === 'site_design'));
    assert.equal(harness.log.filter((c) => c.id.startsWith('page_design:')).length, 2);
});

test('fast brochure mode pipelines pages with merged plan+author and no plan calls', async () => {
    const workspace = path.join(tmp, 'run-fast');

    const harness = getHarness('mock', {
        responses: {
            site_design: {
                pages: [
                    { slug: 'index', title: 'Home', purpose: 'welcome' },
                    { slug: 'about', title: 'About', purpose: 'story' },
                ],
                sharedCss: 'body{font-family:serif}',
                headerHtml: '<header class="site"><nav><a href="index.html">Home</a><a href="about.html">About</a></nav></header>',
                footerHtml: '<footer>© Test</footer>',
                tokens: {
                    colors: [
                        { slug: 'Night Ink', name: 'Night Ink', color: '#101014' },
                        { color: '#c8f04a' }, // no slug/name — sanitizer must cope
                        { slug: 'junk' }, // no color — must drop
                    ],
                    fontSizes: [{ slug: 'display', size: 'clamp(2.5rem,6vw,4.5rem)' }],
                    spacing: [{ slug: 'section', size: '6rem' }],
                    mood: 'nocturnal neon',
                },
            },
            'page_design:': (req) => ({ mainHtml: `<h1>${req.id}</h1><p>content</p>` }),
            chrome_author: {
                headerBlocks: [{ blockName: 'core/group', attrs: { tagName: 'header', className: 'site' }, innerBlocks: [] }],
                footerBlocks: [{ blockName: 'core/group', attrs: { tagName: 'footer' }, innerBlocks: [] }],
            },
            // Fast authors return MAIN-ONLY content (the chrome is spliced in).
            // The heading carries the mockup's h1 text so the section-coverage
            // gate sees every section transferred. The group uses layout type
            // "flow" — the unregistered name authors guess — which
            // normalizeTree must harden to "default" (the editor canvas
            // crash-loops on unregistered layout types).
            'author:': (req) => ({
                blockTree: {
                    version: 2, contract: 'data-only',
                    blocks: [
                        {
                            blockName: 'core/group', attrs: { className: 'intro', layout: { type: 'flow' } },
                            innerBlocks: [{ blockName: 'core/heading', attrs: { level: 1, content: `page_design:${req.id.split(':')[1]}` }, innerBlocks: [] }],
                        },
                        { blockName: 'core/paragraph', attrs: { content: 'Static brochure content.' }, innerBlocks: [] },
                    ],
                },
                pageCss: '',
            }),
        },
    });

    const options = {
        harness: 'mock', model: undefined, concurrency: 4, maxRepair: 2, callTimeoutMs: 600000,
        thresholds: { mismatch: 100, height: 100000 },
        stages: new Set([1, 2]), stage0: 'off', playground: false, compareEditor: false,
        brochure: true, fast: true, pages: 2, noCustomBlocks: true, commandLog: false, verbose: false, install: false,
        models: { design: 'sonnet', build: 'sonnet', repair: 'sonnet' },
        efforts: {},
    };

    const report = await runPipeline({ workspaceRoot: workspace, brief: 'a tiny brochure', source: null, options, harness });

    assert.equal(report.outcome.pagesTotal, 2);
    assert.equal(report.outcome.pagesPassed, 2);
    // Suggestion mode: pages gate on sanity; pixel metrics are informational.
    for (const p of report.stages.stage1) {
        assert.equal(p.informationalMetrics, true, `${p.page} reports informational metrics`);
        assert.equal(p.status, 'passed');
    }

    // Fast mode never calls plan: — plan+author are merged into author:.
    // And no repair/fix calls ran: sanity gates all passed first time.
    assert.equal(harness.log.filter((c) => c.id.startsWith('plan:')).length, 0);
    assert.equal(harness.log.filter((c) => c.id.startsWith('author:')).length, 2);
    assert.equal(harness.log.filter((c) => c.id.startsWith('repair:')).length, 0);

    // Chrome authored once and spliced around each page's main content.
    assert.equal(harness.log.filter((c) => c.id === 'chrome_author').length, 1);
    const tree = JSON.parse(fs.readFileSync(path.join(workspace, 'wordpress/pages/index.block-tree.json'), 'utf8'));
    assert.equal(tree.blocks[0].attrs.tagName, 'header', 'first block is the shared header');
    assert.equal(tree.blocks[tree.blocks.length - 1].attrs.tagName, 'footer', 'last block is the shared footer');
    assert.equal(tree.blocks[1].attrs.tagName, 'main', 'authored sections wrapped in <main>');
    assert.equal(tree.blocks[1].innerBlocks[0].attrs.layout.type, 'default', 'unregistered layout type "flow" hardened to "default"');

    // The mockups still carry the shared chrome (fidelity path unchanged).
    for (const slug of ['index', 'about']) {
        const html = fs.readFileSync(path.join(workspace, `mockup/${slug}.html`), 'utf8');
        assert.match(html, /<header class="site">/, `${slug} has shared header`);
    }

    // Per-call timings were recorded for the profile report.
    const timings = JSON.parse(fs.readFileSync(path.join(workspace, 'reports/timings.json'), 'utf8'));
    assert.ok(timings.harnessCalls.length >= 3, 'harness call log captured');
    assert.ok(timings.toolCalls.some((c) => c.name === 'build_page'), 'tool call log captured');

    // Stage 2 assembled the theme deterministically: zero judgment calls
    // (no theme_plan / theme_fix), validation clean, chrome lifted as parts,
    // per-page payloads stripped of the chrome the parts now provide.
    assert.equal(harness.log.filter((c) => c.id.startsWith('theme_')).length, 0, 'no theme judgment calls');
    assert.equal(report.stages.stage2.deterministic, true);
    assert.equal(report.stages.stage2.validation.passed, true);
    const slug = report.stages.stage2.slug;
    const themeDir = path.join(workspace, 'theme', slug);
    // The site design's tokens landed in theme.json, sanitized (junk dropped,
    // missing slugs derived).
    const themeJson = JSON.parse(fs.readFileSync(path.join(themeDir, 'theme.json'), 'utf8'));
    const palette = themeJson.settings.color.palette;
    assert.deepEqual(palette.map((c) => c.slug), ['night-ink', 'token-2']);
    assert.equal(palette[0].color, '#101014');
    assert.equal(themeJson.settings.typography.fontSizes[0].slug, 'display');
    assert.equal(themeJson.settings.spacing.spacingSizes[0].size, '6rem');
    assert.equal(themeJson.settings.spacing.blockGap, null, 'blockGap stays disabled alongside spacingSizes');
    assert.ok(fs.existsSync(path.join(themeDir, 'parts/header.html')), 'header part exists');
    assert.ok(fs.existsSync(path.join(themeDir, 'parts/footer.html')), 'footer part exists');
    const indexTpl = fs.readFileSync(path.join(themeDir, 'templates/index.html'), 'utf8');
    assert.match(indexTpl, /wp:template-part.*"slug":"header"/, 'index template references header part');
    assert.match(indexTpl, /wp:post-content/, 'index template renders content');
    const payload = fs.readFileSync(path.join(workspace, `theme-plugin/${slug}-content/content/home.html`), 'utf8');
    assert.doesNotMatch(payload, /"tagName":"header"/, 'chrome stripped from the page payload');
    assert.match(payload, /"tagName":"main"/, 'main content kept in the page payload');
});

// NOTE: a per-section author fan-out was tried here (2026-07-07) and reverted —
// see the note in fastAuthorStep. Whole-page authoring is load-bearing for
// cross-section fidelity.
