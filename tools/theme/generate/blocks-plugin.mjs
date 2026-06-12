// tools/theme/generate/blocks-plugin.mjs
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeFile, writeJson } from '../../lib/workspace.mjs';

export function writeBlocksPlugin({ workspaceRoot, slug, themeName, outDir }) {
    const srcRoot = path.join(workspaceRoot, 'wordpress/blocks');
    const blockDirs = fs.existsSync(srcRoot)
        ? fs.readdirSync(srcRoot).filter((d) => fs.existsSync(path.join(srcRoot, d, 'block.json'))).sort()
        : [];
    if (blockDirs.length === 0) return { blocks: [] };

    const blocks = [];
    for (const dir of blockDirs) {
        const dest = path.join(outDir, 'blocks', dir);
        fs.mkdirSync(dest, { recursive: true });
        const blockJson = readJson(path.join(srcRoot, dir, 'block.json'));
        delete blockJson.editorScript; // enqueued below with explicit wp-* deps (no asset.php in no-build blocks)
        writeJson(path.join(dest, 'block.json'), blockJson);
        for (const file of ['index.js', 'style.css']) {
            const src = path.join(srcRoot, dir, file);
            if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dest, file));
        }
        blocks.push(blockJson.name);
    }

    const php = `<?php
/**
 * Plugin Name: ${themeName} Blocks
 * Description: Custom blocks required by the ${themeName} theme.
 * Version: 1.0.0
 * Requires at least: 6.6
 * Requires PHP: 7.4
 * License: GPL-2.0-or-later
 * Text Domain: ${slug}-blocks
 */

defined('ABSPATH') || exit;

add_action('init', function () {
    foreach (glob(__DIR__ . '/blocks/*/block.json') as $block_json) {
        register_block_type(dirname($block_json));
    }
});

add_action('enqueue_block_editor_assets', function () {
    foreach (glob(__DIR__ . '/blocks/*/index.js') as $index_js) {
        $slug = basename(dirname($index_js));
        wp_enqueue_script(
            '${slug}-blocks-' . $slug,
            plugins_url('blocks/' . $slug . '/index.js', __FILE__),
            array('wp-blocks', 'wp-element', 'wp-block-editor', 'wp-components'),
            '1.0.0',
            true
        );
    }
});
`;
    writeFile(path.join(outDir, `${slug}-blocks.php`), php);
    return { blocks };
}
