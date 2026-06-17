import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDynamicBlock, DYNAMIC_SHIM_BLOCKS, EDITOR_SHIM_BLOCKS } from './dynamic-render.mjs';
import { serializeBlockTreeWithWordPress, stripBlockComments } from './wp-serialize.mjs';

test('renderDynamicBlock returns null for non-allowlisted blocks', () => {
    assert.equal(renderDynamicBlock('core/paragraph', { content: 'x' }, [], {}), null);
    assert.equal(renderDynamicBlock('baseplate/whatever', {}, [], {}), null);
});

test('navigation renders inner links and submenus with canonical classes', () => {
    const html = renderDynamicBlock('core/navigation', { ariaLabel: 'Primary' }, [
        { blockName: 'core/navigation-link', attrs: { label: 'Shop', url: '/shop' }, innerBlocks: [] },
        { blockName: 'core/navigation-submenu', attrs: { label: 'More', url: '#' }, innerBlocks: [
            { blockName: 'core/navigation-link', attrs: { label: 'About', url: '/about' }, innerBlocks: [] },
        ] },
    ], {});
    assert.match(html, /<nav class="wp-block-navigation" aria-label="Primary">/);
    assert.match(html, /wp-block-navigation-item__label">Shop</);
    assert.match(html, /has-child/);
    assert.match(html, /wp-block-navigation__submenu-container/);
    assert.match(html, /wp-block-navigation-item__label">About</);
});

test('search respects button-inside and label, escapes attrs', () => {
    const html = renderDynamicBlock('core/search', {
        label: 'Find', placeholder: 'a"b', buttonText: 'Go', buttonPosition: 'button-inside',
    }, [], {});
    assert.match(html, /wp-block-search__button-inside/);
    assert.match(html, /wp-block-search__label">Find</);
    assert.match(html, /placeholder="a&quot;b"/);
    assert.match(html, /wp-element-button">Go</);
});

test('site-title uses preview context and level (0 => p)', () => {
    const h1 = renderDynamicBlock('core/site-title', { level: 1 }, [], { siteTitle: 'Maison Clouet', homeUrl: '/' });
    assert.match(h1, /<h1 class="wp-block-site-title"><a href="\/" rel="home">Maison Clouet<\/a><\/h1>/);
    const p = renderDynamicBlock('core/site-title', { level: 0 }, [], { siteTitle: 'X', homeUrl: '/' });
    assert.match(p, /^<p class="wp-block-site-title">/);
});

test('query-pagination renders prev/numbers/next children', () => {
    const html = renderDynamicBlock('core/query-pagination', {}, [
        { blockName: 'core/query-pagination-previous', attrs: {}, innerBlocks: [] },
        { blockName: 'core/query-pagination-numbers', attrs: {}, innerBlocks: [] },
        { blockName: 'core/query-pagination-next', attrs: {}, innerBlocks: [] },
    ], {});
    assert.match(html, /wp-block-query-pagination-previous/);
    assert.match(html, /page-numbers current/);
    assert.match(html, /wp-block-query-pagination-next/);
});

test('post-terms applies prefix/suffix and preview term', () => {
    const html = renderDynamicBlock('core/post-terms', { prefix: 'In ', suffix: '.' }, [], { postTerms: 'Glass' });
    assert.match(html, /In <a href="#">Glass<\/a>\./);
});

test('author className and preset colors pass through to the root', () => {
    const html = renderDynamicBlock('core/navigation', { className: 'nav-desktop', textColor: 'ink' }, [], {});
    assert.match(html, /class="wp-block-navigation nav-desktop has-text-color has-ink-color"/);
});

test('EDITOR_SHIM_BLOCKS is a subset of DYNAMIC_SHIM_BLOCKS', () => {
    for (const name of EDITOR_SHIM_BLOCKS) assert.ok(DYNAMIC_SHIM_BLOCKS.includes(name));
});

test('serializer: shimDynamic injects frontend HTML; default stays canonical', () => {
    const tree = { version: 2, contract: 'data-only', blocks: [
        { blockName: 'core/search', attrs: { label: 'Search', buttonText: 'Go' }, innerBlocks: [] },
    ] };
    const clean = serializeBlockTreeWithWordPress(tree, { workspaceRoot: PLUGIN_ROOTLESS() });
    assert.match(clean, /<!-- wp:search/);
    assert.doesNotMatch(clean, /wp-block-search__input/);

    const shimmed = serializeBlockTreeWithWordPress(tree, { workspaceRoot: PLUGIN_ROOTLESS() }, { shimDynamic: true, previewContext: {} });
    assert.match(shimmed, /<!-- wp:search/);
    assert.match(stripBlockComments(shimmed), /wp-block-search__input/);
});

test('serializer restores original saves after a shimmed pass', () => {
    const tree = { version: 2, contract: 'data-only', blocks: [
        { blockName: 'core/search', attrs: { label: 'Search' }, innerBlocks: [] },
    ] };
    serializeBlockTreeWithWordPress(tree, { workspaceRoot: PLUGIN_ROOTLESS() }, { shimDynamic: true });
    const afterClean = serializeBlockTreeWithWordPress(tree, { workspaceRoot: PLUGIN_ROOTLESS() });
    assert.doesNotMatch(afterClean, /wp-block-search__input/);
});

// The serializer only needs a workspaceRoot for custom-block discovery; a path
// with no wordpress/blocks dir registers zero custom blocks, which is correct here.
function PLUGIN_ROOTLESS() {
    return '/nonexistent-workspace-for-core-only-serialize';
}
