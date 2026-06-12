import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeBlocksPlugin } from './blocks-plugin.mjs';
const MINI = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/mini');

test('writeBlocksPlugin copies blocks and emits a registering plugin', () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-'));
    const result = writeBlocksPlugin({ workspaceRoot: MINI, slug: 'mini', themeName: 'Mini', outDir: out });
    const main = fs.readFileSync(path.join(out, 'mini-blocks.php'), 'utf8');
    assert.match(main, /Plugin Name: Mini Blocks/);
    assert.match(main, /register_block_type/);
    assert.match(main, /enqueue_block_editor_assets/);
    const blockJson = JSON.parse(fs.readFileSync(path.join(out, 'blocks/badge/block.json'), 'utf8'));
    assert.equal(blockJson.editorScript, undefined); // script enqueued with deps instead
    assert.equal(blockJson.style, 'file:./style.css');
    assert.ok(fs.existsSync(path.join(out, 'blocks/badge/index.js')));
    assert.equal(result.blocks.length, 1);
});

test('writeBlocksPlugin returns empty for pure-core workspaces', () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-'));
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-'));
    const result = writeBlocksPlugin({ workspaceRoot: ws, slug: 'x', themeName: 'X', outDir: out });
    assert.deepEqual(result.blocks, []);
    assert.ok(!fs.existsSync(path.join(out, 'x-blocks.php')));
});
