// tools/theme/generate/theme-files.mjs
export function styleCss({ name, slug, description = '' }, customCss = '') {
    return `/*
Theme Name: ${name}
Description: ${description}
Version: 1.0.0
Requires at least: 6.6
Requires PHP: 7.4
License: GPL-2.0-or-later
License URI: https://www.gnu.org/licenses/gpl-2.0.html
Text Domain: ${slug}
*/

${customCss.trim()}
`;
}

export function functionsPhp({ slug, customBlocks = [] }) {
    const fn = slug.replace(/-/g, '_');
    const notice = customBlocks.length === 0 ? '' : `
add_action('admin_notices', function () {
    if (WP_Block_Type_Registry::get_instance()->is_registered('${customBlocks[0]}')) {
        return;
    }
    echo '<div class="notice notice-warning"><p>The active theme needs its companion blocks plugin (registers ${customBlocks.join(', ')}). Custom blocks will not render until it is activated.</p></div>';
});
`;
    return `<?php
defined('ABSPATH') || exit;

add_action('wp_enqueue_scripts', function () {
    wp_enqueue_style('${fn}-style', get_stylesheet_uri(), array(), wp_get_theme()->get('Version'));
});

// Templates and parts ship {{THEME_URI}} placeholders for bundled assets;
// resolve them to the absolute theme URL when blocks render.
add_filter('render_block', function ($content) {
    return str_replace('{{THEME_URI}}', get_stylesheet_directory_uri(), $content);
});

add_action('after_setup_theme', function () {
    add_editor_style('style.css');
});

// The source design's typography is authored verbatim (straight quotes,
// spaced dashes); texturizing would shift glyphs in display-size headings.
add_filter('run_wptexturize', '__return_false');
${notice}`;
}

export function buildThemeJson({ settings = {}, styles = {}, fontFamilies = [], templateParts = [], customTemplates = [] }) {
    const merged = {
        $schema: 'https://schemas.wp.org/trunk/theme.json',
        version: 3,
        settings: {
            appearanceTools: true,
            ...settings,
            typography: { ...(settings.typography || {}), fontFamilies },
        },
        styles,
        templateParts,
        customTemplates,
    };
    if (merged.templateParts.length === 0) delete merged.templateParts;
    if (merged.customTemplates.length === 0) delete merged.customTemplates;
    return merged;
}

export function templateMarkup(entries) {
    return entries.map((entry) => {
        if (entry.type === 'part') {
            const attrs = { slug: entry.slug, ...(entry.tagName ? { tagName: entry.tagName } : {}) };
            return `<!-- wp:template-part ${JSON.stringify(attrs)} /-->`;
        }
        if (entry.type === 'post-content') return '<!-- wp:post-content {"layout":{"type":"default"}} /-->';
        if (entry.type === 'raw') return entry.markup.trim();
        if (entry.type === 'blocks') return entry.markup.trim();
        throw new Error(`Unknown template entry type: ${entry.type}`);
    }).join('\n') + '\n';
}

// Generic-situation defaults (spec: standing template set). Bodies are plain core
// blocks styled by global styles; chrome entries get prepended by the scaffold.
export const DEFAULT_TEMPLATES = {
    archive: [{
        type: 'blocks',
        markup: `<!-- wp:group {"tagName":"main","layout":{"type":"constrained"},"style":{"spacing":{"padding":{"top":"6rem","bottom":"6rem"}}}} -->
<div class="wp-block-group" style="padding-top:6rem;padding-bottom:6rem"><!-- wp:query-title {"type":"archive"} /-->
<!-- wp:query {"query":{"perPage":10,"postType":"post","inherit":true}} -->
<div class="wp-block-query"><!-- wp:post-template -->
<!-- wp:post-title {"isLink":true} /-->
<!-- wp:post-date /-->
<!-- wp:post-excerpt /-->
<!-- /wp:post-template -->
<!-- wp:query-pagination -->
<!-- wp:query-pagination-previous /-->
<!-- wp:query-pagination-numbers /-->
<!-- wp:query-pagination-next /-->
<!-- /wp:query-pagination --></div>
<!-- /wp:query --></div>
<!-- /wp:group -->`,
    }],
    single: [{
        type: 'blocks',
        markup: `<!-- wp:group {"tagName":"main","layout":{"type":"constrained"},"style":{"spacing":{"padding":{"top":"6rem","bottom":"6rem"}}}} -->
<div class="wp-block-group" style="padding-top:6rem;padding-bottom:6rem"><!-- wp:post-title /-->
<!-- wp:post-date /-->
<!-- wp:post-content {"layout":{"type":"default"}} /--></div>
<!-- /wp:group -->`,
    }],
    404: [{
        type: 'blocks',
        markup: `<!-- wp:group {"tagName":"main","layout":{"type":"constrained"},"style":{"spacing":{"padding":{"top":"6rem","bottom":"6rem"}}}} -->
<div class="wp-block-group" style="padding-top:6rem;padding-bottom:6rem"><!-- wp:heading {"level":1} -->
<h1 class="wp-block-heading">Page not found</h1>
<!-- /wp:heading -->
<!-- wp:paragraph -->
<p>The page you are looking for does not exist.</p>
<!-- /wp:paragraph -->
<!-- wp:search {"label":"Search","showLabel":false,"buttonText":"Search"} /--></div>
<!-- /wp:group -->`,
    }],
};
