import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scaffoldBlockTheme } from './scaffold.mjs';
import { miniScaffoldArgs, cleanupMini } from './fixtures/mini/scaffold-args.mjs';
const MINI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/mini');

test('scaffoldBlockTheme writes a complete theme + plugins from the mini fixture', () => {
    const result = scaffoldBlockTheme(miniScaffoldArgs(MINI));

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
    cleanupMini(MINI);
});

test('scaffoldBlockTheme keeps {{THEME_URI}} placeholders in part markup', () => {
    // Relative asset URLs in parts resolve against the page URL (/about/assets/...)
    // instead of the theme dir, so the placeholder must survive into the part
    // and functions.php must resolve it at render time.
    const ws = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/mini-media');
    fs.rmSync(ws, { recursive: true, force: true });
    fs.cpSync(path.join(MINI, 'wordpress'), path.join(ws, 'wordpress'), { recursive: true });
    const treePath = path.join(ws, 'wordpress/pages/home.block-tree.json');
    const home = JSON.parse(fs.readFileSync(treePath, 'utf8'));
    home.blocks[0].innerBlocks.push({ blockName: 'core/image', attrs: { url: 'mockup/assets/logo.png', alt: 'Logo' }, innerBlocks: [] });
    fs.writeFileSync(treePath, JSON.stringify(home, null, 4));
    fs.mkdirSync(path.join(ws, 'mockup/assets'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'mockup/assets/logo.png'), 'png-bytes');

    const args = miniScaffoldArgs(ws);
    args.mediaMap = { 'mockup/assets/logo.png': 'assets/media/logo.png' };
    scaffoldBlockTheme(args);

    const part = fs.readFileSync(path.join(ws, 'theme/mini/parts/topbar.html'), 'utf8');
    assert.match(part, /src="\{\{THEME_URI\}\}\/assets\/media\/logo\.png"/);
    assert.ok(fs.existsSync(path.join(ws, 'theme/mini/assets/media/logo.png')));
    const php = fs.readFileSync(path.join(ws, 'theme/mini/functions.php'), 'utf8');
    assert.match(php, /render_block/);
    assert.match(php, /str_replace\('\{\{THEME_URI\}\}', get_stylesheet_directory_uri\(\)/);
    fs.rmSync(ws, { recursive: true, force: true });
});

test('scaffoldBlockTheme defaults blockGap to 0 (component CSS) and rewrites orphan links', () => {
    const ws = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/mini-orphan');
    fs.rmSync(ws, { recursive: true, force: true });
    fs.cpSync(path.join(MINI, 'wordpress'), path.join(ws, 'wordpress'), { recursive: true });
    // Add a link to a page that is NOT in the manifest, in a kept (non-stripped) block.
    const treePath = path.join(ws, 'wordpress/pages/home.block-tree.json');
    const home = JSON.parse(fs.readFileSync(treePath, 'utf8'));
    home.blocks[1].innerBlocks = home.blocks[1].innerBlocks || [];
    home.blocks[1].innerBlocks.push({ blockName: 'core/paragraph', attrs: { content: '<a href="nowhere.html">gone</a>' }, innerBlocks: [] });
    fs.writeFileSync(treePath, JSON.stringify(home, null, 4));

    const result = scaffoldBlockTheme(miniScaffoldArgs(ws));

    // C10: the mini fixture ships component customCss, so block-gap is defaulted to 0.
    const themeJson = JSON.parse(fs.readFileSync(path.join(ws, 'theme/mini/theme.json'), 'utf8'));
    assert.equal(themeJson.styles?.spacing?.blockGap, '0px');

    // C9: the orphan link is recorded and rewritten to the front page, not left to fatal validate.
    assert.deepEqual(result.orphanLinks, ['nowhere.html']);
    const payload = fs.readFileSync(path.join(ws, 'theme-plugin/mini-content/content/home.html'), 'utf8');
    assert.ok(!payload.includes('nowhere.html'));
    assert.match(payload, /href="\/"/);
    fs.rmSync(ws, { recursive: true, force: true });
});

test('scaffoldBlockTheme auto-reads wordpress/style.css as customCss when the arg is omitted', () => {
    const ws = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/mini-autocss');
    fs.rmSync(ws, { recursive: true, force: true });
    fs.cpSync(path.join(MINI, 'wordpress'), path.join(ws, 'wordpress'), { recursive: true });
    // a distinctive shared stylesheet with a remote @import that must be stripped
    fs.writeFileSync(path.join(ws, 'wordpress/style.css'),
        "@import url('https://fonts.example/x.css');\n.autocss-marker { color: #112233 }");
    const args = miniScaffoldArgs(ws);
    delete args.customCss; // omitted -> scaffold must fall back to wordpress/style.css
    scaffoldBlockTheme(args);
    const css = fs.readFileSync(path.join(ws, 'theme/mini/style.css'), 'utf8');
    assert.match(css, /\.autocss-marker/);   // the shared design system shipped, not an empty theme
    assert.ok(!/@import\s+url\(/.test(css));  // remote @import stripped (theme must have no remote URLs)
    fs.rmSync(ws, { recursive: true, force: true });
});
