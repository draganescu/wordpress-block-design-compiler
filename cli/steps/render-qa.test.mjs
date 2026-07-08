import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MockHarness } from '../harness/mock.mjs';
import { renderQaLoop, applyRenderFix, editableFiles } from './render-qa.mjs';

const SLUG = 'acme';

function write(ws, rel, text) {
    const file = path.join(ws, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
}

function read(ws, rel) {
    return fs.readFileSync(path.join(ws, rel), 'utf8');
}

function makeWorkspace() {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'wbdc-render-qa-'));
    write(ws, `theme/${SLUG}/theme.json`, '{"version":2}\n');
    write(ws, `theme/${SLUG}/style.css`, '/* Theme Name: Acme */\nbody{margin:0}\n');
    write(ws, `theme/${SLUG}/parts/header.html`, '<!-- wp:group --><div class="wp-block-group">header</div><!-- /wp:group -->');
    write(ws, `theme/${SLUG}/parts/footer.html`, '<!-- wp:group --><div class="wp-block-group">footer</div><!-- /wp:group -->');
    write(ws, `theme/${SLUG}/templates/index.html`, '<!-- wp:post-content /-->');
    write(ws, `theme-plugin/${SLUG}-content/content/home.html`, '<!-- wp:paragraph --><p>hi</p><!-- /wp:paragraph -->');
    return ws;
}

function renderReport(ws) {
    const shot = (name) => path.join(ws, 'reports/playground', name);
    return {
        passed: true,
        aggregates: { maxMismatchPercent: 12, maxHeightDelta: 40 },
        pages: [{
            page: 'home',
            results: [
                { viewport: 'desktop', candidate: shot('home-wp-desktop.png'), mockup: shot('home-mockup-desktop.png'), diff: shot('home-diff-desktop.png'), mismatchPercent: 12, heightDelta: 40 },
                { viewport: 'mobile', candidate: shot('home-wp-mobile.png'), mockup: shot('home-mockup-mobile.png'), diff: shot('home-diff-mobile.png'), mismatchPercent: 8, heightDelta: 22 },
            ],
            aggregate: { maxMismatchPercent: 12, maxHeightDelta: 40 },
        }],
    };
}

function makeClient(ws) {
    const calls = [];
    return {
        calls,
        called: (tool) => calls.filter((c) => c.tool === tool),
        call: async (tool, args) => {
            calls.push({ tool, args });
            if (tool === 'playground_render') return renderReport(ws);
            return {};
        },
    };
}

const quietLog = { ok() {}, warn() {}, info() {}, error() {}, debug() {}, step() {} };

function makeCtx(ws, responses) {
    return {
        workspaceRoot: ws,
        options: { maxRepair: 3, playground: true },
        harness: new MockHarness({ responses }),
        client: makeClient(ws),
        log: quietLog,
    };
}

const defect = (description, where = 'footer', viewport = 'desktop') => ({ description, where, viewport });

test('a clean first render passes with zero defects and no fix call', async () => {
    const ws = makeWorkspace();
    const ctx = makeCtx(ws, { 'render_qa:': { defects: [] } });

    const gate = await renderQaLoop(ctx, SLUG);

    assert.equal(gate.status, 'passed');
    assert.equal(gate.metric, 0);
    assert.equal(gate.iters, 1);
    assert.equal(ctx.client.called('playground_render').length, 1);
    assert.ok(!ctx.harness.log.some((c) => c.id.startsWith('render_qa_fix')), 'no fix call on a clean render');
    const report = JSON.parse(read(ws, 'reports/render-qa.json'));
    assert.deepEqual(report.defects, []);
});

test('judge screenshots are the WordPress candidates for both viewports', async () => {
    const ws = makeWorkspace();
    const ctx = makeCtx(ws, { 'render_qa:': { defects: [] } });

    await renderQaLoop(ctx, SLUG);

    const judge = ctx.harness.log.find((c) => c.id === 'render_qa:home:1');
    assert.ok(judge, 'one judge call per page');
    assert.match(judge.prompt, /home-wp-desktop\.png/);
    assert.match(judge.prompt, /home-wp-mobile\.png/);
    assert.ok(!/home-mockup-desktop\.png/.test(judge.prompt), 'the mockup is not shown to the judge — the gate is absolute, not parity');
});

