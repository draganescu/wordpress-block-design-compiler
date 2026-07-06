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
