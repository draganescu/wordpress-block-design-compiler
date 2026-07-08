// tools/theme/playground-publish.mjs
// Pure logic for `wbdc publish`: package a finished run as a WordPress
// Playground Blueprint bundle and describe where it lives once uploaded.
//
// The uploaded ZIP is self-contained:
//   blueprint.json
//   site.zip   (theme/<slug>/... plus plugins/<name>/... for each shipped plugin)
//
// The share URL points playground.wordpress.net at the ZIP on a dedicated
// artifact branch via raw.githubusercontent.com — GitHub Release assets are
// not browser-fetchable from Playground (no CORS), raw branch files are.

import { buildBlueprint, WP_VERSION } from './playground.mjs';

export const DEFAULT_ARTIFACT_BRANCH = 'playground-artifacts';

// Staging path the blueprint unzips into before mv-ing pieces to their real
// homes; the leftover empty tree is invisible and harmless.
const BUNDLE_STAGE = '/wordpress/wp-content/wbdc-bundle';

// Only github.com remotes work: the share link needs raw.githubusercontent.com.
export function parseRepoFromRemote(url) {
    const m = /^(?:git@github\.com:|https:\/\/github\.com\/|ssh:\/\/git@github\.com\/)([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url || '');
    return m ? `${m[1]}/${m[2]}` : null;
}

export function defaultAssetName(slug, now = new Date()) {
    const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    return `${slug}-playground-${stamp}.zip`;
}

// Allowlist, not basename(): the name lands in git sparse-checkout patterns,
// git command lines, and markdown, so control chars and leading '-' must go.
export function assertAssetName(name) {
    if (!name.endsWith('.zip') || name.startsWith('-') || /[^A-Za-z0-9._-]/.test(name)) {
        throw new Error('--name must be a .zip filename using letters, numbers, dots, underscores, or hyphens.');
    }
}

export function assertBranchName(branch) {
    if (!branch || branch.includes('/') || branch.includes('..') || branch.startsWith('-') || /[^A-Za-z0-9._-]/.test(branch)) {
        throw new Error('--branch must be a simple branch name using letters, numbers, dots, underscores, or hyphens.');
    }
}

export function artifactUrl(repo, branch, assetName) {
    return `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(branch)}/${encodeURIComponent(assetName)}`;
}

export function playgroundUrl(rawArtifactUrl) {
    return `https://playground.wordpress.net/?blueprint-url=${encodeURIComponent(rawArtifactUrl)}`;
}

// The plugins a run ships, in activation order — the same order the serve
// blueprint activates them, so mv steps and site.zip layout always agree.
export function bundlePluginNames({ slug, hasBlocksPlugin, contentModel }) {
    return [
        ...(contentModel ? [contentModel.slug] : []),
        ...(hasBlocksPlugin ? [`${slug}-blocks`] : []),
        `${slug}-content`,
    ];
}

// Same site as `wbdc serve`, minus the mounts: stage the bundled site.zip,
// mv theme + plugins into place, then replay the serve blueprint's
// activation/import steps verbatim (imported, not copied, so they can't drift).
export function buildPublishBlueprint({ slug, siteTitle, hasBlocksPlugin, contentModel }) {
    const serve = buildBlueprint({ slug, hasBlocksPlugin, contentModel });
    return {
        $schema: 'https://playground.wordpress.net/blueprint-schema.json',
        // The theme was validated against this pinned core, never "latest".
        preferredVersions: { wp: WP_VERSION, php: '8.2' },
        landingPage: '/',
        login: true,
        steps: [
            { step: 'setSiteOptions', options: { blogname: siteTitle } },
            { step: 'mkdir', path: BUNDLE_STAGE },
            {
                step: 'unzip',
                zipFile: { resource: 'bundled', path: '/site.zip' },
                extractToPath: BUNDLE_STAGE,
            },
            { step: 'mv', fromPath: `${BUNDLE_STAGE}/theme/${slug}`, toPath: `/wordpress/wp-content/themes/${slug}` },
            ...bundlePluginNames({ slug, hasBlocksPlugin, contentModel }).map((name) => ({
                step: 'mv',
                fromPath: `${BUNDLE_STAGE}/plugins/${name}`,
                toPath: `/wordpress/wp-content/plugins/${name}`,
            })),
            ...serve.steps,
        ],
    };
}

// Decode an index.json payload, dropping malformed content and non-object
// entries so a corrupted index degrades to "no entries" instead of failing.
export function parseIndex(json) {
    let decoded;
    try {
        decoded = JSON.parse(json);
    } catch {
        return [];
    }
    if (!Array.isArray(decoded)) return [];
    return decoded.filter((item) => item !== null && typeof item === 'object' && !Array.isArray(item));
}

// Prepend an entry, replacing any previous entry for the same asset.
export function updateIndex(index, entry) {
    return [entry, ...index.filter((item) => item.asset !== entry.asset)];
}

export function renderArtifactReadme(index) {
    const lines = [
        '# Playground artifacts',
        '',
        'Generated WordPress Playground bundles — each row is a shareable, self-booting site.',
        '',
        '| Project | Created | ZIP | Playground | Size |',
        '| --- | --- | --- | --- | --- |',
    ];
    if (index.length === 0) lines.push('| _none_ |  |  |  |  |');
    for (const entry of index) {
        const project = mdCell(String(entry.project ?? entry.slug ?? ''));
        const created = mdCell(formatCreatedAt(String(entry.created_at ?? '')));
        const asset = String(entry.asset ?? '');
        const zip = asset && entry.artifact_url ? `[${mdLinkText(asset)}](${entry.artifact_url})` : mdCell(asset);
        const open = entry.playground_url ? `[Open](${entry.playground_url})` : '';
        const size = mdCell(formatBytes(Number(entry.size_bytes ?? 0)));
        lines.push(`| ${project} | ${created} | ${zip} | ${open} | ${size} |`);
    }
    return lines.join('\n') + '\n';
}

function formatCreatedAt(createdAt) {
    if (!createdAt) return '';
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime())) return createdAt;
    return date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

// Human-readable size, or '' for zero/unknown so table cells stay blank.
export function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    let value = bytes / 1024;
    for (const unit of ['KB', 'MB', 'GB']) {
        if (value < 1024 || unit === 'GB') return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
        value /= 1024;
    }
    return `${bytes} B`;
}

function mdCell(text) {
    return text.replace(/[\r\n]/g, ' ').replace(/\|/g, '\\|');
}

function mdLinkText(text) {
    return text.replace(/[\r\n]/g, ' ').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}
