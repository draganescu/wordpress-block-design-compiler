import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scaffoldBlockTheme } from './scaffold.mjs';
const MINI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/mini');

test('scaffoldBlockTheme writes a complete theme + plugins from the mini fixture', () => {
    const result = scaffoldBlockTheme({
        workspaceRoot: MINI, slug: 'mini', name: 'Mini', description: 'Test theme',
        tokenMap: { colors: { '#112233': 'brand' }, fontSizes: {}, spacing: { 'clamp(10px,2vh,20px)': '30' }, custom: { '--pad': 'pad' } },
        themeSettings: {
            color: { palette: [{ slug: 'brand', color: '#112233', name: 'Brand' }, { slug: 'paper', color: '#FFEEDD', name: 'Paper' }] },
            spacing: { spacingSizes: [{ slug: '30', size: 'clamp(10px,2vh,20px)', name: 'Section' }] },
            custom: { pad: 'clamp(10px,2vh,20px)' },
        },
        themeStyles: { color: { background: 'var(--wp--preset--color--paper)' } },
        fontFamilies: [{ name: 'Georgia', slug: 'georgia', fontFamily: 'Georgia, serif', fontFace: [] }],
        customCss: '.topbar { position: fixed; top: 0; padding: var(--pad); }',
        parts: [
            { slug: 'topbar', area: 'header', tagName: 'header', source: { page: 'home', index: 0 } },
            { slug: 'sitefoot', area: 'footer', tagName: 'footer', source: { page: 'home', index: 2 } },
        ],
        templates: { index: [
            { type: 'part', slug: 'topbar', tagName: 'header' },
            { type: 'post-content' },
            { type: 'part', slug: 'sitefoot', tagName: 'footer' },
        ] },
        pages: [
            { page: 'home', slug: 'home', title: 'Home', front: true, template: '', stripIndexes: [0, 2] },
            { page: 'about', slug: 'about', title: 'About', front: false, template: '', stripIndexes: [0, 2] },
        ],
        mediaMap: {},
    });

    const theme = path.join(MINI, 'theme/mini');
    assert.ok(fs.existsSync(path.join(theme, 'templates/index.html')));
    for (const t of ['archive', 'single', '404']) assert.ok(fs.existsSync(path.join(theme, `templates/${t}.html`)), t);
    assert.ok(fs.existsSync(path.join(theme, 'parts/topbar.html')));
    const themeJson = JSON.parse(fs.readFileSync(path.join(theme, 'theme.json'), 'utf8'));
    assert.equal(themeJson.templateParts.length, 2);
    const partMarkup = fs.readFileSync(path.join(theme, 'parts/sitefoot.html'), 'utf8');
    assert.match(partMarkup, /has-brand-background-color|"backgroundColor":"brand"/); // preset rewrite applied
    const payload = fs.readFileSync(path.join(MINI, 'theme-plugin/mini-content/content/home.html'), 'utf8');
    assert.ok(!payload.includes('topbar')); // chrome stripped from content
    assert.match(payload, /Welcome/);
    const css = fs.readFileSync(path.join(theme, 'style.css'), 'utf8');
    assert.match(css, /var\(--wp--custom--pad\)/);
    assert.ok(fs.existsSync(path.join(MINI, 'theme-plugin/mini-blocks/blocks/badge/index.js')));
    assert.ok(result.files.length >= 9); // 2 parts + 4 templates + theme.json/style.css/functions.php (empty mediaMap)
    fs.rmSync(path.join(MINI, 'theme'), { recursive: true, force: true });
    fs.rmSync(path.join(MINI, 'theme-plugin'), { recursive: true, force: true });
});
