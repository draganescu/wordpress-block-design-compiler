// tools/theme/generate/gate-muplugin.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeGateMuPlugin } from './gate-muplugin.mjs';

function generate(opts = {}) {
    const filePath = path.join(os.tmpdir(), `wbdc-gate-${process.pid}-${Math.random().toString(36).slice(2)}.php`);
    const returned = writeGateMuPlugin(filePath, {
        token: 'tok-abc123',
        contentPrefix: 'my_theme_content',
        ...opts,
    });
    assert.equal(returned, filePath);
    return readFileSync(filePath, 'utf8');
}

test('returns the file path it was given', () => {
    const filePath = path.join(os.tmpdir(), `wbdc-gate-${process.pid}-ret.php`);
    const returned = writeGateMuPlugin(filePath, { token: 't', contentPrefix: 'p_content' });
    assert.equal(returned, filePath);
});

test('handles the three gate actions', () => {
    const php = generate();
    assert.match(php, /case 'dump':/);
    assert.match(php, /case 'flush':/);
    assert.match(php, /case 'reimport':/);
});

test('guards with hash_equals referencing the token', () => {
    const php = generate();
    assert.match(php, /hash_equals\('tok-abc123',/);
    assert.match(php, /status_header\(403\)/);
});

test('dump filters on the generated meta key and returns raw post_content', () => {
    const php = generate();
    assert.match(php, /'meta_key' => '_my_theme_content_generated'/);
    assert.match(php, /\$dump\[\$post->post_name\] = \$post->post_content;/);
    assert.match(php, /wp_send_json\(\$dump\)/);
});

test('flush clears the theme.json cache', () => {
    const php = generate();
    assert.match(php, /wp_clean_theme_json_cache\(\)/);
});

test('reimport sets the admin user and calls the content plugin functions', () => {
    const php = generate();
    const reimport = php.slice(php.indexOf("case 'reimport':"));
    assert.match(reimport, /wp_set_current_user\(1\)/);
    assert.match(reimport, /my_theme_content_remove_pages\(\)/);
    assert.match(reimport, /my_theme_content_import_pages\(\)/);
});

test('hooks on init and only runs for wbdc_gate requests', () => {
    const php = generate();
    assert.match(php, /add_action\('init',/);
    assert.match(php, /if \(!isset\(\$_GET\['wbdc_gate'\]\)\)/);
});

test('seeds content-model when a model prefix is provided', () => {
    const php = generate({ contentModelPrefix: 'my_theme_model' });
    assert.match(php, /my_theme_model_import_seed_content\(\)/);
});

test('omits the seed call when no content-model prefix is given', () => {
    const php = generate();
    assert.doesNotMatch(php, /import_seed_content/);
});
