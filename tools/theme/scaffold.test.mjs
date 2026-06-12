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
