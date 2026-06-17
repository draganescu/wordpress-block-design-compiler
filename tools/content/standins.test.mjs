import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditStandins, checkStandins, hydrateStandins, getStandin } from './standins.mjs';

function objetGridPage() {
    // A "newest arrivals" grid: container marked as a query, first child is the
    // item template whose fields carry their own marks.
    const card = {
        blockName: 'core/group',
        attrs: { className: 'obj-card' },
        innerBlocks: [
            { blockName: 'core/image', attrs: { className: 'obj-card__media', url: 'data:image/svg+xml,x', metadata: { standin: { for: 'core/post-featured-image', isLink: true } } }, innerBlocks: [] },
            { blockName: 'core/paragraph', attrs: { className: 'obj-card__cat', content: 'Glass', metadata: { standin: { for: 'core/post-terms', taxonomy: 'objet_cat' } } }, innerBlocks: [] },
            { blockName: 'core/heading', attrs: { className: 'obj-card__title', level: 3, content: 'Opaline Vase', metadata: { standin: { for: 'core/post-title' } } }, innerBlocks: [] },
        ],
    };
    return {
        page: 'index',
        tree: { version: 2, blocks: [
            { blockName: 'core/group', attrs: {
                className: 'obj-grid obj-grid--4',
                metadata: { name: 'Newest arrivals', standin: { for: 'core/query', postType: 'objet', role: 'newest-grid', query: { perPage: 4, orderBy: 'date', order: 'desc' } } },
            }, innerBlocks: [card, { ...card }, { ...card }, { ...card }] },
        ] },
    };
}

test('auditStandins finds the query container and the field marks', () => {
    const standins = auditStandins([objetGridPage()]);
    const kinds = standins.map((s) => s.kind).sort();
    assert.ok(kinds.includes('query'));
    assert.ok(kinds.includes('field'));
    const query = standins.find((s) => s.kind === 'query');
    assert.equal(query.postType, 'objet');
    assert.equal(query.role, 'newest-grid');
});

test('checkStandins rejects unknown postType/taxonomy and accepts known ones', () => {
    const standins = auditStandins([objetGridPage()]);
    assert.deepEqual(checkStandins(standins, { postTypes: [{ slug: 'objet' }], taxonomies: [{ slug: 'objet_cat' }] }), []);
    const errors = checkStandins(standins, { postTypes: [], taxonomies: [] });
    assert.ok(errors.some((e) => /unknown postType "objet"/.test(e)));
    assert.ok(errors.some((e) => /unknown taxonomy "objet_cat"/.test(e)));
});

test('hydrateStandins swaps the grid into core/query + post-template with mapped fields', () => {
    const { trees, swaps } = hydrateStandins([objetGridPage()]);
    assert.equal(swaps.length, 1);
    const query = trees[0].tree.blocks[0];
    assert.equal(query.blockName, 'core/query');
    assert.equal(query.attrs.query.postType, 'objet');
    assert.equal(query.attrs.query.perPage, 4);
    assert.ok(Number.isInteger(query.attrs.queryId));

    const tpl = query.innerBlocks[0];
    assert.equal(tpl.blockName, 'core/post-template');
    // post-template carries the grid className so the lifted CSS still applies
    assert.match(tpl.attrs.className, /obj-grid/);

    const card = tpl.innerBlocks[0];
    const names = card.innerBlocks.map((b) => b.blockName);
    assert.deepEqual(names, ['core/post-featured-image', 'core/post-terms', 'core/post-title']);
    // className passthrough keeps the card field classes
    assert.equal(card.innerBlocks[0].attrs.className, 'obj-card__media');
    assert.equal(card.innerBlocks[1].attrs.term, 'objet_cat');
    assert.equal(card.innerBlocks[2].attrs.isLink, true);
});

test('hydrate strips the standin mark and any seeded content/url', () => {
    const { trees } = hydrateStandins([objetGridPage()]);
    const card = trees[0].tree.blocks[0].innerBlocks[0].innerBlocks[0];
    for (const field of card.innerBlocks) {
        assert.equal(getStandin(field), null, `${field.blockName} should have no standin mark`);
        assert.equal(field.attrs.content, undefined);
        assert.equal(field.attrs.url, undefined);
    }
    // the post-template container also has no standin mark left
    assert.equal(getStandin(trees[0].tree.blocks[0]), null);
});

test('comments stand-in becomes core/comments with a template', () => {
    const page = { page: 'single', tree: { blocks: [
        { blockName: 'core/group', attrs: { className: 'comments', metadata: { standin: { for: 'core/comments' } } }, innerBlocks: [] },
    ] } };
    const { trees, swaps } = hydrateStandins([page]);
    assert.equal(swaps[0].for, 'core/comments');
    const comments = trees[0].tree.blocks[0];
    assert.equal(comments.blockName, 'core/comments');
    assert.ok(comments.innerBlocks.some((b) => b.blockName === 'core/comment-template'));
    assert.equal(comments.attrs.className, 'comments');
});

test('blocks without marks are left untouched', () => {
    const page = { page: 'p', tree: { blocks: [
        { blockName: 'core/heading', attrs: { content: 'Hi', className: 'x' }, innerBlocks: [] },
    ] } };
    const { trees, swaps } = hydrateStandins([page]);
    assert.equal(swaps.length, 0);
    assert.deepEqual(trees[0].tree.blocks[0], page.tree.blocks[0]);
});
