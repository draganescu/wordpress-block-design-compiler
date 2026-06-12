import test from 'node:test';
import assert from 'node:assert/strict';
import { styleCss, functionsPhp, buildThemeJson, templateMarkup, DEFAULT_TEMPLATES } from './theme-files.mjs';

test('styleCss emits a complete header plus custom css', () => {
    const css = styleCss({ name: 'Mini', slug: 'mini', description: 'D' }, '.x{color:red}');
    assert.match(css, /Theme Name: Mini/);
    assert.match(css, /Text Domain: mini/);
    assert.match(css, /Requires at least: 6.6/);
    assert.match(css, /\.x\{color:red\}/);
});

test('functionsPhp enqueues style.css, editor style, and warns on missing blocks', () => {
    const php = functionsPhp({ slug: 'mini', customBlocks: ['mini/badge'] });
    assert.match(php, /wp_enqueue_style/);
    assert.match(php, /add_editor_style/);
    assert.match(php, /WP_Block_Type_Registry/);
    assert.match(php, /mini\/badge/);
    const bare = functionsPhp({ slug: 'mini', customBlocks: [] });
    assert.ok(!bare.includes('WP_Block_Type_Registry'));
});

test('functionsPhp resolves {{THEME_URI}} placeholders at render time', () => {
    const php = functionsPhp({ slug: 'mini', customBlocks: [] });
    assert.match(php, /add_filter\('render_block'/);
    assert.match(php, /str_replace\('\{\{THEME_URI\}\}', get_stylesheet_directory_uri\(\), \$content\)/);
});

test('buildThemeJson merges presets, fontFace, custom and templateParts', () => {
    const json = buildThemeJson({
        settings: { color: { palette: [{ slug: 'brand', color: '#112233', name: 'Brand' }] }, custom: { pad: 'clamp(10px,2vh,20px)' } },
        styles: { color: { background: 'var(--wp--preset--color--paper)' } },
        fontFamilies: [{ name: 'Georgia', slug: 'georgia', fontFamily: 'Georgia, serif', fontFace: [] }],
        templateParts: [{ slug: 'topbar', area: 'header', tagName: 'header' }],
        customTemplates: [],
    });
    assert.equal(json.version, 3);
    assert.equal(json.settings.typography.fontFamilies[0].slug, 'georgia');
    assert.equal(json.settings.color.palette[0].slug, 'brand');
    assert.equal(json.templateParts[0].area, 'header');
    assert.equal(json.settings.appearanceTools, true);
});

test('templateMarkup composes parts and post-content', () => {
    const markup = templateMarkup([
        { type: 'part', slug: 'topbar', tagName: 'header' },
        { type: 'post-content' },
        { type: 'part', slug: 'sitefoot', tagName: 'footer' },
    ]);
    assert.equal(markup, [
        '<!-- wp:template-part {"slug":"topbar","tagName":"header"} /-->',
        '<!-- wp:post-content {"layout":{"type":"default"}} /-->',
        '<!-- wp:template-part {"slug":"sitefoot","tagName":"footer"} /-->',
    ].join('\n') + '\n');
});

test('DEFAULT_TEMPLATES provides generic archive, single and 404 bodies as trees', () => {
    for (const name of ['archive', 'single', '404']) {
        assert.ok(DEFAULT_TEMPLATES[name].some((e) => e.type === 'tree' && Array.isArray(e.blocks)), name);
    }
    assert.ok(JSON.stringify(DEFAULT_TEMPLATES.archive).includes('core/query'));
    assert.ok(JSON.stringify(DEFAULT_TEMPLATES.single).includes('core/post-title'));
    assert.ok(JSON.stringify(DEFAULT_TEMPLATES[404]).includes('core/search'));
});

test('templateMarkup rejects unserialized tree entries', () => {
    assert.throws(() => templateMarkup([{ type: 'tree', blocks: [] }]), /serialized by the scaffold/);
});
