import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeContentPlugin } from './content-plugin.mjs';

test('writeContentPlugin writes manifest, payload and admin plugin', () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-'));
    writeContentPlugin({
        slug: 'mini', themeName: 'Mini', outDir: out, hasBlocksPlugin: true,
        pages: [
            { slug: 'home', title: 'Home', front: true, template: '', markup: '<!-- wp:paragraph --><p>hi</p><!-- /wp:paragraph -->' },
            { slug: 'about', title: 'About', front: false, template: 'page-about', markup: '<!-- wp:paragraph --><p>about</p><!-- /wp:paragraph -->' },
        ],
    });
    const manifest = JSON.parse(fs.readFileSync(path.join(out, 'content/manifest.json'), 'utf8'));
    assert.equal(manifest.pages.length, 2);
    assert.equal(manifest.pages[0].front, true);
    assert.ok(fs.existsSync(path.join(out, 'content/home.html')));
    const php = fs.readFileSync(path.join(out, 'mini-content.php'), 'utf8');
    assert.match(php, /Requires Plugins:\s*mini-blocks/);
    assert.match(php, /function mini_content_import_pages/);
    assert.match(php, /function mini_content_remove_pages/);
    assert.match(php, /add_management_page/);
    assert.match(php, /\{\{THEME_URI\}\}/);
    assert.match(php, /wp_verify_nonce/);
    assert.match(php, /wp_slash\(\$markup\)/);
});

test('writeContentPlugin manifest carries through extra page fields like sourceFile, page and mockupPath', () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-'));
    writeContentPlugin({
        slug: 'mini', themeName: 'Mini', outDir: out,
        pages: [
            {
                slug: 'home', title: 'Home', front: true, template: '',
                page: 'home', sourceFile: 'wordpress/pages/home.content.html',
                mockupPath: 'mockups/home.png',
                markup: '<!-- wp:paragraph --><p>hi</p><!-- /wp:paragraph -->',
            },
        ],
    });
    const manifest = JSON.parse(fs.readFileSync(path.join(out, 'content/manifest.json'), 'utf8'));
    assert.equal(manifest.pages[0].page, 'home');
    assert.equal(manifest.pages[0].sourceFile, 'wordpress/pages/home.content.html');
    assert.equal(manifest.pages[0].mockupPath, 'mockups/home.png');
    assert.equal(manifest.pages[0].markup, undefined);
});

test('writeContentPlugin omits the blocks-plugin dependency for a core-only theme', () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-'));
    writeContentPlugin({
        slug: 'mini', themeName: 'Mini', outDir: out, hasBlocksPlugin: false,
        pages: [
            { slug: 'home', title: 'Home', front: true, template: '', markup: '<!-- wp:paragraph --><p>hi</p><!-- /wp:paragraph -->' },
        ],
    });
    const php = fs.readFileSync(path.join(out, 'mini-content.php'), 'utf8');
    // No companion blocks plugin exists, so the content plugin must NOT declare a
    // hard dependency on it — otherwise WordPress refuses to activate it and the
    // Playground import step fatals on an undefined function.
    assert.doesNotMatch(php, /Requires Plugins/);
    assert.match(php, /function mini_content_import_pages/);
});
