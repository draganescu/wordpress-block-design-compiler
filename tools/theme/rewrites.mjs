// tools/theme/rewrites.mjs
const norm = (v) => String(v ?? '').trim().toLowerCase();

export function rewriteTreePresets(block, map) {
    const out = { ...block, attrs: structuredClone(block.attrs || {}), innerBlocks: (block.innerBlocks || []).map((b) => rewriteTreePresets(b, map)) };
    const style = out.attrs.style || {};
    if (style.color) {
        if (map.colors[norm(style.color.background)]) { out.attrs.backgroundColor = map.colors[norm(style.color.background)]; delete style.color.background; }
        if (map.colors[norm(style.color.text)]) { out.attrs.textColor = map.colors[norm(style.color.text)]; delete style.color.text; }
        if (Object.keys(style.color).length === 0) delete style.color;
    }
    if (style.typography?.fontSize && map.fontSizes[norm(style.typography.fontSize)]) {
        out.attrs.fontSize = map.fontSizes[norm(style.typography.fontSize)];
        delete style.typography.fontSize;
        if (Object.keys(style.typography).length === 0) delete style.typography;
    }
    if (style.spacing) rewriteSpacing(style.spacing, map.spacing);
    if (Object.keys(style).length === 0) delete out.attrs.style;
    return out;
}
function rewriteSpacing(node, spacingMap) {
    for (const [key, value] of Object.entries(node)) {
        if (value && typeof value === 'object') rewriteSpacing(value, spacingMap);
        else if (spacingMap[norm(value)]) node[key] = `var:preset|spacing|${spacingMap[norm(value)]}`;
    }
}

export function rewriteCssVars(css, customMap) {
    let out = css;
    for (const [name, slugName] of Object.entries(customMap)) {
        out = out.split(`var(${name})`).join(`var(--wp--custom--${slugName})`);
        out = out.replace(new RegExp(`\\s*${name}\\s*:[^;}]+;?`, 'g'), '');
    }
    return out;
}

export function rewriteLinks(value, linkMap) {
    let out = String(value);
    for (const [file, permalink] of Object.entries(linkMap)) {
        for (const enc of [file, file.replace(/ /g, '%20')]) {
            out = out.split(`href="${enc}#`).join(`href="${permalink}#`);
            out = out.split(`href="${enc}"`).join(`href="${permalink}"`);
            if (out === enc) out = permalink;
            if (out.startsWith(`${enc}#`)) out = permalink + out.slice(enc.length);
        }
    }
    return out;
}

// After the manifest rewrite, any remaining internal *.html href points at a page
// the theme does not build (a single-page subset of a multi-page site). Left
// alone it survives into the payload and fails validate_block_theme. Rewrite each
// to the front page and record it so the scaffold can warn instead of fatal.
export function rewriteOrphanHtmlLinks(value, frontPermalink, collected) {
    return String(value).replace(/href="([^"]*\.html(?:[?#][^"]*)?)"/gi, (full, href) => {
        if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(href) || href.startsWith('/')) return full; // external/absolute: leave
        if (collected) collected.add(href);
        return `href="${frontPermalink}"`;
    });
}

export function rewriteMediaUrls(value, mediaMap, base) {
    let out = String(value);
    for (const [from, to] of Object.entries(mediaMap)) {
        out = out.split(from).join(`${base}/${to}`);
    }
    return out;
}
