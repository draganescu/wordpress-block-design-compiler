import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBlueprint, buildCliArgs, pageUrl } from './playground.mjs';

test('buildBlueprint activates theme and plugins then imports content', () => {
    const bp = buildBlueprint({ slug: 'mini', hasBlocksPlugin: true });
    const steps = bp.steps.map((s) => s.step);
    assert.deepEqual(steps, ['activatePlugin', 'activatePlugin', 'activateTheme', 'runPHP']);
    assert.equal(bp.steps[2].themeFolderName, 'mini');
    assert.match(bp.steps[3].code, /mini_content_import_pages\(\)/);
});

test('buildBlueprint without custom blocks activates one plugin', () => {
    const bp = buildBlueprint({ slug: 'mini', hasBlocksPlugin: false });
    assert.deepEqual(bp.steps.map((s) => s.step), ['activatePlugin', 'activateTheme', 'runPHP']);
});

test('buildBlueprint activates and seeds the content-model plugin when present', () => {
    const bp = buildBlueprint({ slug: 'mini', hasBlocksPlugin: true, contentModel: { slug: 'maison-content', prefix: 'maison_content' } });
    const steps = bp.steps.map((s) => s.step);
    // content-model activate first, then blocks, content, theme, seed import, page import
    assert.deepEqual(steps, ['activatePlugin', 'activatePlugin', 'activatePlugin', 'activateTheme', 'runPHP', 'runPHP']);
    assert.equal(bp.steps[0].pluginPath, 'maison-content/maison-content.php');
    assert.match(bp.steps[4].code, /maison_content_import_seed_content\(\)/);
    assert.match(bp.steps[5].code, /mini_content_import_pages\(\)/);
});

test('buildCliArgs mounts theme and plugins', () => {
    const args = buildCliArgs({ slug: 'mini', themeDir: '/ws/theme/mini', pluginDirs: ['/ws/theme-plugin/mini-blocks', '/ws/theme-plugin/mini-content'], blueprintPath: '/ws/reports/playground/blueprint.json', port: 9400 });
    assert.ok(args.includes('server'));
    assert.ok(args.includes('--port=9400'));
    assert.ok(args.includes('--mount=/ws/theme/mini:/wordpress/wp-content/themes/mini'));
    assert.ok(args.includes('--mount=/ws/theme-plugin/mini-blocks:/wordpress/wp-content/plugins/mini-blocks'));
    assert.ok(args.includes('--blueprint=/ws/reports/playground/blueprint.json'));
});

test('pageUrl uses pagename query (no rewrite dependency) and / for front', () => {
    assert.equal(pageUrl('http://127.0.0.1:9400', { slug: 'home', front: true }), 'http://127.0.0.1:9400/');
    assert.equal(pageUrl('http://127.0.0.1:9400', { slug: 'judges', front: false }), 'http://127.0.0.1:9400/?pagename=judges');
});
