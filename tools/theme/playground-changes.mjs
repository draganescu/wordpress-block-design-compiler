// tools/theme/playground-changes.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// A stable digest for an absent directory, so a workspace that simply lacks a
// category (no wordpress/pages yet, no blocks plugin) hashes deterministically
// instead of throwing — and stays equal to itself across iterations.
const EMPTY_HASH = createHash('sha256').update('').digest('hex');

// Walk a directory recursively and return [relativePath, contents] pairs sorted
// by relativePath. Ordering is deterministic (sorted) so the same tree always
// produces the same digest regardless of filesystem readdir order. relativePath
// is POSIX-normalized so the digest is stable across platforms.
function collectFiles(root, { skip } = {}) {
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return [];
    const entries = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (skip && skip(full)) continue;
            if (entry.isDirectory()) {
                walk(full);
            } else if (entry.isFile()) {
                const relative = path.relative(root, full).split(path.sep).join('/');
                entries.push([relative, fs.readFileSync(full)]);
            }
        }
    };
    walk(root);
    entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return entries;
}

// sha256 over the sorted (relativePath, fileContents) list of one or more roots.
// Both the path and the byte length are folded in so a rename or a truncation
// changes the digest even when the raw bytes collide. Returns the stable empty
// hash when nothing was collected.
function hashEntries(entries) {
    if (!entries.length) return EMPTY_HASH;
    const hash = createHash('sha256');
    for (const [relative, contents] of entries) {
        hash.update(relative, 'utf8');
        hash.update('\0');
        hash.update(String(contents.length));
        hash.update('\0');
        hash.update(contents);
        hash.update('\0');
    }
    return hash.digest('hex');
}

export function hashInputs(workspaceRoot, slug) {
    const themeDir = path.join(workspaceRoot, 'theme', slug);
    const pluginRoot = path.join(workspaceRoot, 'theme-plugin');
    const contentDir = path.join(pluginRoot, `${slug}-content`, 'content');
    const pagesDir = path.join(workspaceRoot, 'wordpress', 'pages');

    // theme = everything the theme ships: theme.json, style.css, templates,
    // parts, functions.php, bundled assets.
    const theme = hashEntries(collectFiles(themeDir));

    // content = the imported page payloads plus the optional source page trees.
    // A payload edit lands here, not in plugins, so it reads as 'content'.
    const content = hashEntries([
        ...collectFiles(contentDir),
        ...collectFiles(pagesDir).map(([rel, buf]) => [`pages/${rel}`, buf]),
    ]);

    // plugins = the PHP and block sources under theme-plugin/, EXCLUDING the
    // <slug>-content/content payload dir so a content edit does not also read as
    // structural. A structural change is one that alters plugin code itself.
    // The content-model plugin (content-model/plugin/...) is ALSO mounted into
    // Playground, so its code is folded in here too — editing a CPT/taxonomy/
    // REST/seed there must force the cold reboot that mounting new plugin code
    // requires, not be missed as 'unchanged'.
    const contentModelPluginDir = path.join(workspaceRoot, 'content-model', 'plugin');
    const plugins = hashEntries([
        ...collectFiles(pluginRoot, {
            skip: (full) => full === contentDir || full.startsWith(contentDir + path.sep),
        }),
        ...collectFiles(contentModelPluginDir).map(([rel, buf]) => [`content-model/${rel}`, buf]),
    ]);

    return { theme, content, plugins };
}

export function classifyChange(prev, next) {
    if (!prev) return 'first';
    if (prev.plugins !== next.plugins) return 'structural';
    if (prev.content !== next.content) return 'content';
    if (prev.theme !== next.theme) return 'theme-only';
    return 'unchanged';
}
