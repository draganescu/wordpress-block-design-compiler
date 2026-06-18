// tools/theme/generate/gate-muplugin.mjs
import { writeFileSync } from 'node:fs';

export function writeGateMuPlugin(filePath, { token, contentPrefix, contentModelPrefix }) {
    writeFileSync(filePath, gateMuPluginPhp({ token, contentPrefix, contentModelPrefix }));
    return filePath;
}

function gateMuPluginPhp({ token, contentPrefix, contentModelPrefix }) {
    const seedLine = contentModelPrefix
        ? `\n            if (function_exists('${contentModelPrefix}_import_seed_content')) {\n                ${contentModelPrefix}_import_seed_content();\n            }`
        : '';
    return `<?php
/**
 * Plugin Name: WBDC Gate
 * Description: Localhost-only gate endpoints for the design-compiler Playground validation gate. Never shipped in the theme.
 * Version: 1.0.0
 */

defined('ABSPATH') || exit;

add_action('init', function () {
    if (!isset($_GET['wbdc_gate'])) {
        return;
    }
    if (!hash_equals('${token}', (string) ($_GET['token'] ?? ''))) {
        status_header(403);
        exit;
    }
    switch ($_GET['wbdc_gate']) {
        case 'dump':
            $posts = get_posts(array(
                'post_type' => 'page',
                'posts_per_page' => -1,
                'post_status' => 'any',
                'meta_key' => '_${contentPrefix}_generated',
                'meta_value' => '1',
            ));
            $dump = array();
            foreach ($posts as $post) {
                $dump[$post->post_name] = $post->post_content;
            }
            wp_send_json($dump);
            exit;
        case 'flush':
            if (function_exists('wp_clean_theme_json_cache')) {
                wp_clean_theme_json_cache();
            }
            if (function_exists('wp_clean_themes_cache')) {
                wp_clean_themes_cache();
            }
            delete_transient('global_styles_' . get_stylesheet());
            wp_send_json(array('flushed' => true));
            exit;
        case 'reimport':
            wp_set_current_user(1);${seedLine}
            if (function_exists('${contentPrefix}_remove_pages')) {
                ${contentPrefix}_remove_pages();
            }
            $reimported = 0;
            if (function_exists('${contentPrefix}_import_pages')) {
                $reimported = count(${contentPrefix}_import_pages());
            }
            wp_send_json(array('reimported' => $reimported));
            exit;
    }
});
`;
}
