import test from 'node:test';
import assert from 'node:assert/strict';
import { rewriteTreePresets, rewriteCssVars, rewriteLinks, rewriteMediaUrls, rewriteOrphanHtmlLinks } from './rewrites.mjs';

const MAP = {
    colors: { '#112233': 'brand' },
    fontSizes: { 'clamp(40px,6vw,90px)': 'display' },
    spacing: { 'clamp(10px,2vh,20px)': '30' },
    custom: { '--pad': 'pad' },
};

test('rewriteTreePresets converts exact color/fontSize/spacing matches to presets', () => {
    const block = {
        blockName: 'core/group',
        attrs: { style: { color: { background: '#112233', text: '#ABCDEF' }, spacing: { padding: { top: 'clamp(10px,2vh,20px)', bottom: '4px' } } } },
        innerBlocks: [{ blockName: 'core/heading', attrs: { style: { typography: { fontSize: 'clamp(40px,6vw,90px)' } } }, innerBlocks: [] }],
    };
    const out = rewriteTreePresets(block, MAP);
    assert.equal(out.attrs.backgroundColor, 'brand');
    assert.equal(out.attrs.style.color.background, undefined);
    assert.equal(out.attrs.style.color.text, '#ABCDEF'); // non-matching value untouched
    assert.equal(out.attrs.style.spacing.padding.top, 'var:preset|spacing|30');
    assert.equal(out.attrs.style.spacing.padding.bottom, '4px');
    assert.equal(out.innerBlocks[0].attrs.fontSize, 'display');
    assert.equal(out.innerBlocks[0].attrs.style?.typography, undefined); // empty style object is dropped entirely
});

test('rewriteTreePresets tolerates a partial tokenMap (only colors) without throwing', () => {
    const block = {
        blockName: 'core/group',
        attrs: { style: { color: { background: '#112233' }, spacing: { padding: { top: '0.6rem' } }, typography: { fontSize: '1rem' } } },
        innerBlocks: [],
    };
    // fontSizes/spacing maps absent — must default to {} rather than crash on lookup
    const out = rewriteTreePresets(block, { colors: { '#112233': 'brand' } });
    assert.equal(out.attrs.backgroundColor, 'brand');
    assert.equal(out.attrs.style.spacing.padding.top, '0.6rem'); // untouched (no spacing map)
    assert.equal(out.attrs.style.typography.fontSize, '1rem');   // untouched (no fontSizes map)
});

test('rewriteCssVars renames mapped custom properties and drops their :root defs', () => {
    const css = `:root{--pad:10px;--keep:1}.x{padding:var(--pad);margin:var(--keep)}`;
    const out = rewriteCssVars(css, MAP.custom);
    assert.ok(!out.includes('--pad:10px'));
    assert.ok(out.includes('--keep:1'));
    assert.ok(out.includes('var(--wp--custom--pad)'));
    assert.ok(out.includes('var(--keep)'));
});

test('rewriteLinks maps page files to permalinks in attrs and html', () => {
    const linkMap = { 'judges.html': '/judges/', 'Bucharest Feline Show.html': '/' };
    assert.equal(rewriteLinks('judges.html', linkMap), '/judges/');
    assert.equal(rewriteLinks('Bucharest Feline Show.html#tickets', linkMap), '/#tickets');
    assert.equal(
        rewriteLinks('<a href="judges.html">x</a> <a href="#local">y</a>', linkMap),
        '<a href="/judges/">x</a> <a href="#local">y</a>'
    );
});

test('rewriteMediaUrls swaps workspace asset paths for the THEME_URI placeholder', () => {
    const mediaMap = { 'mockup/assets/cat.jpg': 'assets/media/cat.jpg' };
    assert.equal(
        rewriteMediaUrls('<img src="mockup/assets/cat.jpg">', mediaMap, '{{THEME_URI}}'),
        '<img src="{{THEME_URI}}/assets/media/cat.jpg">'
    );
});

test('rewriteOrphanHtmlLinks sends unbuilt-page links to the front page and records them', () => {
    const orphans = new Set();
    const out = rewriteOrphanHtmlLinks(
        '<a href="/judges/">kept</a> <a href="about.html">o1</a> <a href="resources.html?x=1">o2</a> <a href="https://ext.com/a.html">ext</a> <a href="#frag">f</a>',
        '/', orphans,
    );
    assert.ok(out.includes('<a href="/judges/">'));               // already-rewritten absolute untouched
    assert.ok(out.includes('<a href="https://ext.com/a.html">')); // external untouched
    assert.ok(out.includes('<a href="#frag">'));                  // fragment untouched
    assert.equal((out.match(/href="\/"/g) || []).length, 2);      // both orphans -> front page
    assert.deepEqual([...orphans].sort(), ['about.html', 'resources.html?x=1']);
});
