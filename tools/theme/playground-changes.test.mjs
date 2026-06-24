// tools/theme/playground-changes.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hashInputs, classifyChange } from './playground-changes.mjs';

const SLUG = 'maison-clouet';

function writeFile(root, relative, contents) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
}

// Build a minimal but realistic workspace tree: a theme, a content payload dir,
// a blocks plugin, and a wordpress/pages source dir.
function buildWorkspace() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wbdc-changes-'));
    writeFile(root, `theme/${SLUG}/theme.json`, '{"version":3}');
    writeFile(root, `theme/${SLUG}/style.css`, '/* theme */\nbody { color: black; }');
    writeFile(root, `theme/${SLUG}/templates/index.html`, '<!-- wp:paragraph --><p>x</p><!-- /wp:paragraph -->');
    writeFile(root, `theme-plugin/${SLUG}-content/${SLUG}-content.php`, '<?php // content importer');
    writeFile(root, `theme-plugin/${SLUG}-content/content/home.html`, '<p>home payload</p>');
    writeFile(root, `theme-plugin/${SLUG}-content/content/manifest.json`, '{"pages":["home"]}');
    writeFile(root, `theme-plugin/${SLUG}-blocks/${SLUG}-blocks.php`, '<?php // blocks');
    writeFile(root, `theme-plugin/${SLUG}-blocks/blocks/contact-form/index.js`, 'wp.blocks.registerBlockType();');
    writeFile(root, `content-model/plugin/${SLUG}-model/${SLUG}-model.php`, '<?php // content-model plugin');
    writeFile(root, 'wordpress/pages/home.content.html', '<p>source tree</p>');
    return root;
}

test('null prev classifies as first', () => {
    const root = buildWorkspace();
    const next = hashInputs(root, SLUG);
    assert.equal(classifyChange(null, next), 'first');
});

test('no change classifies as unchanged', () => {
    const root = buildWorkspace();
    const prev = hashInputs(root, SLUG);
    const next = hashInputs(root, SLUG);
    assert.equal(classifyChange(prev, next), 'unchanged');
});

test('editing theme/<slug>/style.css classifies as theme-only', () => {
    const root = buildWorkspace();
    const prev = hashInputs(root, SLUG);
    writeFile(root, `theme/${SLUG}/style.css`, '/* theme */\nbody { color: red; }');
    const next = hashInputs(root, SLUG);
    assert.equal(classifyChange(prev, next), 'theme-only');
});

test('editing a content payload classifies as content, not structural', () => {
    const root = buildWorkspace();
    const prev = hashInputs(root, SLUG);
    writeFile(root, `theme-plugin/${SLUG}-content/content/home.html`, '<p>home payload edited</p>');
    const next = hashInputs(root, SLUG);
    assert.equal(prev.plugins, next.plugins, 'payload edit must not move the plugins hash');
    assert.equal(classifyChange(prev, next), 'content');
});

test('editing wordpress/pages source also classifies as content', () => {
    const root = buildWorkspace();
    const prev = hashInputs(root, SLUG);
    writeFile(root, 'wordpress/pages/home.content.html', '<p>source tree edited</p>');
    const next = hashInputs(root, SLUG);
    assert.equal(classifyChange(prev, next), 'content');
});

test('editing a plugin .php under <slug>-blocks classifies as structural', () => {
    const root = buildWorkspace();
    const prev = hashInputs(root, SLUG);
    writeFile(root, `theme-plugin/${SLUG}-blocks/${SLUG}-blocks.php`, '<?php // blocks changed');
    const next = hashInputs(root, SLUG);
    assert.equal(classifyChange(prev, next), 'structural');
});

test('editing the content-model plugin classifies as structural', () => {
    const root = buildWorkspace();
    const prev = hashInputs(root, SLUG);
    writeFile(root, `content-model/plugin/${SLUG}-model/${SLUG}-model.php`, '<?php // model changed');
    const next = hashInputs(root, SLUG);
    assert.equal(prev.content, next.content, 'content-model edit must not move the content hash');
    assert.equal(classifyChange(prev, next), 'structural');
});

test('structural wins over a simultaneous theme edit', () => {
    const root = buildWorkspace();
    const prev = hashInputs(root, SLUG);
    writeFile(root, `theme/${SLUG}/style.css`, '/* changed */');
    writeFile(root, `theme-plugin/${SLUG}-blocks/blocks/contact-form/index.js`, 'wp.blocks.registerBlockType("x");');
    const next = hashInputs(root, SLUG);
    assert.equal(classifyChange(prev, next), 'structural');
});

test('missing optional dirs hash to a stable empty value', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wbdc-empty-'));
    // No theme, no theme-plugin, no wordpress/pages at all.
    const a = hashInputs(root, SLUG);
    const b = hashInputs(root, SLUG);
    assert.deepEqual(a, b);
    assert.equal(classifyChange(a, b), 'unchanged');
});