test('a defect is fixed (css + markup edit) and the gate passes on the re-render', async () => {
    const ws = makeWorkspace();
    const fixedFooter = '<!-- wp:group --><div class="wp-block-group">centered footer</div><!-- /wp:group -->';
    const ctx = makeCtx(ws, {
        'render_qa:': (req) => (req.id.endsWith(':1') ? { defects: [defect('footer content is left-stuck against the container edge')] } : { defects: [] }),
        'render_qa_fix': {
            appendCss: '.wp-block-template-part footer{text-align:center}',
            files: [{ path: `theme/${SLUG}/parts/footer.html`, content: fixedFooter }],
        },
    });

    const gate = await renderQaLoop(ctx, SLUG);

    assert.equal(gate.status, 'passed');
    assert.equal(gate.iters, 2);
    assert.equal(gate.metric, 0);
    assert.match(read(ws, `theme/${SLUG}/style.css`), /render qa/i);
    assert.match(read(ws, `theme/${SLUG}/style.css`), /text-align:center/);
    assert.equal(read(ws, `theme/${SLUG}/parts/footer.html`), fixedFooter);
    // Hand-edited block markup must be re-canonicalized, never trusted raw.
    const canon = ctx.client.called('fix_block_markup');
    assert.equal(canon.length, 1);
    assert.deepEqual(canon[0].args.paths, [`theme/${SLUG}/parts/footer.html`]);
});

test('a defect list that never shrinks stops on plateau at the third iteration', async () => {
    const ws = makeWorkspace();
    let fixes = 0;
    const ctx = makeCtx(ws, {
        'render_qa:': { defects: [defect('nav wraps onto two lines', 'header'), defect('image overflows the viewport', 'hero', 'mobile')] },
        'render_qa_fix': () => ({ appendCss: `.attempt-${++fixes}{display:block}` }),
    });
    ctx.options.maxRepair = 5; // above the plateau point, so plateau (not the cap) is what stops it

    const gate = await renderQaLoop(ctx, SLUG);

    assert.equal(gate.status, 'plateau');
    assert.equal(gate.iters, 3);
    assert.equal(gate.metric, 2);
    assert.equal(gate.defects.length, 2);
});

test('a fix that makes the page worse is rolled back to the best iteration', async () => {
    const ws = makeWorkspace();
    const counts = [1, 3, 3, 1]; // iter1 best, fixes regress, rebuild after restore
    let judgeCall = 0;
    let fixes = 0;
    const ctx = makeCtx(ws, {
        'render_qa:': () => ({
            defects: Array.from({ length: counts[Math.min(judgeCall++, counts.length - 1)] }, (_, i) => defect(`broken thing ${i}`)),
        }),
        'render_qa_fix': () => ({ appendCss: `.bad-fix-${++fixes}{color:red}` }),
    });

    const gate = await renderQaLoop(ctx, SLUG);

    assert.equal(gate.restored, true);
    assert.equal(gate.metric, 1);
    assert.ok(!/bad-fix-/.test(read(ws, `theme/${SLUG}/style.css`)), 'regressing css was rolled back');
});

test('a failing judge blocks the gate instead of passing it', async () => {
    const ws = makeWorkspace();
    const ctx = makeCtx(ws, {}); // MockHarness answers ok:false for every id

    const gate = await renderQaLoop(ctx, SLUG);

    assert.equal(gate.status, 'blocked');
});

test('editableFiles enumerates parts, templates, and content payloads only', () => {
    const ws = makeWorkspace();
    assert.deepEqual(editableFiles(ws, SLUG).sort(), [
        `theme-plugin/${SLUG}-content/content/home.html`,
        `theme/${SLUG}/parts/footer.html`,
        `theme/${SLUG}/parts/header.html`,
        `theme/${SLUG}/templates/index.html`,
    ]);
});

test('applyRenderFix refuses paths outside the editable set', async () => {
    const ws = makeWorkspace();
    const ctx = makeCtx(ws, {});
    const applied = await applyRenderFix(ctx, SLUG, {
        appendCss: '.safe{margin:0}',
        files: [
            { path: `theme/${SLUG}/functions.php`, content: '<?php evil();' },
            { path: '../outside.html', content: 'nope' },
        ],
    });

    assert.equal(applied, true, 'the css part still applies');
    assert.ok(!fs.existsSync(path.join(ws, `theme/${SLUG}/functions.php`)));
    assert.ok(!fs.existsSync(path.join(ws, '../outside.html')));
    assert.equal(ctx.client.called('fix_block_markup').length, 0, 'nothing to canonicalize');
});

test('applyRenderFix reports no usable fix when everything was refused', async () => {
    const ws = makeWorkspace();
    const ctx = makeCtx(ws, {});
    const applied = await applyRenderFix(ctx, SLUG, {
        files: [{ path: `theme/${SLUG}/screenshot.png`, content: 'x' }],
    });
    assert.equal(applied, false);
});
