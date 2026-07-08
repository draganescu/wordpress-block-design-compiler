import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serializeBlockTreeWithWordPress, stripBlockComments } from './wp-serialize.mjs';

// The serializer only needs a workspaceRoot for custom-block discovery; a path
// with no wordpress/blocks dir registers zero custom blocks, which is correct here.
function PLUGIN_ROOTLESS() {
    return '/nonexistent-workspace-for-core-only-serialize';
}

function serializeOne(block) {
    return serializeBlockTreeWithWordPress(
        { version: 2, contract: 'data-only', blocks: [block] },
        { workspaceRoot: PLUGIN_ROOTLESS() },
    );
}

test('textAlign on a block that declares the support serializes attribute and class', () => {
    const html = serializeOne({ blockName: 'core/heading', attrs: { content: 'Hi', level: 2, textAlign: 'center' }, innerBlocks: [] });
    // Canonical WordPress form: the attribute survives into the block comment
    // AND the saved markup carries the class the editor's save output expects.
    assert.match(html, /wp:heading \{"textAlign":"center"/);
    assert.match(stripBlockComments(html), /class="[^"]*has-text-align-center/);
});

test('textAlign works across support-declaring blocks (core/paragraph)', () => {
    const html = serializeOne({ blockName: 'core/paragraph', attrs: { content: 'Hi', textAlign: 'right' }, innerBlocks: [] });
    assert.match(stripBlockComments(html), /class="[^"]*has-text-align-right/);
});

test('textAlign on a block without the support is still rejected', () => {
    assert.throws(
        () => serializeOne({ blockName: 'core/group', attrs: { tagName: 'div', textAlign: 'center' }, innerBlocks: [] }),
        /does not define "textAlign"/,
    );
});

test('unknown attributes are still rejected', () => {
    assert.throws(
        () => serializeOne({ blockName: 'core/heading', attrs: { content: 'Hi', madeUpAttr: 'x' }, innerBlocks: [] }),
        /does not define "madeUpAttr"/,
    );
});

test('a garbage textAlign value never emits a class', () => {
    const html = serializeOne({ blockName: 'core/heading', attrs: { content: 'Hi', textAlign: 'center"><script>' }, innerBlocks: [] });
    assert.doesNotMatch(stripBlockComments(html), /has-text-align/);
});
