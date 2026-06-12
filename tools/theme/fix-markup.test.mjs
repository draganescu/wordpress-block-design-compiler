import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixBlockMarkup } from '../lib/fix-markup.mjs';
import { ensureBlocksRegistered } from '../lib/wp-serialize.mjs';

const MINI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/mini');

test('fixBlockMarkup regenerates drifted markup from attributes', () => {
    ensureBlocksRegistered(MINI);
    // hand-written group: the comment declares padding the div's inline style lacks
    const drifted = `<!-- wp:group {"style":{"spacing":{"padding":{"top":"6rem"}}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group"><!-- wp:heading {"level":1} -->
<h1 class="wp-block-heading">Hello</h1>
<!-- /wp:heading --></div>
<!-- /wp:group -->`;
    const result = fixBlockMarkup(drifted);
    assert.equal(result.changed, true);
    assert.match(result.markup, /style="padding-top:6rem"/);
    assert.match(result.markup, /<h1 class="wp-block-heading">Hello<\/h1>/);
});

test('fixBlockMarkup is idempotent on canonical markup', () => {
    ensureBlocksRegistered(MINI);
    const once = fixBlockMarkup('<!-- wp:paragraph --><p>plain</p><!-- /wp:paragraph -->').markup;
    const twice = fixBlockMarkup(once);
    assert.equal(twice.changed, false);
    assert.equal(twice.markup, once);
});

test('fixBlockMarkup reports validation issues and preserves freeform', () => {
    ensureBlocksRegistered(MINI);
    const bad = `<!-- wp:heading {"level":2} -->
<h3 class="wp-block-heading">Wrong tag for level</h3>
<!-- /wp:heading -->
<p>freeform stays</p>`;
    const result = fixBlockMarkup(bad);
    assert.ok(result.issues.length >= 1);
    assert.match(result.markup, /<h2 class="wp-block-heading">Wrong tag for level<\/h2>/);
    assert.match(result.markup, /freeform stays/);
});
