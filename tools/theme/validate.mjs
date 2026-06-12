// tools/theme/validate.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { resolvePath, readJson, readIfExists, writeJson } from '../lib/workspace.mjs';
import { ensureBlocksRegistered, loadWordPressBlocks } from '../lib/wp-serialize.mjs';

const require = createRequire(import.meta.url);

export function validateBlockTheme(args) {
    const workspaceRoot = resolvePath(args.workspaceRoot);
    const themeDir = path.join(workspaceRoot, 'theme', args.slug);
    const errors = [];
    const must = (cond, msg) => { if (!cond) errors.push(msg); };

    // required files + headers
    must(fs.existsSync(path.join(themeDir, 'templates/index.html')), 'templates/index.html is missing');
    const styleCss = readIfExists(path.join(themeDir, 'style.css')) || '';
    for (const field of ['Theme Name', 'Version', 'Text Domain', 'Requires at least']) {
        must(new RegExp(`${field}:\\s*\\S`).test(styleCss), `style.css header missing ${field}`);
    }
    const textDomain = (styleCss.match(/Text Domain:\s*(\S+)/) || [])[1];
    must(textDomain === args.slug, `style.css Text Domain (${textDomain}) must equal slug (${args.slug})`);

    // theme.json schema
    const themeJsonPath = path.join(themeDir, 'theme.json');
    let themeJson = null;
    if (fs.existsSync(themeJsonPath)) {
        themeJson = readJson(themeJsonPath);
        must(themeJson.version === 3, `theme.json version must be 3, got ${themeJson.version}`);
        const Ajv = require('ajv');
        const ajv = new Ajv({ strict: false, allErrors: true });
        const schema = readJson(path.join(path.dirname(new URL(import.meta.url).pathname), 'theme-json-schema.json'));
        delete schema.$schema; // ajv8 rejects draft-04 marker; structure still validates
        if (!ajv.validate(schema, themeJson)) {
            for (const e of ajv.errors.slice(0, 20)) errors.push(`theme.json schema: ${e.instancePath} ${e.message}`);
        }
    } else {
        errors.push('theme.json is missing');
    }

    // parse every template and part with core + plugin blocks registered
    ensureBlocksRegistered(workspaceRoot, { blocksDir: path.join(workspaceRoot, 'theme-plugin', `${args.slug}-blocks`, 'blocks') });
    const wpBlocks = loadWordPressBlocks();
    // Grammar-level parser preserves unknown block names; wpBlocks.parse() would
    // rewrite them to core/missing and hide the violation.
    const { parse: parseGrammar } = require('@wordpress/block-serialization-default-parser');
    const known = new Set(wpBlocks.getBlockTypes().map((b) => b.name));
    for (const sub of ['templates', 'parts']) {
        const dir = path.join(themeDir, sub);
        if (!fs.existsSync(dir)) continue;
        for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.html'))) {
            const rel = `${sub}/${file}`;
            const parsed = parseGrammar(readIfExists(path.join(dir, file)));
            walkParsed(parsed, (b) => {
                if (b.blockName === null && b.innerHTML.trim() !== '') errors.push(`${rel}: contains freeform/unparsed content`);
                if (b.blockName && !known.has(b.blockName)) errors.push(`${rel}: unknown block ${b.blockName}`);
            });
            if (sub === 'templates' && file !== '404.html') {
                const text = readIfExists(path.join(dir, file));
                const isContentful = /wp:post-content|wp:query/.test(text);
                must(isContentful, `${rel}: template renders no content (needs post-content or a query loop)`);
            }
        }
    }

    // templateParts <-> files reconcile + refs resolve
    const partFiles = fs.existsSync(path.join(themeDir, 'parts'))
        ? fs.readdirSync(path.join(themeDir, 'parts')).filter((f) => f.endsWith('.html')).map((f) => f.replace(/\.html$/, '')) : [];
    for (const tp of themeJson?.templateParts || []) {
        must(partFiles.includes(tp.name), `theme.json templatePart ${tp.name} has no parts/${tp.name}.html`);
    }
    for (const file of fs.existsSync(path.join(themeDir, 'templates')) ? fs.readdirSync(path.join(themeDir, 'templates')) : []) {
        const text = readIfExists(path.join(themeDir, 'templates', file));
        for (const m of text.matchAll(/wp:template-part\s+({[^}]*})/g)) {
            const slugRef = JSON.parse(m[1]).slug;
            must(partFiles.includes(slugRef), `templates/${file}: unresolved template-part ref ${slugRef}`);
        }
    }

    // fonts + no remote urls
    for (const fam of themeJson?.settings?.typography?.fontFamilies || []) {
        for (const face of fam.fontFace || []) {
            for (const src of face.src || []) {
                const rel = src.replace(/^file:\.\//, '');
                must(fs.existsSync(path.join(themeDir, rel)), `fontFace src missing on disk: ${src}`);
            }
        }
    }
    const themeTexts = [['style.css', styleCss], ['theme.json', JSON.stringify(themeJson)]];
    for (const [label, text] of themeTexts) {
        const remotes = (text.match(/https?:\/\/[^"')\s]+/g) || []).filter((u) => !u.includes('schemas.wp.org') && !u.includes('gnu.org'));
        for (const u of remotes) errors.push(`${label}: remote url ${u}`);
    }

    // content plugin payload checks
    const contentDir = path.join(workspaceRoot, 'theme-plugin', `${args.slug}-content`, 'content');
    if (fs.existsSync(contentDir)) {
        const manifest = readJson(path.join(contentDir, 'manifest.json'));
        for (const page of manifest.pages) {
            const payload = readIfExists(path.join(contentDir, `${page.slug}.html`));
            must(payload !== null, `content payload missing for ${page.slug}`);
            if (payload) {
                must(!/href="[^"]*\.html/.test(payload), `content/${page.slug}.html: internal .html link survived permalink rewrite`);
                const remotes = (payload.match(/https?:\/\/[^"')\s]+/g) || []);
                for (const u of remotes) errors.push(`content/${page.slug}.html: raw absolute url ${u} (use {{THEME_URI}})`);
            }
        }
        const pluginPhp = readIfExists(path.join(workspaceRoot, 'theme-plugin', `${args.slug}-content`, `${args.slug}-content.php`)) || '';
        must(/Requires Plugins:\s*\S/.test(pluginPhp) || !fs.existsSync(path.join(workspaceRoot, 'theme-plugin', `${args.slug}-blocks`)), 'content plugin missing Requires Plugins header');
    }

    const report = { generatedAt: new Date().toISOString(), themeDir, errors, passed: errors.length === 0 };
    if (args.write !== false) writeJson(path.join(workspaceRoot, 'reports/theme-validation.json'), report);
    return report;
}

function walkParsed(blocks, fn) {
    for (const b of blocks || []) { fn(b); walkParsed(b.innerBlocks, fn); }
}
