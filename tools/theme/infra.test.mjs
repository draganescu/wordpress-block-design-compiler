import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson } from '../lib/workspace.mjs';
import { ensureBlocksRegistered, serializeBlocks } from '../lib/wp-serialize.mjs';

const MINI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/mini');

test('mini fixture serializes through @wordpress/blocks', () => {
    ensureBlocksRegistered(MINI);
    const tree = readJson(path.join(MINI, 'wordpress/pages/home.block-tree.json'));
    const markup = serializeBlocks(tree.blocks, {});
    assert.match(markup, /wp:group/);
    assert.match(markup, /mini\/badge/);
});
