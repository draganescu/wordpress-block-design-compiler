# blocks-to-theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `blocks-to-theme` skill + MCP tools that extract a valid, installable WordPress block theme (plus blocks plugin and content plugin) from a completed html-to-blocks workspace, gated by static validation and a WordPress Playground screenshot comparison.

**Architecture:** Same MCP server (`tools/mcp-server.mjs`) gains six tools implemented in `tools/theme/*.mjs`. Shared infrastructure (workspace fs helpers, Playwright capture/compare, WordPress serialization) is extracted from the server monolith into `tools/lib/` first, so both skills use one implementation. Tools are deterministic; the agent (driven by `skills/blocks-to-theme/SKILL.md`) makes all design judgments. Spec: `docs/superpowers/specs/2026-06-12-blocks-to-theme-design.md`.

**Tech Stack:** Node ESM, `node --test` (new), `@wordpress/blocks` + `@wordpress/block-library` (existing), Playwright + pixelmatch/pngjs (existing), `ajv` (new, theme.json schema validation), `@wp-playground/cli` (new, render gate).

**Conventions:** 4-space indentation. Commit messages are plain imperative sentences (match `git log` style — no `feat:` prefixes). After every task: `npm run check` must pass. The existing example workspace `examples/bucharest-feline-show` is the acceptance fixture; never modify it from tasks (read-only input).

---

## File structure

```
tools/lib/workspace.mjs        fs/path/string helpers extracted from mcp-server.mjs
tools/lib/capture.mjs          static server, Playwright capture (file + URL), PNG compare, freeze CSS
tools/lib/wp-serialize.mjs     WP block registration + tree serialization extracted from mcp-server.mjs
tools/theme/evidence.mjs       analyze_theme_evidence (CSS parser + tree scanner)
tools/theme/parts.mjs          infer_template_parts (subtree hashing/grouping/variance)
tools/theme/fonts.mjs          fetch_theme_fonts (Google Fonts css2 → local woff2 + fontFace)
tools/theme/rewrites.mjs       pure rewrite passes: preset refs, custom-prop renames, links, media
tools/theme/generate/theme-files.mjs     style.css header, functions.php, theme.json, templates/parts writers
tools/theme/generate/blocks-plugin.mjs   <slug>-blocks plugin generator
tools/theme/generate/content-plugin.mjs  <slug>-content plugin generator (admin screen + payload)
tools/theme/scaffold.mjs       scaffold_block_theme orchestrator
tools/theme/validate.mjs       validate_block_theme static gate
tools/theme/theme-json-schema.json  vendored schema (committed artifact)
tools/theme/playground.mjs     playground_render gate (blueprint builder + CLI driver + compare)
tools/theme/*.test.mjs         node --test unit tests per module
tools/theme/fixtures/mini/     tiny synthetic 2-page workspace used by unit tests
skills/blocks-to-theme/SKILL.md + references/*.md (5 docs)
tools/mcp-server.mjs           imports tools/lib, registers 6 new tools
.codex-plugin/plugin.json, README.md, package.json   wiring
```

---

### Task 1: Extract workspace helpers into tools/lib/workspace.mjs

**Files:**
- Create: `tools/lib/workspace.mjs`
- Modify: `tools/mcp-server.mjs` (delete moved functions, add import)

- [ ] **Step 1: Create the module by moving code verbatim**

Move these functions from `tools/mcp-server.mjs` (locations as of HEAD; find by name): `resolvePath` (~:2422), `resolveWorkspacePath` (~:2427), `readIfExists` (~:2436), `readJson` (~:2440), `readJsonIfExists` (~:2444), `writeFile` (~:2448), `writeJson` (~:2453), `firstMatch` (~:2457), `cleanText` (~:2462), `titleCase` (~:2471), `slug` (~:2478), `camelName` (~:2482), `escapeHtml` (~:2492), `escapeAttr` (~:991), `relativeUrl` (~:986), `findFiles` (~:2411). Copy bodies unchanged into `tools/lib/workspace.mjs` with this header, exporting every function:

```js
// tools/lib/workspace.mjs — shared fs/path/string helpers for all skills' tools.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

export function resolvePath(value) { /* moved body, PLUGIN_ROOT now local */ }
// ... one export per moved function, bodies verbatim ...
```

`resolvePath` referenced a module-level `PLUGIN_ROOT` in the server; it now uses the local export above (verify the server's constant resolves to the repo root — it does: the server lives in `tools/`).

- [ ] **Step 2: Rewire mcp-server.mjs**

Delete the moved function definitions from `tools/mcp-server.mjs` and add at the top:

```js
import {
    PLUGIN_ROOT, resolvePath, resolveWorkspacePath, readIfExists, readJson,
    readJsonIfExists, writeFile, writeJson, firstMatch, cleanText, titleCase,
    slug, camelName, escapeHtml, escapeAttr, relativeUrl, findFiles,
} from './lib/workspace.mjs';
```

Remove the server's own `PLUGIN_ROOT` definition and any duplicate imports it leaves unused.

- [ ] **Step 3: Verify**

Run: `npm run check && node --check tools/lib/workspace.mjs`
Then a behavior smoke (serialization exercises most helpers):

```bash
./artifacts/mcp-call.sh serialize_wordpress_blocks '{"workspaceRoot": "examples/bucharest-feline-show", "treePath": "wordpress/pages/judges.block-tree.json", "contentPath": "wordpress/pages/judges.content.html", "outPath": "rendered/judges.html", "editorPath": "editor/judges.html"}' | head -5
```

Expected: JSON output with `treePath`, no errors. `git diff --stat examples/` must be content-identical regeneration (or restore with `git checkout examples/`).

- [ ] **Step 4: Commit**

```bash
git add tools/lib/workspace.mjs tools/mcp-server.mjs
git commit -m "Extract workspace helpers into tools/lib"
```

---

### Task 2: Extract capture/compare into tools/lib/capture.mjs, generalize to URLs

**Files:**
- Create: `tools/lib/capture.mjs`
- Modify: `tools/mcp-server.mjs`

- [ ] **Step 1: Create the module**

Move verbatim from `tools/mcp-server.mjs`: `DEFAULT_VIEWPORTS` (~:11-14), the static file server factory (the function containing `http.createServer` ~:1709-1760, exported as `serveDirectory`), `capture` (~:1788), `captureEditor` (~:1809), `editorComparisonCss` (~:1833), `motionFreezeCss` (~:1863), `transientOverlayCaptureCss` (~:1867), `comparePngs` (~:1889), `cropPng` (~:1919). Also move the dependency loader pattern used by `compareHtml` (~:1398-1410) into one helper:

```js
// tools/lib/capture.mjs — Playwright capture + PNG comparison shared by both skills.
export async function loadCaptureDeps(pluginRoot) {
    try {
        const { chromium } = await import('playwright');
        const { PNG } = await import('pngjs');
        const pixelmatch = (await import('pixelmatch')).default;
        return { chromium, PNG, pixelmatch };
    } catch (error) {
        throw new Error(`Screenshot comparison needs optional packages. Run npm install in ${pluginRoot}. Missing dependency: ${error.message}`);
    }
}
```

Generalize `capture` by splitting out a URL-based core (the playground gate navigates `http://` URLs, not workspace files):

```js
export async function captureUrl(browser, url, screenshotPath, viewport, { editor = false } = {}) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
    try {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto(url, { waitUntil: 'networkidle' });
        if (editor) {
            await page.waitForSelector('.block-editor-block-list__layout', { timeout: 60000 });
            await page.addStyleTag({ content: editorComparisonCss() });
        } else {
            await page.addStyleTag({ content: `${motionFreezeCss()}\n${transientOverlayCaptureCss()}` });
        }
        await page.waitForTimeout(150);
        await page.screenshot({ path: screenshotPath, fullPage: viewport.fullPage !== false, animations: 'disabled' });
    } finally {
        await page.close();
    }
}
```

Re-implement the moved `capture`/`captureEditor` as thin wrappers over `captureUrl` (preserving their exact current navigation: `capture` loads the html file path the same way it does today — check whether it uses `pathToFileURL` or a served URL and keep that behavior through the wrapper).

- [ ] **Step 2: Rewire mcp-server.mjs**

Replace the moved code with imports; `compareHtml`, `measureLayout`, `screenshotHtml` keep their signatures and behavior.

- [ ] **Step 3: Verify with a real comparison**

```bash
npm run check && node --check tools/lib/capture.mjs
./artifacts/mcp-call.sh compare_html '{"workspaceRoot": "examples/bucharest-feline-show", "mockupPath": "mockup/judges.html", "renderedPath": "rendered/judges.html", "editorPath": "editor/judges.html"}' 600 >/dev/null
python3 -c "import json; d=json.load(open('examples/bucharest-feline-show/reports/judges.comparison.json')); print(d['aggregates'])"
```

Expected: aggregates unchanged from HEAD (rendered/editor maxMismatchPercent 0.25, maxHeightDelta 0). Restore `examples/` churn afterwards: `git checkout examples/`.

- [ ] **Step 4: Commit**

```bash
git add tools/lib/capture.mjs tools/mcp-server.mjs
git commit -m "Extract capture and compare into tools/lib with URL support"
```

---

### Task 3: Extract WP serialization into tools/lib/wp-serialize.mjs

**Files:**
- Create: `tools/lib/wp-serialize.mjs`
- Modify: `tools/mcp-server.mjs`

- [ ] **Step 1: Create the module**

Move verbatim (names as in HEAD): `serializeBlockTreeWithWordPress`, `toWordPressBlock`, `assertDataOnlyBlock`, `validateBlockContract`, `registerWorkspaceCustomBlocks`, `registerWorkspaceCustomBlock`, `normalizeCustomBlockSettings`, `createBlockEditorShim`, `blockPropsWithSupports`, `blockSupportClassName`, `supportClassNames`, `mergeClasses`, `styleSupportToReactStyle`, `assignIf`, `assignBox`, `assignBorder`, `cssPresetValue`, `createComponentShim`, `richText`, `loadWordPressBlocks`, `loadWordPressElement`, `registerWordPressCoreBlocks`, `stripBlockComments`. The module keeps its own `createRequire(import.meta.url)` for the `@wordpress/*` loads. Export: `serializeBlockTreeWithWordPress`, `registerWorkspaceCustomBlocks`, `registerWordPressCoreBlocks`, `loadWordPressBlocks`, `stripBlockComments`, plus a convenience used by the new tools:

```js
let registered = false;
export function ensureBlocksRegistered(workspaceRoot, { blocksDir } = {}) {
    if (!registered) { registerWordPressCoreBlocks(); registered = true; }
    registerWorkspaceCustomBlocks(workspaceRoot, blocksDir); // extend signature: optional explicit dir
}
export function serializeBlocks(blocks, context) {
    return serializeBlockTreeWithWordPress({ version: 2, contract: 'data-only', blocks }, context);
}
```

`registerWorkspaceCustomBlocks(workspaceRoot, blocksDir)` gains the optional second arg (defaults to `wordpress/blocks` under the workspace, current behavior) so the validator can register blocks from the generated *plugin* directory instead.

- [ ] **Step 2: Rewire mcp-server.mjs, verify, commit**

Same verification as Task 1 Step 3 (serialize judges, diff `examples/` clean, restore).

```bash
git add tools/lib/wp-serialize.mjs tools/mcp-server.mjs
git commit -m "Extract WordPress serialization into tools/lib"
```

---

### Task 4: Test infrastructure + mini fixture workspace

**Files:**
- Modify: `package.json`
- Create: `tools/theme/fixtures/mini/wordpress/pages/home.block-tree.json`
- Create: `tools/theme/fixtures/mini/wordpress/pages/about.block-tree.json`
- Create: `tools/theme/fixtures/mini/wordpress/style.css`
- Create: `tools/theme/fixtures/mini/wordpress/blocks/badge/block.json`, `.../badge/index.js`, `.../badge/style.css`
- Create: `tools/theme/infra.test.mjs`

- [ ] **Step 1: Add the test script**

In `package.json` scripts: `"test": "node --test tools/theme/"` and extend `"check"` to also check the new lib files: `"check": "node --check tools/mcp-server.mjs && node --check tools/lib/workspace.mjs && node --check tools/lib/capture.mjs && node --check tools/lib/wp-serialize.mjs"`.

- [ ] **Step 2: Write the fixture**

`home.block-tree.json` — two shared chrome subtrees + one page-only section. Note the deliberate variance: the nav paragraph content differs per page (structural match), the footer is identical (exact match):

```json
{
  "version": 2,
  "contract": "data-only",
  "blocks": [
    { "blockName": "core/group", "attrs": { "tagName": "header", "className": "topbar" }, "innerBlocks": [
      { "blockName": "core/paragraph", "attrs": { "className": "topbar__brand", "content": "Mini <b>Home</b>" }, "innerBlocks": [] } ] },
    { "blockName": "core/group", "attrs": { "tagName": "section", "className": "intro", "style": { "color": { "background": "#112233", "text": "#FFEEDD" }, "spacing": { "padding": { "top": "clamp(10px,2vh,20px)", "bottom": "clamp(10px,2vh,20px)", "left": "0", "right": "0" } } } }, "innerBlocks": [
      { "blockName": "core/heading", "attrs": { "level": 1, "content": "Welcome" }, "innerBlocks": [] },
      { "blockName": "mini/badge", "attrs": { "label": "New" }, "innerBlocks": [] } ] },
    { "blockName": "core/group", "attrs": { "tagName": "footer", "className": "sitefoot", "style": { "color": { "background": "#112233" } } }, "innerBlocks": [
      { "blockName": "core/paragraph", "attrs": { "content": "© Mini" }, "innerBlocks": [] } ] }
  ]
}
```

`about.block-tree.json` — same `topbar` group but content `"Mini <b>About</b>"`, the identical `sitefoot` group byte-for-byte, and a middle section `{ "className": "story" }` with one heading "About us" and one paragraph (no badge, no style attrs).

`wordpress/style.css`:

```css
:root { --brand: #112233; --paper: #FFEEDD; --pad: clamp(10px,2vh,20px); }
body { background: var(--paper); color: var(--brand); font-family: Georgia, serif; }
.topbar { position: fixed; top: 0; }
.topbar__brand b { color: var(--brand); }
.intro h1 { font-size: clamp(40px,6vw,90px); }
.intro:hover { background: #000; }
.story::before { content: "—"; }
@media (max-width: 600px) { .intro h1 { font-size: 32px; } }
```

`blocks/badge/block.json`: `{ "apiVersion": 3, "name": "mini/badge", "title": "Badge", "category": "design", "editorScript": "file:./index.js", "style": "file:./style.css", "attributes": { "label": { "type": "string", "default": "" } }, "supports": { "className": true, "html": false } }`.
`blocks/badge/index.js`:

```js
(function (blocks, blockEditor, components, element) {
    const el = element.createElement;
    blocks.registerBlockType("mini/badge", {
        apiVersion: 3,
        edit: function (props) {
            return el('span', blockEditor.useBlockProps({ className: 'badge' }), props.attributes.label || '');
        },
        save: function (props) {
            return el('span', blockEditor.useBlockProps.save({ className: 'badge' }), props.attributes.label || '');
        }
    });
})(window.wp.blocks, window.wp.blockEditor, window.wp.components, window.wp.element);
```

`blocks/badge/style.css`: `.badge { display: inline-block; padding: 2px 6px; background: #112233; color: #FFEEDD; }`

- [ ] **Step 3: Write a smoke test proving the fixture serializes**

`tools/theme/infra.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson } from '../lib/workspace.mjs';
import { ensureBlocksRegistered, serializeBlocks } from '../lib/wp-serialize.mjs';

const MINI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/mini');

test('mini fixture serializes through @wordpress/blocks', () => {
    ensureBlocksRegistered(MINI);
    const tree = readJson(path.join(MINI, 'wordpress/pages/home.block-tree.json'));
    const markup = serializeBlocks(tree.blocks, {});
    assert.match(markup, /wp:group/);
    assert.match(markup, /mini\/badge/);
});
```

(If `serializeBlockTreeWithWordPress`'s context argument requires fields, mirror exactly what `serializeWordPressBlocks` in the server passes and adjust `serializeBlocks` in Task 3 accordingly — this test exists to force that interface straight.)

- [ ] **Step 4: Run and commit**

Run: `npm test` → expected: 1 pass. `npm run check` passes.

```bash
git add package.json tools/theme/
git commit -m "Add theme tool test infra and mini fixture workspace"
```

---

### Task 5: tools/theme/evidence.mjs — CSS parser

**Files:**
- Create: `tools/theme/evidence.mjs`
- Create: `tools/theme/evidence.test.mjs`

- [ ] **Step 1: Write failing tests for the CSS parser**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCss, classifyRule } from './evidence.mjs';

test('parseCss flattens rules and tracks media context', () => {
    const rules = parseCss(`:root{--a:#fff}.x{color:#fff;position:fixed}@media (max-width:600px){.x{color:#000}}`);
    assert.equal(rules.length, 3);
    assert.deepEqual(rules[0], { selector: ':root', media: null, declarations: [['--a', '#fff']] });
    assert.equal(rules[2].media, '(max-width:600px)');
});

test('classifyRule buckets by lift-blocking feature', () => {
    assert.deepEqual(classifyRule({ selector: '.x::before', media: null, declarations: [['content', '"x"']] }), ['pseudo']);
    assert.deepEqual(classifyRule({ selector: '.x', media: '(max-width:600px)', declarations: [['color', 'red']] }), ['media-query']);
    assert.deepEqual(classifyRule({ selector: '.x:hover', media: null, declarations: [['transition', 'all .2s']] }), ['interaction']);
    assert.deepEqual(
        classifyRule({ selector: '.x', media: null, declarations: [['position', 'fixed'], ['mix-blend-mode', 'difference'], ['display', 'grid']] }).sort(),
        ['blend', 'grid', 'position']
    );
    assert.deepEqual(classifyRule({ selector: '.x', media: null, declarations: [['color', 'red']] }), []);
});
```

- [ ] **Step 2: Run to verify failure** — `npm test` → FAIL (`parseCss` not exported).

- [ ] **Step 3: Implement parser + classifier**

```js
// tools/theme/evidence.mjs
export function parseCss(css) {
    const out = [];
    const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
    let i = 0;
    walk(null);
    return out;

    function walk(media) {
        while (i < src.length) {
            const open = src.indexOf('{', i);
            if (open === -1) { i = src.length; return; }
            const head = src.slice(i, open).trim();
            if (head.startsWith('@media')) {
                i = open + 1;
                walk(head.replace(/^@media/, '').trim());
                continue;
            }
            if (head.startsWith('@')) { // @import, @keyframes, @font-face: skip block (keyframes nest)
                i = skipBlock(open);
                if (head.startsWith('@keyframes')) out.push({ selector: head, media, declarations: [], atRule: 'keyframes' });
                continue;
            }
            if (head === '' && src[i] === '}') { i += 1; return; } // closing of @media
            const close = src.indexOf('}', open);
            const body = src.slice(open + 1, close);
            out.push({
                selector: head, media,
                declarations: body.split(';').map((d) => d.trim()).filter(Boolean)
                    .map((d) => { const k = d.indexOf(':'); return [d.slice(0, k).trim(), d.slice(k + 1).trim()]; }),
            });
            i = close + 1;
            while (src[i] === '}' && media !== null) { i += 1; return; }
        }
    }
    function skipBlock(open) {
        let depth = 1, j = open + 1;
        while (j < src.length && depth > 0) { if (src[j] === '{') depth += 1; if (src[j] === '}') depth -= 1; j += 1; }
        return j;
    }
}

const BUCKETS = [
    ['pseudo', (r) => /::|:before|:after/.test(r.selector)],
    ['media-query', (r) => r.media !== null],
    ['interaction', (r) => /:hover|:focus|:active|:checked/.test(r.selector) || r.declarations.some(([p]) => p === 'transition' || p === 'animation' || p === 'animation-play-state') || r.atRule === 'keyframes'],
    ['position', (r) => r.declarations.some(([p, v]) => p === 'position' && /fixed|absolute|sticky/.test(v))],
    ['blend', (r) => r.declarations.some(([p]) => p === 'mix-blend-mode' || p === 'filter' || p === 'backdrop-filter')],
    ['grid', (r) => r.declarations.some(([p, v]) => (p === 'display' && /grid/.test(v)) || p.startsWith('grid-'))],
];
export function classifyRule(rule) {
    return BUCKETS.filter(([, fn]) => fn(rule)).map(([name]) => name);
}
```

**Note for the implementer:** the parser intentionally handles only the CSS shapes this pipeline produces (flat rules + one level of `@media` + skipped at-blocks). The walk/return logic around `@media` closing braces is the fiddly part — the tests above pin it; add a test with two consecutive `@media` blocks if you touch it.

- [ ] **Step 4: Run tests** — `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/theme/evidence.mjs tools/theme/evidence.test.mjs
git commit -m "Add CSS parser and lift-bucket classifier for theme evidence"
```

---

### Task 6: evidence.mjs — tree scan + report assembly + tool entry

**Files:**
- Modify: `tools/theme/evidence.mjs`
- Modify: `tools/theme/evidence.test.mjs`

- [ ] **Step 1: Write failing tests against the mini fixture**

```js
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeThemeEvidence } from './evidence.mjs';
const MINI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/mini');

test('analyzeThemeEvidence reports pages, tokens, values and buckets', () => {
    const report = analyzeThemeEvidence({ workspaceRoot: MINI, write: false });
    assert.deepEqual(report.pages, ['about', 'home']);
    assert.equal(report.customProperties['--brand'].value, '#112233');
    const brand = report.colors.find((c) => c.value === '#112233');
    assert.ok(brand.count >= 4); // 2x attrs (intro bg, foot bg) + css var def + .badge css
    assert.ok(brand.names.includes('--brand'));
    assert.ok(brand.attrRefs.length >= 2 && brand.cssRefs.length >= 1);
    const pad = report.spacing.find((s) => s.value === 'clamp(10px,2vh,20px)');
    assert.ok(pad.count >= 2);
    assert.ok(report.supportUsage['core/group']['color.background'] >= 2);
    const fixedRule = report.cssRules.find((r) => r.selector === '.topbar');
    assert.deepEqual(fixedRule.buckets, ['position']);
    const plain = report.cssRules.find((r) => r.selector === 'body');
    assert.deepEqual(plain.buckets, []); // liftable — body styles belong in theme.json
});
```

- [ ] **Step 2: Run to verify failure**, then **Step 3: implement**

```js
import path from 'node:path';
import fs from 'node:fs';
import { readJson, readIfExists, writeJson, resolvePath, findFiles } from '../lib/workspace.mjs';

export function loadPageTrees(workspaceRoot) {
    const pagesDir = path.join(workspaceRoot, 'wordpress/pages');
    if (fs.existsSync(pagesDir)) {
        return fs.readdirSync(pagesDir).filter((f) => f.endsWith('.block-tree.json')).sort()
            .map((f) => ({ page: f.replace(/\.block-tree\.json$/, ''), tree: readJson(path.join(pagesDir, f)) }));
    }
    return [{ page: 'index', tree: readJson(path.join(workspaceRoot, 'wordpress/block-tree.json')) }];
}

const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g;

export function analyzeThemeEvidence(args) {
    const workspaceRoot = resolvePath(args.workspaceRoot);
    const pages = loadPageTrees(workspaceRoot);
    const acc = { colors: new Map(), fontSizes: new Map(), spacing: new Map(), fontFamilies: new Map() };
    const supportUsage = {};

    // 1. tree scan
    for (const { page, tree } of pages) {
        walkBlocks(tree.blocks, [], (block, blockPath) => {
            const style = block.attrs?.style || {};
            for (const p of stylePaths(style)) {
                const key = `${p.path}`;
                supportUsage[block.blockName] ??= {};
                supportUsage[block.blockName][key] = (supportUsage[block.blockName][key] || 0) + 1;
                const ref = { kind: 'attr', page, blockName: block.blockName, path: `${blockPath.join('.')}:${p.path}` };
                if (p.path.startsWith('color.')) record(acc.colors, p.value, ref);
                else if (p.path.startsWith('typography.fontSize')) record(acc.fontSizes, p.value, ref);
                else if (p.path.startsWith('spacing.')) record(acc.spacing, p.value, ref);
            }
        });
    }

    // 2. css scan
    const cssFiles = [path.join(workspaceRoot, 'wordpress/style.css'),
        ...findFiles(path.join(workspaceRoot, 'wordpress/blocks'), 'style.css')];
    const customProperties = {};
    const cssRules = [];
    for (const file of cssFiles) {
        const css = readIfExists(file);
        if (!css) continue;
        const rel = path.relative(workspaceRoot, file);
        for (const rule of parseCss(css)) {
            cssRules.push({ file: rel, selector: rule.selector, media: rule.media, buckets: classifyRule(rule), declarationCount: rule.declarations.length });
            for (const [prop, value] of rule.declarations) {
                const ref = { kind: 'css', file: rel, selector: rule.selector, prop };
                if (prop.startsWith('--')) customProperties[prop] = { value, definedIn: rel, refs: [] };
                for (const m of value.match(COLOR_RE) || []) record(acc.colors, m.toLowerCase(), ref);
                if (prop === 'font-family') record(acc.fontFamilies, value, ref);
                if (prop === 'font-size') record(acc.fontSizes, value, ref);
                if (/^(padding|margin|gap|row-gap|column-gap)/.test(prop)) record(acc.spacing, value, ref);
                for (const m of value.match(/var\((--[a-z0-9-]+)/gi) || []) {
                    const name = m.slice(4);
                    (customProperties[name] ??= { value: null, definedIn: null, refs: [] }).refs.push(ref);
                }
            }
        }
    }

    // 3. name colors after custom properties that hold them
    const report = {
        generatedAt: new Date().toISOString(),
        pages: pages.map((p) => p.page),
        customProperties,
        colors: finalize(acc.colors, (entry) => ({
            names: Object.entries(customProperties).filter(([, v]) => (v.value || '').toLowerCase() === entry.value).map(([k]) => k),
        })),
        fontFamilies: finalize(acc.fontFamilies),
        fontSizes: finalize(acc.fontSizes),
        spacing: finalize(acc.spacing),
        supportUsage,
        cssRules,
        summary: {
            liftableRules: cssRules.filter((r) => r.buckets.length === 0).length,
            unliftableRules: cssRules.filter((r) => r.buckets.length > 0).length,
        },
    };
    if (args.write !== false) writeJson(path.join(workspaceRoot, 'reports/theme-evidence.json'), report);
    return report;
}

function record(map, value, ref) {
    const v = String(value).trim();
    const entry = map.get(v) || { value: v, count: 0, attrRefs: [], cssRefs: [] };
    entry.count += 1;
    (ref.kind === 'attr' ? entry.attrRefs : entry.cssRefs).push(ref);
    map.set(v, entry);
}
function finalize(map, extra = () => ({})) {
    return [...map.values()].sort((a, b) => b.count - a.count).map((e) => ({ ...e, ...extra(e) }));
}
export function walkBlocks(blocks, blockPath, fn) {
    (blocks || []).forEach((block, index) => {
        const p = [...blockPath, index];
        fn(block, p);
        walkBlocks(block.innerBlocks, p, fn);
    });
}
export function stylePaths(style, prefix = '', out = []) {
    for (const [key, value] of Object.entries(style || {})) {
        const p = prefix ? `${prefix}.${key}` : key;
        if (value && typeof value === 'object') stylePaths(value, p, out);
        else out.push({ path: p, value });
    }
    return out;
}
```

- [ ] **Step 4: Run tests** — `npm test` → PASS (adjust the count assertions to actual fixture arithmetic if off by one — the *meaning* asserted must hold: attrs and css both contribute, names attach).

- [ ] **Step 5: Commit**

```bash
git add tools/theme/evidence.mjs tools/theme/evidence.test.mjs
git commit -m "Add theme evidence analyzer over trees and CSS"
```

---

### Task 7: tools/theme/parts.mjs — subtree hashing, grouping, variance

**Files:**
- Create: `tools/theme/parts.mjs`
- Create: `tools/theme/parts.test.mjs`

- [ ] **Step 1: Write failing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inferTemplateParts, structuralHash, exactHash } from './parts.mjs';
const MINI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/mini');

test('hashes: content changes break exact but not structural equality', () => {
    const a = { blockName: 'core/paragraph', attrs: { className: 'x', content: 'one' }, innerBlocks: [] };
    const b = { blockName: 'core/paragraph', attrs: { className: 'x', content: 'two' }, innerBlocks: [] };
    assert.notEqual(exactHash(a), exactHash(b));
    assert.equal(structuralHash(a), structuralHash(b));
    const c = { ...b, attrs: { className: 'y', content: 'two' } };
    assert.notEqual(structuralHash(b), structuralHash(c));
});

test('inferTemplateParts groups chrome across the mini fixture', () => {
    const report = inferTemplateParts({ workspaceRoot: MINI, write: false });
    const foot = report.groups.find((g) => g.occurrences.every((o) => o.tagName === 'footer'));
    assert.equal(foot.kind, 'exact');
    assert.deepEqual(foot.occurrences.map((o) => o.page).sort(), ['about', 'home']);
    assert.ok(foot.occurrences.every((o) => o.last));
    const top = report.groups.find((g) => g.occurrences.every((o) => o.tagName === 'header'));
    assert.equal(top.kind, 'structural');
    assert.ok(top.occurrences.every((o) => o.first));
    assert.equal(top.variance.length, 1);
    assert.equal(top.variance[0].path, '0:attrs.content'); // child 0's content differs
    assert.deepEqual(Object.keys(top.variance[0].values).sort(), ['about', 'home']);
    // page-unique sections are reported but not candidates
    assert.ok(report.singletons.some((s) => s.className === 'intro'));
});
```

- [ ] **Step 2: Run to verify failure**, then **Step 3: implement**

```js
// tools/theme/parts.mjs
import path from 'node:path';
import crypto from 'node:crypto';
import { writeJson, resolvePath } from '../lib/workspace.mjs';
import { loadPageTrees } from './evidence.mjs';

const CONTENT_KEYS = new Set(['content', 'text', 'caption', 'label', 'alt', 'okText', 'noteText', 'submitText', 'brand', 'items', 'links', 'fields', 'url', 'href']);

function sha(value) { return crypto.createHash('sha1').update(JSON.stringify(value)).digest('hex'); }

function exactShape(block) {
    return [block.blockName, sortedEntries(block.attrs || {}), (block.innerBlocks || []).map(exactShape)];
}
function structuralShape(block) {
    const attrs = block.attrs || {};
    return [
        block.blockName,
        String(attrs.className || '').split(/\s+/).filter(Boolean).sort(),
        Object.keys(attrs).filter((k) => !CONTENT_KEYS.has(k)).sort(),
        (block.innerBlocks || []).map(structuralShape),
    ];
}
function sortedEntries(obj) {
    return Object.keys(obj).sort().map((k) => [k, obj[k] && typeof obj[k] === 'object' ? sortedEntries(obj[k]) : obj[k]]);
}
export function exactHash(block) { return sha(exactShape(block)); }
export function structuralHash(block) { return sha(structuralShape(block)); }

export function diffSubtrees(occurrences) {
    // walk all occurrence subtrees in lockstep; report paths where exact values differ
    const variance = [];
    walk(occurrences.map((o) => o.block), '');
    return variance;

    function walk(nodes, prefix) {
        const attrsList = nodes.map((n) => n.attrs || {});
        const keys = new Set(attrsList.flatMap((a) => Object.keys(a)));
        for (const key of keys) {
            const values = attrsList.map((a) => JSON.stringify(a[key]));
            if (new Set(values).size > 1) {
                variance.push({
                    path: prefix ? `${prefix}:attrs.${key}` : `attrs.${key}`,
                    values: Object.fromEntries(occurrences.map((o, i) => [o.page, attrsList[i][key]])),
                });
            }
        }
        const childCount = Math.max(...nodes.map((n) => (n.innerBlocks || []).length));
        for (let c = 0; c < childCount; c += 1) {
            walk(nodes.map((n) => (n.innerBlocks || [])[c] || { attrs: {}, innerBlocks: [] }), prefix ? `${prefix}.${c}` : String(c));
        }
    }
}

export function inferTemplateParts(args) {
    const workspaceRoot = resolvePath(args.workspaceRoot);
    const pages = loadPageTrees(workspaceRoot);
    const byStructure = new Map();
    for (const { page, tree } of pages) {
        tree.blocks.forEach((block, index) => {
            const key = structuralHash(block);
            const entry = byStructure.get(key) || [];
            entry.push({
                page, index, block,
                first: index === 0, last: index === tree.blocks.length - 1,
                tagName: block.attrs?.tagName || null, blockName: block.blockName,
                className: block.attrs?.className || '',
                exact: exactHash(block),
            });
            byStructure.set(key, entry);
        });
    }
    const groups = [];
    const singletons = [];
    for (const [structural, occurrences] of byStructure) {
        const pagesIn = new Set(occurrences.map((o) => o.page));
        if (pagesIn.size < 2) {
            singletons.push(...occurrences.map(({ block, exact, ...rest }) => rest));
            continue;
        }
        const exactSet = new Set(occurrences.map((o) => o.exact));
        groups.push({
            structuralHash: structural,
            kind: exactSet.size === 1 ? 'exact' : 'structural',
            occurrences: occurrences.map(({ block, exact, ...rest }) => rest),
            variance: exactSet.size === 1 ? [] : diffSubtrees(occurrences),
        });
    }
    groups.sort((a, b) => b.occurrences.length - a.occurrences.length);
    const report = { generatedAt: new Date().toISOString(), pages: pages.map((p) => p.page), groups, singletons };
    if (args.write !== false) writeJson(path.join(workspaceRoot, 'reports/template-parts.json'), report);
    return report;
}
```

- [ ] **Step 4: Run tests** — `npm test` → PASS.
- [ ] **Step 5: Commit**

```bash
git add tools/theme/parts.mjs tools/theme/parts.test.mjs
git commit -m "Add template part inference with exact and structural grouping"
```

---

### Task 8: tools/theme/fonts.mjs — Google Fonts to local fontFace

**Files:**
- Create: `tools/theme/fonts.mjs`
- Create: `tools/theme/fonts.test.mjs`

- [ ] **Step 1: Write failing tests (mocked fetch)**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractGoogleFontsImport, parseFontFaces, fetchThemeFonts } from './fonts.mjs';

const CSS2 = `/* latin */
@font-face { font-family: 'Bodoni Moda'; font-style: italic; font-weight: 400; src: url(https://fonts.gstatic.com/s/a.woff2) format('woff2'); unicode-range: U+0000-00FF; }
@font-face { font-family: 'Archivo'; font-style: normal; font-weight: 300 700; src: url(https://fonts.gstatic.com/s/b.woff2) format('woff2'); }`;

test('extractGoogleFontsImport finds the css2 url', () => {
    const url = extractGoogleFontsImport(`@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@300..700&display=swap');`);
    assert.match(url, /^https:\/\/fonts\.googleapis\.com\/css2\?/);
});

test('parseFontFaces extracts descriptors and urls', () => {
    const faces = parseFontFaces(CSS2);
    assert.equal(faces.length, 2);
    assert.deepEqual(faces[0], { fontFamily: 'Bodoni Moda', fontStyle: 'italic', fontWeight: '400', unicodeRange: 'U+0000-00FF', url: 'https://fonts.gstatic.com/s/a.woff2' });
    assert.equal(faces[1].fontWeight, '300 700');
});

test('fetchThemeFonts downloads files and returns theme.json fontFace entries', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fonts-'));
    const fetchImpl = async (url) => ({
        ok: true,
        text: async () => CSS2,
        arrayBuffer: async () => new TextEncoder().encode(`bin:${url}`).buffer,
    });
    const result = await fetchThemeFonts({
        importUrl: 'https://fonts.googleapis.com/css2?family=X', targetDir: dir, fetchImpl, write: false,
    });
    assert.equal(result.fontFamilies.length, 2);
    const bodoni = result.fontFamilies.find((f) => f.name === 'Bodoni Moda');
    assert.equal(bodoni.fontFace[0].src[0], 'file:./assets/fonts/bodoni-moda-400-italic-0.woff2');
    assert.ok(fs.existsSync(path.join(dir, 'bodoni-moda-400-italic-0.woff2')));
    assert.equal(bodoni.fontFace[0].unicodeRange, 'U+0000-00FF');
});
```

- [ ] **Step 2: Run to verify failure**, then **Step 3: implement**

```js
// tools/theme/fonts.mjs
import fs from 'node:fs';
import path from 'node:path';
import { slug } from '../lib/workspace.mjs';

const WOFF2_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

export function extractGoogleFontsImport(css) {
    const m = css.match(/@import\s+url\(\s*['"]?(https:\/\/fonts\.googleapis\.com\/css2[^'")]+)/);
    return m ? m[1] : null;
}

export function parseFontFaces(css2) {
    const faces = [];
    for (const block of css2.match(/@font-face\s*{[^}]*}/g) || []) {
        const get = (re) => (block.match(re) || [])[1] || null;
        faces.push({
            fontFamily: get(/font-family:\s*'([^']+)'/),
            fontStyle: get(/font-style:\s*([a-z]+)/) || 'normal',
            fontWeight: get(/font-weight:\s*([0-9 ]+)/) || '400',
            unicodeRange: get(/unicode-range:\s*([^;]+);/),
            url: get(/src:\s*url\(([^)]+\.woff2)\)/),
        });
    }
    return faces.filter((f) => f.fontFamily && f.url);
}

export async function fetchThemeFonts({ importUrl, sourceCss, targetDir, fetchImpl = fetch }) {
    const url = importUrl || extractGoogleFontsImport(sourceCss || '');
    if (!url) throw new Error('No Google Fonts @import found; pass importUrl explicitly or skip font bundling.');
    let css2;
    try {
        const res = await fetchImpl(url, { headers: { 'User-Agent': WOFF2_UA } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        css2 = await res.text();
    } catch (error) {
        throw new Error(`Font fetch failed (offline?). Fidelity requires bundled fonts; the run is blocked. Cause: ${error.message}`);
    }
    const faces = parseFontFaces(css2);
    fs.mkdirSync(targetDir, { recursive: true });
    const families = new Map();
    const counters = new Map();
    for (const face of faces) {
        const famSlug = slug(face.fontFamily);
        const base = `${famSlug}-${face.fontWeight.replace(/\s+/g, '-')}-${face.fontStyle}`;
        const n = counters.get(base) || 0;
        counters.set(base, n + 1);
        const fileName = `${base}-${n}.woff2`;
        const res = await fetchImpl(face.url, { headers: { 'User-Agent': WOFF2_UA } });
        if (!res.ok) throw new Error(`Font file fetch failed: ${face.url} (HTTP ${res.status})`);
        fs.writeFileSync(path.join(targetDir, fileName), Buffer.from(await res.arrayBuffer()));
        const fam = families.get(face.fontFamily) || { name: face.fontFamily, slug: famSlug, fontFamily: `'${face.fontFamily}'`, fontFace: [] };
        fam.fontFace.push({
            fontFamily: face.fontFamily,
            fontStyle: face.fontStyle,
            fontWeight: face.fontWeight,
            ...(face.unicodeRange ? { unicodeRange: face.unicodeRange } : {}),
            src: [`file:./assets/fonts/${fileName}`],
        });
        families.set(face.fontFamily, fam);
    }
    return { importUrl: url, fontFamilies: [...families.values()] };
}
```

- [ ] **Step 4: Run tests** — `npm test` → PASS.
- [ ] **Step 5: Commit**

```bash
git add tools/theme/fonts.mjs tools/theme/fonts.test.mjs
git commit -m "Add Google Fonts bundler producing theme.json fontFace entries"
```

---

### Task 9: tools/theme/rewrites.mjs — pure rewrite passes

**Files:**
- Create: `tools/theme/rewrites.mjs`
- Create: `tools/theme/rewrites.test.mjs`

The token map shape (authored by the agent in the plan, consumed everywhere):

```json
{
  "colors": { "#112233": "brand", "#ffeedd": "paper" },
  "fontSizes": { "clamp(40px,6vw,90px)": "display" },
  "spacing": { "clamp(10px,2vh,20px)": "30" },
  "custom": { "--pad": "pad", "--ease": "ease" }
}
```

- [ ] **Step 1: Write failing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { rewriteTreePresets, rewriteCssVars, rewriteLinks, rewriteMediaUrls } from './rewrites.mjs';

const MAP = {
    colors: { '#112233': 'brand' },
    fontSizes: { 'clamp(40px,6vw,90px)': 'display' },
    spacing: { 'clamp(10px,2vh,20px)': '30' },
    custom: { '--pad': 'pad' },
};

test('rewriteTreePresets converts exact color/fontSize/spacing matches to presets', () => {
    const block = {
        blockName: 'core/group',
        attrs: { style: { color: { background: '#112233', text: '#ABCDEF' }, spacing: { padding: { top: 'clamp(10px,2vh,20px)', bottom: '4px' } } } },
        innerBlocks: [{ blockName: 'core/heading', attrs: { style: { typography: { fontSize: 'clamp(40px,6vw,90px)' } } }, innerBlocks: [] }],
    };
    const out = rewriteTreePresets(block, MAP);
    assert.equal(out.attrs.backgroundColor, 'brand');
    assert.equal(out.attrs.style.color.background, undefined);
    assert.equal(out.attrs.style.color.text, '#ABCDEF'); // non-matching value untouched
    assert.equal(out.attrs.style.spacing.padding.top, 'var:preset|spacing|30');
    assert.equal(out.attrs.style.spacing.padding.bottom, '4px');
    assert.equal(out.innerBlocks[0].attrs.fontSize, 'display');
    assert.equal(out.innerBlocks[0].attrs.style.typography, undefined);
});

test('rewriteCssVars renames mapped custom properties and drops their :root defs', () => {
    const css = `:root{--pad:10px;--keep:1}.x{padding:var(--pad);margin:var(--keep)}`;
    const out = rewriteCssVars(css, MAP.custom);
    assert.ok(!out.includes('--pad:10px'));
    assert.ok(out.includes('--keep:1'));
    assert.ok(out.includes('var(--wp--custom--pad)'));
    assert.ok(out.includes('var(--keep)'));
});

test('rewriteLinks maps page files to permalinks in attrs and html', () => {
    const linkMap = { 'judges.html': '/judges/', 'Bucharest Feline Show.html': '/' };
    assert.equal(rewriteLinks('judges.html', linkMap), '/judges/');
    assert.equal(rewriteLinks('Bucharest Feline Show.html#tickets', linkMap), '/#tickets');
    assert.equal(
        rewriteLinks('<a href="judges.html">x</a> <a href="#local">y</a>', linkMap),
        '<a href="/judges/">x</a> <a href="#local">y</a>'
    );
});

test('rewriteMediaUrls swaps workspace asset paths for the THEME_URI placeholder', () => {
    const mediaMap = { 'mockup/assets/cat.jpg': 'assets/media/cat.jpg' };
    assert.equal(
        rewriteMediaUrls('<img src="mockup/assets/cat.jpg">', mediaMap, '{{THEME_URI}}'),
        '<img src="{{THEME_URI}}/assets/media/cat.jpg">'
    );
});
```

- [ ] **Step 2: Run to verify failure**, then **Step 3: implement**

```js
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

export function rewriteMediaUrls(value, mediaMap, base) {
    let out = String(value);
    for (const [from, to] of Object.entries(mediaMap)) {
        out = out.split(from).join(`${base}/${to}`);
    }
    return out;
}
```

(`rewriteTreePresets` returns preset attrs in the canonical core forms: `backgroundColor`/`textColor`/`fontSize` slugs and `var:preset|spacing|<slug>` strings — exactly what `@wordpress/blocks` serializes back into `has-*` classes and preset CSS vars.)

- [ ] **Step 4: Run tests**, fix `rewriteLinks` plain-string cases until green (the test pins both bare-attr and html forms). PASS.
- [ ] **Step 5: Commit**

```bash
git add tools/theme/rewrites.mjs tools/theme/rewrites.test.mjs
git commit -m "Add preset, custom property, link and media rewrite passes"
```

---

### Task 10: generate/blocks-plugin.mjs

**Files:**
- Create: `tools/theme/generate/blocks-plugin.mjs`
- Create: `tools/theme/generate/blocks-plugin.test.mjs`

- [ ] **Step 1: Write failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeBlocksPlugin } from './blocks-plugin.mjs';
const MINI = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/mini');

test('writeBlocksPlugin copies blocks and emits a registering plugin', () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-'));
    const result = writeBlocksPlugin({ workspaceRoot: MINI, slug: 'mini', themeName: 'Mini', outDir: out });
    const main = fs.readFileSync(path.join(out, 'mini-blocks.php'), 'utf8');
    assert.match(main, /Plugin Name: Mini Blocks/);
    assert.match(main, /register_block_type/);
    assert.match(main, /enqueue_block_editor_assets/);
    const blockJson = JSON.parse(fs.readFileSync(path.join(out, 'blocks/badge/block.json'), 'utf8'));
    assert.equal(blockJson.editorScript, undefined); // script enqueued with deps instead
    assert.equal(blockJson.style, 'file:./style.css');
    assert.ok(fs.existsSync(path.join(out, 'blocks/badge/index.js')));
    assert.equal(result.blocks.length, 1);
});

test('writeBlocksPlugin returns empty for pure-core workspaces', () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-'));
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-'));
    const result = writeBlocksPlugin({ workspaceRoot: ws, slug: 'x', themeName: 'X', outDir: out });
    assert.deepEqual(result.blocks, []);
    assert.ok(!fs.existsSync(path.join(out, 'x-blocks.php')));
});
```

- [ ] **Step 2: Run to verify failure**, then **Step 3: implement**

```js
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
```

- [ ] **Step 4: Run tests** — PASS.
- [ ] **Step 5: Commit**

```bash
git add tools/theme/generate/
git commit -m "Add blocks plugin generator"
```

---

### Task 11: generate/content-plugin.mjs

**Files:**
- Create: `tools/theme/generate/content-plugin.mjs`
- Create: `tools/theme/generate/content-plugin.test.mjs`

- [ ] **Step 1: Write failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeContentPlugin } from './content-plugin.mjs';

test('writeContentPlugin writes manifest, payload and admin plugin', () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-'));
    writeContentPlugin({
        slug: 'mini', themeName: 'Mini', outDir: out,
        pages: [
            { slug: 'home', title: 'Home', front: true, template: '', markup: '<!-- wp:paragraph --><p>hi</p><!-- /wp:paragraph -->' },
            { slug: 'about', title: 'About', front: false, template: 'page-about', markup: '<!-- wp:paragraph --><p>about</p><!-- /wp:paragraph -->' },
        ],
    });
    const manifest = JSON.parse(fs.readFileSync(path.join(out, 'content/manifest.json'), 'utf8'));
    assert.equal(manifest.pages.length, 2);
    assert.equal(manifest.pages[0].front, true);
    assert.ok(fs.existsSync(path.join(out, 'content/home.html')));
    const php = fs.readFileSync(path.join(out, 'mini-content.php'), 'utf8');
    assert.match(php, /Requires Plugins:\s*mini-blocks/);
    assert.match(php, /function mini_content_import_pages/);
    assert.match(php, /function mini_content_remove_pages/);
    assert.match(php, /add_management_page/);
    assert.match(php, /\{\{THEME_URI\}\}/);
    assert.match(php, /wp_verify_nonce/);
});
```

- [ ] **Step 2: Run to verify failure**, then **Step 3: implement**

```js
// tools/theme/generate/content-plugin.mjs
import path from 'node:path';
import { writeFile, writeJson } from '../../lib/workspace.mjs';

export function writeContentPlugin({ slug, themeName, outDir, pages }) {
    const prefix = slug.replace(/-/g, '_') + '_content';
    writeJson(path.join(outDir, 'content/manifest.json'), {
        theme: slug,
        pages: pages.map(({ markup, ...page }) => page),
    });
    for (const page of pages) {
        writeFile(path.join(outDir, `content/${page.slug}.html`), `${page.markup.trim()}\n`);
    }
    writeFile(path.join(outDir, `${slug}-content.php`), contentPluginPhp({ slug, themeName, prefix }));
    return { prefix, pageCount: pages.length };
}

function contentPluginPhp({ slug, themeName, prefix }) {
    return `<?php
/**
 * Plugin Name: ${themeName} Content
 * Description: Imports and removes the ${themeName} theme's generated pages. Safe to delete after import.
 * Version: 1.0.0
 * Requires at least: 6.6
 * Requires PHP: 7.4
 * Requires Plugins: ${slug}-blocks
 * License: GPL-2.0-or-later
 * Text Domain: ${slug}-content
 */

defined('ABSPATH') || exit;

const ${prefix.toUpperCase()}_OPTION = '${prefix}_imported';
const ${prefix.toUpperCase()}_META = '_${prefix}_generated';

function ${prefix}_manifest() {
    $manifest = json_decode(file_get_contents(__DIR__ . '/content/manifest.json'), true);
    return is_array($manifest) ? $manifest : array('pages' => array());
}

function ${prefix}_import_pages() {
    $state = get_option(${prefix.toUpperCase()}_OPTION, array());
    $results = array();
    foreach (${prefix}_manifest()['pages'] as $page) {
        $slug = $page['slug'];
        if (isset($state[$slug]) && get_post($state[$slug]['post_id'])) {
            $results[$slug] = array('status' => 'already-imported', 'permalink' => get_permalink($state[$slug]['post_id']));
            continue;
        }
        $existing = get_page_by_path($slug);
        if ($existing && !get_post_meta($existing->ID, ${prefix.toUpperCase()}_META, true)) {
            $results[$slug] = array('status' => 'slug-collision', 'permalink' => null);
            continue;
        }
        $markup = file_get_contents(__DIR__ . '/content/' . $slug . '.html');
        $markup = str_replace('{{THEME_URI}}', get_stylesheet_directory_uri(), $markup);
        $post_id = wp_insert_post(array(
            'post_type' => 'page',
            'post_status' => 'publish',
            'post_title' => $page['title'],
            'post_name' => $slug,
            'post_content' => $markup,
        ));
        if (is_wp_error($post_id)) {
            $results[$slug] = array('status' => 'error: ' . $post_id->get_error_message(), 'permalink' => null);
            continue;
        }
        update_post_meta($post_id, ${prefix.toUpperCase()}_META, '1');
        if (!empty($page['template'])) {
            update_post_meta($post_id, '_wp_page_template', $page['template']);
        }
        if (!empty($page['front'])) {
            update_option('show_on_front', 'page');
            update_option('page_on_front', $post_id);
        }
        $state[$slug] = array('post_id' => $post_id, 'imported_at' => time());
        $results[$slug] = array('status' => 'imported', 'permalink' => get_permalink($post_id));
    }
    update_option(${prefix.toUpperCase()}_OPTION, $state);
    return $results;
}

function ${prefix}_remove_pages() {
    $state = get_option(${prefix.toUpperCase()}_OPTION, array());
    foreach ($state as $slug => $entry) {
        $post = get_post($entry['post_id']);
        if ($post && get_post_meta($post->ID, ${prefix.toUpperCase()}_META, true)) {
            if ((int) get_option('page_on_front') === $post->ID) {
                update_option('show_on_front', 'posts');
                update_option('page_on_front', 0);
            }
            wp_delete_post($post->ID, true);
        }
        unset($state[$slug]);
    }
    update_option(${prefix.toUpperCase()}_OPTION, $state);
}

function ${prefix}_page_status($page, $state) {
    if (!isset($state[$page['slug']])) return 'not imported';
    $entry = $state[$page['slug']];
    $post = get_post($entry['post_id']);
    if (!$post) return 'not imported';
    if (strtotime($post->post_modified_gmt) > (int) $entry['imported_at'] + 5) return 'modified since import';
    return 'imported';
}

add_action('admin_menu', function () {
    add_management_page(
        '${themeName} content', '${themeName} content', 'manage_options', '${slug}-content',
        function () {
            if (!current_user_can('manage_options')) return;
            if (isset($_POST['${prefix}_action']) && wp_verify_nonce($_POST['_wpnonce'] ?? '', '${prefix}')) {
                if ($_POST['${prefix}_action'] === 'import') ${prefix}_import_pages();
                if ($_POST['${prefix}_action'] === 'remove') ${prefix}_remove_pages();
            }
            $state = get_option(${prefix.toUpperCase()}_OPTION, array());
            echo '<div class="wrap"><h1>${themeName} content</h1><table class="widefat striped"><thead><tr><th>Page</th><th>Slug</th><th>Status</th></tr></thead><tbody>';
            foreach (${prefix}_manifest()['pages'] as $page) {
                echo '<tr><td>' . esc_html($page['title']) . ($page['front'] ? ' <em>(front page)</em>' : '') . '</td><td>'
                    . esc_html($page['slug']) . '</td><td>' . esc_html(${prefix}_page_status($page, $state)) . '</td></tr>';
            }
            echo '</tbody></table><form method="post" style="margin-top:12px">';
            wp_nonce_field('${prefix}');
            echo '<button class="button button-primary" name="${prefix}_action" value="import">Import pages</button> ';
            echo '<button class="button" name="${prefix}_action" value="remove" onclick="return confirm(\\'Remove all imported pages? Modified pages will be deleted too.\\')">Remove imported pages</button>';
            echo '</form></div>';
        }
    );
});
`;
}
```

- [ ] **Step 4: Run tests** — PASS. Also `php -l` if PHP is installed locally (optional; the Playground gate parses it for real later).
- [ ] **Step 5: Commit**

```bash
git add tools/theme/generate/content-plugin.mjs tools/theme/generate/content-plugin.test.mjs
git commit -m "Add content plugin generator with import and remove admin screen"
```

---

### Task 12: generate/theme-files.mjs

**Files:**
- Create: `tools/theme/generate/theme-files.mjs`
- Create: `tools/theme/generate/theme-files.test.mjs`

- [ ] **Step 1: Write failing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { styleCss, functionsPhp, buildThemeJson, templateMarkup, DEFAULT_TEMPLATES } from './theme-files.mjs';

test('styleCss emits a complete header plus custom css', () => {
    const css = styleCss({ name: 'Mini', slug: 'mini', description: 'D' }, '.x{color:red}');
    assert.match(css, /Theme Name: Mini/);
    assert.match(css, /Text Domain: mini/);
    assert.match(css, /Requires at least: 6.6/);
    assert.match(css, /\.x\{color:red\}/);
});

test('functionsPhp enqueues style.css, editor style, and warns on missing blocks', () => {
    const php = functionsPhp({ slug: 'mini', customBlocks: ['mini/badge'] });
    assert.match(php, /wp_enqueue_style/);
    assert.match(php, /add_editor_style/);
    assert.match(php, /WP_Block_Type_Registry/);
    assert.match(php, /mini\/badge/);
    const bare = functionsPhp({ slug: 'mini', customBlocks: [] });
    assert.ok(!bare.includes('WP_Block_Type_Registry'));
});

test('buildThemeJson merges presets, fontFace, custom and templateParts', () => {
    const json = buildThemeJson({
        settings: { color: { palette: [{ slug: 'brand', color: '#112233', name: 'Brand' }] }, custom: { pad: 'clamp(10px,2vh,20px)' } },
        styles: { color: { background: 'var(--wp--preset--color--paper)' } },
        fontFamilies: [{ name: 'Georgia', slug: 'georgia', fontFamily: 'Georgia, serif', fontFace: [] }],
        templateParts: [{ slug: 'topbar', area: 'header', tagName: 'header' }],
        customTemplates: [],
    });
    assert.equal(json.version, 3);
    assert.equal(json.settings.typography.fontFamilies[0].slug, 'georgia');
    assert.equal(json.settings.color.palette[0].slug, 'brand');
    assert.equal(json.templateParts[0].area, 'header');
    assert.equal(json.settings.appearanceTools, true);
});

test('templateMarkup composes parts and post-content', () => {
    const markup = templateMarkup([
        { type: 'part', slug: 'topbar', tagName: 'header' },
        { type: 'post-content' },
        { type: 'part', slug: 'sitefoot', tagName: 'footer' },
    ]);
    assert.equal(markup, [
        '<!-- wp:template-part {"slug":"topbar","tagName":"header"} /-->',
        '<!-- wp:post-content {"layout":{"type":"default"}} /-->',
        '<!-- wp:template-part {"slug":"sitefoot","tagName":"footer"} /-->',
    ].join('\n') + '\n');
});

test('DEFAULT_TEMPLATES provides generic archive, single and 404 bodies', () => {
    for (const name of ['archive', 'single', '404']) {
        assert.ok(DEFAULT_TEMPLATES[name].some((e) => e.type === 'blocks' || e.type === 'post-content'), name);
    }
    assert.ok(JSON.stringify(DEFAULT_TEMPLATES.archive).includes('core/query'));
    assert.ok(JSON.stringify(DEFAULT_TEMPLATES.single).includes('core/post-title'));
});
```

- [ ] **Step 2: Run to verify failure**, then **Step 3: implement**

```js
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

add_action('after_setup_theme', function () {
    add_editor_style('style.css');
});
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
```

- [ ] **Step 4: Run tests** — PASS.
- [ ] **Step 5: Commit**

```bash
git add tools/theme/generate/theme-files.mjs tools/theme/generate/theme-files.test.mjs
git commit -m "Add theme file generators and default generic templates"
```

---

### Task 13: scaffold.mjs orchestrator

**Files:**
- Create: `tools/theme/scaffold.mjs`
- Create: `tools/theme/scaffold.test.mjs`

The agent-facing input contract (this is the `scaffold_block_theme` tool's `args`):

```jsonc
{
  "workspaceRoot": "examples/bucharest-feline-show",
  "slug": "maison-feline",
  "name": "Maison Féline",
  "description": "…",
  "tokenMap": { "colors": {}, "fontSizes": {}, "spacing": {}, "custom": {} },
  "themeSettings": { /* agent-authored settings fragment (palette, fontSizes, spacingSizes, custom) */ },
  "themeStyles": { /* agent-authored styles fragment (root, elements, blocks incl. per-block css) */ },
  "fontFamilies": [ /* output of fetch_theme_fonts */ ],
  "customCss": "…remaining style.css body (pre-var-rewrite)…",
  "parts": [ { "slug": "nav-home", "area": "header", "tagName": "nav", "source": { "page": "bucharest-feline-show", "index": 0 } } ],
  "templates": {
    "index": [ { "type": "part", "slug": "nav-home", "tagName": "nav" }, { "type": "post-content" }, { "type": "part", "slug": "footer", "tagName": "footer" } ],
    "page-judges": [ /* … */ ]
  },
  "pages": [ { "page": "bucharest-feline-show", "slug": "home", "title": "Bucharest Feline Show", "front": true, "template": "", "stripIndexes": [0, 7] } ],
  "mediaMap": { "mockup/assets/x.jpg": "assets/media/x.jpg" }
}
```

`stripIndexes` are the top-level positions on that page claimed by parts (cited from `reports/template-parts.json` occurrences). Default templates (`archive`, `single`, `404`) are always emitted: chrome = the index template's part entries, body = `DEFAULT_TEMPLATES`.

- [ ] **Step 1: Write a failing integration test on the mini fixture**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scaffoldBlockTheme } from './scaffold.mjs';
const MINI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/mini');

test('scaffoldBlockTheme writes a complete theme + plugins from the mini fixture', () => {
    const result = scaffoldBlockTheme({
        workspaceRoot: MINI, slug: 'mini', name: 'Mini', description: 'Test theme',
        tokenMap: { colors: { '#112233': 'brand' }, fontSizes: {}, spacing: { 'clamp(10px,2vh,20px)': '30' }, custom: { '--pad': 'pad' } },
        themeSettings: {
            color: { palette: [{ slug: 'brand', color: '#112233', name: 'Brand' }, { slug: 'paper', color: '#FFEEDD', name: 'Paper' }] },
            spacing: { spacingSizes: [{ slug: '30', size: 'clamp(10px,2vh,20px)', name: 'Section' }] },
            custom: { pad: 'clamp(10px,2vh,20px)' },
        },
        themeStyles: { color: { background: 'var(--wp--preset--color--paper)' } },
        fontFamilies: [{ name: 'Georgia', slug: 'georgia', fontFamily: 'Georgia, serif', fontFace: [] }],
        customCss: '.topbar { position: fixed; top: 0; padding: var(--pad); }',
        parts: [
            { slug: 'topbar', area: 'header', tagName: 'header', source: { page: 'home', index: 0 } },
            { slug: 'sitefoot', area: 'footer', tagName: 'footer', source: { page: 'home', index: 2 } },
        ],
        templates: { index: [
            { type: 'part', slug: 'topbar', tagName: 'header' },
            { type: 'post-content' },
            { type: 'part', slug: 'sitefoot', tagName: 'footer' },
        ] },
        pages: [
            { page: 'home', slug: 'home', title: 'Home', front: true, template: '', stripIndexes: [0, 2] },
            { page: 'about', slug: 'about', title: 'About', front: false, template: '', stripIndexes: [0, 2] },
        ],
        mediaMap: {},
    });

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
    assert.ok(result.files.length > 10);
    fs.rmSync(path.join(MINI, 'theme'), { recursive: true, force: true });
    fs.rmSync(path.join(MINI, 'theme-plugin'), { recursive: true, force: true });
});
```

- [ ] **Step 2: Run to verify failure**, then **Step 3: implement**

```js
// tools/theme/scaffold.mjs
import fs from 'node:fs';
import path from 'node:path';
import { resolvePath, writeFile, writeJson } from '../lib/workspace.mjs';
import { ensureBlocksRegistered, serializeBlocks } from '../lib/wp-serialize.mjs';
import { loadPageTrees } from './evidence.mjs';
import { rewriteTreePresets, rewriteCssVars, rewriteLinks, rewriteMediaUrls } from './rewrites.mjs';
import { styleCss, functionsPhp, buildThemeJson, templateMarkup, DEFAULT_TEMPLATES } from './generate/theme-files.mjs';
import { writeBlocksPlugin } from './generate/blocks-plugin.mjs';
import { writeContentPlugin } from './generate/content-plugin.mjs';

export function scaffoldBlockTheme(args) {
    const workspaceRoot = resolvePath(args.workspaceRoot);
    const { slug, name, tokenMap, mediaMap = {} } = args;
    const themeDir = path.join(workspaceRoot, 'theme', slug);
    const files = [];

    ensureBlocksRegistered(workspaceRoot);
    const pages = new Map(loadPageTrees(workspaceRoot).map((p) => [p.page, p.tree]));
    const linkMap = buildLinkMap(args.pages, workspaceRoot);

    const transformTree = (blocks) => blocks
        .map((b) => rewriteTreePresets(b, tokenMap))
        .map((b) => deepMapStrings(b, (s) => rewriteMediaUrls(rewriteLinks(s, linkMap), mediaMap, '{{THEME_URI}}')));

    // parts
    for (const part of args.parts) {
        const tree = pages.get(part.source.page);
        if (!tree) throw new Error(`Part ${part.slug}: unknown source page ${part.source.page}`);
        const block = tree.blocks[part.source.index];
        if (!block) throw new Error(`Part ${part.slug}: no block at index ${part.source.index} on ${part.source.page}`);
        const markup = serializeBlocks(transformTree([block]), {});
        writeFile(path.join(themeDir, `parts/${part.slug}.html`), themeAssetUrls(markup));
        files.push(`parts/${part.slug}.html`);
    }

    // templates: agent-specified + standing defaults using index chrome
    const templates = { ...args.templates };
    const chrome = (args.templates.index || []).filter((e) => e.type === 'part');
    const chromeTop = chrome.slice(0, Math.ceil(chrome.length / 2));
    const chromeBottom = chrome.slice(Math.ceil(chrome.length / 2));
    for (const [tplName, body] of Object.entries(DEFAULT_TEMPLATES)) {
        templates[tplName] ??= [...chromeTop, ...body, ...chromeBottom];
    }
    for (const [tplName, entries] of Object.entries(templates)) {
        writeFile(path.join(themeDir, `templates/${tplName}.html`), templateMarkup(entries));
        files.push(`templates/${tplName}.html`);
    }

    // per-page content payload
    const contentPages = args.pages.map((page) => {
        const tree = pages.get(page.page);
        const strip = new Set(page.stripIndexes || []);
        const blocks = tree.blocks.filter((_, i) => !strip.has(i));
        return { ...page, markup: serializeBlocks(transformTree(blocks), {}) };
    });

    // theme.json / style.css / functions.php
    const themeJson = buildThemeJson({
        settings: args.themeSettings,
        styles: deepMapStrings(args.themeStyles || {}, (s) => rewriteCssVars(s, tokenMap.custom)),
        fontFamilies: args.fontFamilies || [],
        templateParts: args.parts.map(({ slug: s, area, tagName }) => ({ slug: s, area, ...(tagName ? { tagName } : {}) })),
        customTemplates: Object.keys(args.templates).filter((t) => !['index', 'archive', 'single', '404'].includes(t) && !t.startsWith('page-') && !t.startsWith('front-page'))
            .map((t) => ({ name: t, title: t, postTypes: ['page'] })),
    });
    writeJson(path.join(themeDir, 'theme.json'), themeJson);
    const css = rewriteMediaUrls(rewriteCssVars(args.customCss || '', tokenMap.custom), mediaMap, '..');
    writeFile(path.join(themeDir, 'style.css'), styleCss({ name, slug, description: args.description }, css));
    const blocksResult = writeBlocksPlugin({ workspaceRoot, slug, themeName: name, outDir: path.join(workspaceRoot, 'theme-plugin', `${slug}-blocks`) });
    writeFile(path.join(themeDir, 'functions.php'), functionsPhp({ slug, customBlocks: blocksResult.blocks }));
    files.push('theme.json', 'style.css', 'functions.php');

    // media copy
    for (const [from, to] of Object.entries(mediaMap)) {
        const dest = path.join(themeDir, to);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(path.join(workspaceRoot, from), dest);
        files.push(to);
    }

    const contentResult = writeContentPlugin({ slug, themeName: name, outDir: path.join(workspaceRoot, 'theme-plugin', `${slug}-content`), pages: contentPages });
    return {
        themeDir, files,
        blocksPlugin: blocksResult.blocks.length ? `theme-plugin/${slug}-blocks` : null,
        contentPlugin: `theme-plugin/${slug}-content`,
        pages: contentPages.map(({ markup, ...p }) => p),
        next: 'Run validate_block_theme, then playground_render.',
    };
}

function buildLinkMap(pages, workspaceRoot) {
    // map each source page's mockup filename to its permalink path
    const map = {};
    for (const page of pages) {
        const file = page.sourceFile || `${page.page}.html`;
        map[file] = page.front ? '/' : `/${page.slug}/`;
    }
    return map;
}

export function deepMapStrings(value, fn) {
    if (typeof value === 'string') return fn(value);
    if (Array.isArray(value)) return value.map((v) => deepMapStrings(v, fn));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deepMapStrings(v, fn)]));
    return value;
}

function themeAssetUrls(markup) {
    // parts/templates live in the theme: {{THEME_URI}} placeholders are not
    // resolvable there, so reference assets relatively from the theme root.
    return markup.split('{{THEME_URI}}/').join('');
}
```

**Implementer notes:** (a) `buildLinkMap` needs the original mockup filename per page — extend the `pages` arg entries with `sourceFile` (e.g. `"Bucharest Feline Show.html"`) and document it in the tool schema (Task 16); the mini fixture test passes without it because its trees contain no cross-links. (b) `serializeBlocks` context `{}` must match what Task 4's smoke test established. (c) Index template chrome split (`chromeTop`/`chromeBottom`) is a heuristic only for the *default* generic templates; the agent can always specify `archive`/`single`/`404` explicitly to override.

- [ ] **Step 4: Run tests** — `npm test` → PASS (whole suite).
- [ ] **Step 5: Commit**

```bash
git add tools/theme/scaffold.mjs tools/theme/scaffold.test.mjs
git commit -m "Add block theme scaffold orchestrator"
```

---

### Task 14: validate.mjs + vendored schema

**Files:**
- Create: `tools/theme/theme-json-schema.json` (vendored)
- Create: `tools/theme/validate.mjs`
- Create: `tools/theme/validate.test.mjs`
- Modify: `package.json` (add `ajv`)

- [ ] **Step 1: Vendor the schema and add ajv**

```bash
curl -fsSL https://schemas.wp.org/wp/6.7/theme.json -o tools/theme/theme-json-schema.json
npm install ajv@^8
```

(Pin to the 6.7 schema, matching `Requires at least: 6.6`+current Playground. If the download URL 404s, use `https://schemas.wp.org/trunk/theme.json` and note the pin in the file's first line via a `"$comment"` you add to the JSON.)

- [ ] **Step 2: Write failing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateBlockTheme } from './validate.mjs';
import { scaffoldBlockTheme } from './scaffold.mjs';
const MINI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/mini');

function scaffoldMini() { /* same args object as scaffold.test.mjs — extract into fixtures/mini/scaffold-args.mjs and import from both tests */ }

test('validateBlockTheme passes a freshly scaffolded mini theme', () => {
    scaffoldMini();
    const report = validateBlockTheme({ workspaceRoot: MINI, slug: 'mini', write: false });
    assert.deepEqual(report.errors, []);
    assert.equal(report.passed, true);
});

test('validateBlockTheme catches violations', () => {
    scaffoldMini();
    const theme = path.join(MINI, 'theme/mini');
    fs.writeFileSync(path.join(theme, 'parts/orphan.html'), '<!-- wp:not-a-real/block /-->');
    fs.appendFileSync(path.join(theme, 'style.css'), '\n.x{background:url(https://cdn.example.com/x.png)}');
    fs.rmSync(path.join(theme, 'templates/index.html'));
    const report = validateBlockTheme({ workspaceRoot: MINI, slug: 'mini', write: false });
    assert.equal(report.passed, false);
    assert.ok(report.errors.some((e) => e.includes('templates/index.html')));
    assert.ok(report.errors.some((e) => e.includes('not-a-real/block')));
    assert.ok(report.errors.some((e) => e.includes('remote url')));
    cleanupMini();
});
```

(Extract the shared scaffold args from Task 13's test into `tools/theme/fixtures/mini/scaffold-args.mjs` exporting `miniScaffoldArgs(MINI)` and a `cleanupMini()` that removes `theme/` and `theme-plugin/`; refactor scaffold.test.mjs to use it in this task.)

- [ ] **Step 3: Implement**

```js
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
    const known = new Set(wpBlocks.getBlockTypes().map((b) => b.name));
    for (const sub of ['templates', 'parts']) {
        const dir = path.join(themeDir, sub);
        if (!fs.existsSync(dir)) continue;
        for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.html'))) {
            const rel = `${sub}/${file}`;
            const parsed = wpBlocks.parse(readIfExists(path.join(dir, file)));
            walkParsed(parsed, (b) => {
                if (b.blockName === null && b.innerHTML.trim() !== '') errors.push(`${rel}: contains freeform/unparsed content`);
                if (b.blockName && !known.has(b.blockName)) errors.push(`${rel}: unknown block ${b.blockName}`);
            });
            if (sub === 'templates') {
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
        must(partFiles.includes(tp.slug), `theme.json templatePart ${tp.slug} has no parts/${tp.slug}.html`);
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
```

- [ ] **Step 4: Run tests** — PASS. (If the vendored schema trips ajv on other draft-04isms, keep `strict: false` and add `ajv-formats` only if an error demands it; the tests define done.)
- [ ] **Step 5: Commit**

```bash
git add tools/theme/validate.mjs tools/theme/validate.test.mjs tools/theme/theme-json-schema.json tools/theme/fixtures/mini/scaffold-args.mjs tools/theme/scaffold.test.mjs package.json package-lock.json
git commit -m "Add static block theme validator with vendored schema"
```

---

### Task 15: playground.mjs — render gate

**Files:**
- Create: `tools/theme/playground.mjs`
- Create: `tools/theme/playground.test.mjs`
- Modify: `package.json` (add `@wp-playground/cli` as devDependency)

- [ ] **Step 1: Install and verify the CLI exists**

```bash
npm install --save-dev @wp-playground/cli
npx @wp-playground/cli --help
```

Expected: help text listing a `server` command with `--blueprint`, `--mount`, `--port` style options. **If flag names differ from what this task assumes, adapt `buildCliArgs` below to the installed version — the unit test pins our builder, the acceptance run pins reality.**

- [ ] **Step 2: Write failing test for the pure builders**

```js
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
```

- [ ] **Step 3: Implement**

```js
// tools/theme/playground.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { resolvePath, readJson, writeJson } from '../lib/workspace.mjs';
import { loadCaptureDeps, serveDirectory, captureUrl, capture, comparePngs, DEFAULT_VIEWPORTS } from '../lib/capture.mjs';
import { PLUGIN_ROOT } from '../lib/workspace.mjs';

export function buildBlueprint({ slug, hasBlocksPlugin }) {
    const prefix = slug.replace(/-/g, '_') + '_content';
    return {
        landingPage: '/',
        steps: [
            ...(hasBlocksPlugin ? [{ step: 'activatePlugin', pluginPath: `${slug}-blocks/${slug}-blocks.php` }] : []),
            { step: 'activatePlugin', pluginPath: `${slug}-content/${slug}-content.php` },
            { step: 'activateTheme', themeFolderName: slug },
            { step: 'runPHP', code: `<?php require '/wordpress/wp-load.php'; var_export(${prefix}_import_pages());` },
        ],
    };
}

export function buildCliArgs({ slug, themeDir, pluginDirs, blueprintPath, port }) {
    return [
        'server',
        `--port=${port}`,
        `--blueprint=${blueprintPath}`,
        `--mount=${themeDir}:/wordpress/wp-content/themes/${slug}`,
        ...pluginDirs.map((dir) => `--mount=${dir}:/wordpress/wp-content/plugins/${path.basename(dir)}`),
    ];
}

export function pageUrl(base, page) {
    return page.front ? `${base}/` : `${base}/?pagename=${page.slug}`;
}

export async function playgroundRender(args) {
    const workspaceRoot = resolvePath(args.workspaceRoot);
    const slug = args.slug;
    const themeDir = path.join(workspaceRoot, 'theme', slug);
    const blocksDir = path.join(workspaceRoot, 'theme-plugin', `${slug}-blocks`);
    const contentDir = path.join(workspaceRoot, 'theme-plugin', `${slug}-content`);
    const manifest = readJson(path.join(contentDir, 'content/manifest.json'));
    const hasBlocksPlugin = fs.existsSync(blocksDir);
    const port = args.port || 9400;
    const base = `http://127.0.0.1:${port}`;
    const outDir = path.join(workspaceRoot, 'reports/playground');
    fs.mkdirSync(outDir, { recursive: true });

    const blueprintPath = path.join(outDir, 'blueprint.json');
    writeJson(blueprintPath, buildBlueprint({ slug, hasBlocksPlugin }));
    const proc = spawn('npx', ['@wp-playground/cli', ...buildCliArgs({
        slug, themeDir, blueprintPath, port,
        pluginDirs: [blocksDir, contentDir].filter((d) => fs.existsSync(d)),
    })], { cwd: PLUGIN_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let logs = '';
    proc.stdout.on('data', (d) => { logs += d; });
    proc.stderr.on('data', (d) => { logs += d; });

    try {
        await waitForServer(base, 120000, () => proc.exitCode);
        const { chromium, PNG, pixelmatch } = await loadCaptureDeps(PLUGIN_ROOT);
        const browser = await chromium.launch({ headless: true });
        const server = await serveDirectory(workspaceRoot); // mockup screenshots through the same pipeline
        const thresholds = { maxMismatchPercent: args.maxMismatchPercent ?? 1, maxHeightDelta: args.maxHeightDelta ?? 8 };
        const pagesReport = [];
        try {
            for (const page of manifest.pages) {
                const mockupPath = page.mockupPath || inferMockupPath(workspaceRoot, page);
                const results = [];
                for (const viewport of args.viewports || DEFAULT_VIEWPORTS) {
                    const mockShot = path.join(outDir, `${page.slug}-mockup-${viewport.name}.png`);
                    const wpShot = path.join(outDir, `${page.slug}-wp-${viewport.name}.png`);
                    const diffShot = path.join(outDir, `${page.slug}-diff-${viewport.name}.png`);
                    await captureUrl(browser, server.urlFor(mockupPath), mockShot, viewport);
                    await captureUrl(browser, pageUrl(base, page), wpShot, viewport);
                    results.push(comparePngs({ target: 'wordpress', mockupShot: mockShot, candidateShot: wpShot, diffShot, viewport, PNG, pixelmatch }));
                }
                const aggregate = {
                    maxMismatchPercent: Math.max(...results.map((r) => r.mismatchPercent)),
                    maxHeightDelta: Math.max(...results.map((r) => r.heightDelta)),
                };
                pagesReport.push({ page: page.slug, mockupPath, results, aggregate,
                    passed: aggregate.maxMismatchPercent <= thresholds.maxMismatchPercent && aggregate.maxHeightDelta <= thresholds.maxHeightDelta });
            }
        } finally {
            await browser.close();
            await server.close?.();
        }
        const report = {
            generatedAt: new Date().toISOString(), thresholds, pages: pagesReport,
            aggregates: {
                maxMismatchPercent: Math.max(...pagesReport.map((p) => p.aggregate.maxMismatchPercent)),
                maxHeightDelta: Math.max(...pagesReport.map((p) => p.aggregate.maxHeightDelta)),
            },
            passed: pagesReport.every((p) => p.passed),
        };
        writeJson(path.join(workspaceRoot, 'reports/theme-comparison.json'), report);
        return report;
    } catch (error) {
        throw new Error(`playground_render failed: ${error.message}\n--- playground logs (tail) ---\n${logs.slice(-2000)}`);
    } finally {
        proc.kill('SIGTERM');
    }
}

async function waitForServer(base, timeoutMs, exited) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (exited() !== null) throw new Error('playground process exited before becoming ready');
        try {
            const res = await fetch(base, { redirect: 'manual' });
            if (res.status < 500) return;
        } catch { /* not up yet */ }
        await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`playground server not ready after ${timeoutMs}ms`);
}

function inferMockupPath(workspaceRoot, page) {
    for (const candidate of [`mockup/${page.sourceFile || ''}`, `mockup/${page.page || page.slug}.html`, 'mockup/index.html']) {
        if (candidate !== 'mockup/' && fs.existsSync(path.join(workspaceRoot, candidate))) return candidate;
    }
    throw new Error(`No mockup found for page ${page.slug}; pass mockupPath in the manifest page entry.`);
}
```

For `inferMockupPath` to work, extend `writeContentPlugin`'s manifest page entries (Task 11) to carry through `page` (the workspace page id), `sourceFile`, and optional `mockupPath` from the scaffold args — add the passthrough in Task 11's manifest writer (`{ ...page }` already passes unknown fields; just confirm the test covers `sourceFile`).

- [ ] **Step 4: Run unit tests** — `npm test` → PASS (builders only; the full boot is exercised in Task 18).
- [ ] **Step 5: Commit**

```bash
git add tools/theme/playground.mjs tools/theme/playground.test.mjs package.json package-lock.json
git commit -m "Add WordPress Playground render gate"
```

---

### Task 16: Register the six tools in mcp-server.mjs

**Files:**
- Modify: `tools/mcp-server.mjs` (TOOLS array + handlers map)

- [ ] **Step 1: Add tool definitions**

Append to the `TOOLS` array (follow the existing entry style exactly):

```js
{
    name: 'analyze_theme_evidence',
    description: 'Scan all page block trees and workspace CSS into a style-evidence report (recurring colors/fonts/spacing with occurrence counts, custom properties, support usage, lift buckets per CSS rule). Facts only — the agent decides what lifts into theme.json.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['workspaceRoot'], properties: { workspaceRoot: { type: 'string' } } },
},
{
    name: 'infer_template_parts',
    description: 'Group top-level subtrees across pages by exact and structural hashes into template-part candidates with occurrence, position, tag evidence and per-page variance tables. No header/footer assumptions — evidence only.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['workspaceRoot'], properties: { workspaceRoot: { type: 'string' } } },
},
{
    name: 'fetch_theme_fonts',
    description: 'Resolve the mockup CSS Google Fonts @import to local woff2 files under the theme assets and return ready theme.json fontFace entries. Fails explicitly offline.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['workspaceRoot', 'slug'], properties: { workspaceRoot: { type: 'string' }, slug: { type: 'string' }, importUrl: { type: 'string' } } },
},
{
    name: 'scaffold_block_theme',
    description: 'Write the block theme (style.css, theme.json, templates incl. default archive/single/404, parts, functions.php, assets), the blocks plugin, and the content plugin payload from agent-authored decisions. Owns serialization and the mechanical rewrites (preset refs, --wp--custom-- renames, permalinks, media placeholders).',
    inputSchema: { type: 'object', additionalProperties: false,
        required: ['workspaceRoot', 'slug', 'name', 'tokenMap', 'themeSettings', 'themeStyles', 'parts', 'templates', 'pages'],
        properties: {
            workspaceRoot: { type: 'string' }, slug: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' },
            tokenMap: { type: 'object' }, themeSettings: { type: 'object' }, themeStyles: { type: 'object' },
            fontFamilies: { type: 'array' }, customCss: { type: 'string' },
            parts: { type: 'array' }, templates: { type: 'object' }, pages: { type: 'array' }, mediaMap: { type: 'object' },
        } },
},
{
    name: 'validate_block_theme',
    description: 'Static gate: theme.json schema (vendored), template/part parse with all blocks registered, header/file/ref/fontFace/remote-url/payload checks. Writes reports/theme-validation.json.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['workspaceRoot', 'slug'], properties: { workspaceRoot: { type: 'string' }, slug: { type: 'string' } } },
},
{
    name: 'playground_render',
    description: 'Boot the theme + plugins in WordPress Playground, import the pages through the content plugin, screenshot every page logged-out at both viewports, and diff against the mockups. Writes reports/theme-comparison.json with the standard thresholds.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['workspaceRoot', 'slug'], properties: { workspaceRoot: { type: 'string' }, slug: { type: 'string' }, port: { type: 'number' }, maxMismatchPercent: { type: 'number' }, maxHeightDelta: { type: 'number' } } },
},
```

- [ ] **Step 2: Wire handlers**

```js
import { analyzeThemeEvidence } from './theme/evidence.mjs';
import { inferTemplateParts } from './theme/parts.mjs';
import { fetchThemeFonts } from './theme/fonts.mjs';
import { scaffoldBlockTheme } from './theme/scaffold.mjs';
import { validateBlockTheme } from './theme/validate.mjs';
import { playgroundRender } from './theme/playground.mjs';
// in handlers map:
analyze_theme_evidence: (args) => analyzeThemeEvidence(args),
infer_template_parts: (args) => inferTemplateParts(args),
fetch_theme_fonts: (args) => {
    const workspaceRoot = resolvePath(args.workspaceRoot);
    return fetchThemeFonts({
        ...args,
        sourceCss: readIfExists(path.join(workspaceRoot, 'mockup/style.css')) || readIfExists(path.join(workspaceRoot, 'wordpress/style.css')),
        targetDir: path.join(workspaceRoot, 'theme', args.slug, 'assets/fonts'),
    });
},
scaffold_block_theme: (args) => scaffoldBlockTheme(args),
validate_block_theme: (args) => validateBlockTheme(args),
playground_render: (args) => playgroundRender(args),
```

- [ ] **Step 3: Verify over stdio**

```bash
npm run check && npm test
./artifacts/mcp-call.sh analyze_theme_evidence '{"workspaceRoot": "examples/bucharest-feline-show"}' | head -20
./artifacts/mcp-call.sh infer_template_parts '{"workspaceRoot": "examples/bucharest-feline-show"}' | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d['groups']), 'groups'); [print(g['kind'], [o['page']+':'+str(o['index']) for o in g['occurrences']]) for g in d['groups']]"
git checkout examples/  # discard generated reports from the fixture workspace
```

Expected: evidence JSON with colors led by `#0b0b0b`-family values; parts groups showing the nav (structural, 3 pages), footer (structural — Follow vs Navigate), endband (structural, 2 pages), page-hero (structural, 2 pages).

- [ ] **Step 4: Commit**

```bash
git add tools/mcp-server.mjs
git commit -m "Register blocks-to-theme tools on the MCP server"
```

---

### Task 17: SKILL.md, references, repo wiring

**Files:**
- Create: `skills/blocks-to-theme/SKILL.md`
- Create: `skills/blocks-to-theme/references/theme-json-mapping.md`
- Create: `skills/blocks-to-theme/references/template-part-inference.md`
- Create: `skills/blocks-to-theme/references/template-planning.md`
- Create: `skills/blocks-to-theme/references/fonts-and-media.md`
- Create: `skills/blocks-to-theme/references/playground-gate.md`
- Modify: `.codex-plugin/plugin.json`, `README.md`

- [ ] **Step 1: Write SKILL.md**

Frontmatter + body. Use this content (it is the contract — keep the gate wording exact):

```markdown
---
name: blocks-to-theme
description: Use when a user asks to turn the output of an html-to-blocks run (single or multi page) into an installable WordPress block theme. Extracts theme.json from style evidence, infers template parts from cross-page repetition (no header/footer assumptions), plans templates with index plus generic archive/single/404 defaults, bundles fonts and media, generates a blocks plugin and a content import/remove plugin, and verifies the theme in WordPress Playground against the mockups.
---

# Blocks To Theme

Run this skill on a COMPLETED html-to-blocks workspace (its comparison gates
passed). The tools gather evidence and verify; you make the design decisions.

## Required Workflow

1. Run `analyze_theme_evidence`; read `reports/theme-evidence.json`.
2. Run `infer_template_parts`; read `reports/template-parts.json`.
3. Read `references/theme-json-mapping.md`, `references/template-part-inference.md`,
   and `references/template-planning.md`. Write `plan/theme-plan.md` containing:
   the token map (value → preset slug), the lift ledger, the parts decision for
   every evidence group (unify / variant parts / leave in content, with the cited
   group), the template plan, the page manifest (slugs, titles, front page), and
   the media map.
4. Run `fetch_theme_fonts` (read `references/fonts-and-media.md` first).
5. Run `scaffold_block_theme` with the plan's decisions as data.
6. Run `validate_block_theme`; fix and re-scaffold until `errors` is empty.
7. Run `playground_render` (read `references/playground-gate.md` first); repair
   until every page passes both viewports. Expect block-library and global-styles
   CSS interference the preview never had — fix it in theme.json or theme
   style.css, never by editing content payloads to dodge the diff.
8. Final response: quote `reports/theme-validation.json` (`passed`) and
   `reports/theme-comparison.json` aggregates.

## Hard Gates

### Evidence Gate
No template part without a cited occurrence group from
`reports/template-parts.json`. The standing template set is `index.html` plus
the generic defaults `archive.html`, `single.html`, `404.html` (no evidence
needed — composed from inferred chrome + global styles). Any template beyond
that set needs a cited difference in chrome variants or the front-page
designation. Single-page runs normally produce zero parts.

### Lift-First Gate
Every rule remaining in theme `style.css` or any `styles.blocks[...].css`
carries a reason category in the plan's lift ledger: `media-query`, `pseudo`,
`position`, `blend`, `grid`, or `interaction`. A rule with no category must be
lifted into theme.json (presets, root styles, elements, block styles). Do not
solve fidelity by dumping the workspace stylesheet into the theme.

### Completion Gate
The run is complete only when `validate_block_theme` reports zero errors AND
`reports/theme-comparison.json` shows every page within thresholds
(`maxMismatchPercent <= 1`, `maxHeightDelta <= 8`) at both viewports. Quote
both in the final response. Otherwise keep repairing or report the run blocked
with the metrics and the blocking cause.
```

- [ ] **Step 2: Write the five references**

Each is a focused document; write them with this exact content coverage (prose can be tightened, rules must all appear):

`theme-json-mapping.md` — the lifting ladder (presets → root/element styles → block styles → variations → per-block css → style.css with the six reason categories); the two mechanical rewrites with examples (`#0B0B0B` + token map → `"backgroundColor":"ink"`; `var(--pad)` → `var(--wp--custom--pad)`, definition dropped from `:root`); preset naming rules (name after source custom properties; only exact value matches rewrite — never "close" values); clamp() values are preserved verbatim in presets; warning that `settings.custom` keys are camelCased by WP when emitting CSS vars (use lowercase single-word names to avoid surprises); what must NOT lift (media queries, pseudo-elements, position/blend/grid/interaction) and that `styles.css`-in-theme.json is not used by this pipeline (file `style.css` is, for inspectability).

`template-part-inference.md` — exact vs structural hash semantics with a worked example (same nav, different `is-current`); the three decisions per structural group (unify / variant parts / leave in content) and when each is right (invisible variance → unify; visible per-page chrome state → variant parts named `<role>-<page>`; copy differences in otherwise unique sections → content); position/tag evidence drives names and `area`; never extract a part from a single-page run; variance tables list exact attr paths — read them before deciding, do not eyeball.

`template-planning.md` — standing set (index + archive/single/404 defaults); when `page-{slug}` is justified (different chrome variant set, cited); when `front-page` is justified; templates contain chrome + `post-content` only — page copy lives in the imported pages; the default generic templates inherit index's chrome and global styles and are not pixel-gated (no mockup exists for them — validation only).

`fonts-and-media.md` — fetch flow (css2 URL from mockup CSS, woff2 UA, per-face download, naming scheme); fontFace entries land in `settings.typography.fontFamilies[].fontFace` via the scaffold; offline = blocked run, never ship the remote `@import`; media inventory comes from the trees + CSS `url()` scan, copies into `assets/media/`, payload uses `{{THEME_URI}}` placeholders resolved at import, theme CSS uses relative paths; the validator enforces zero remote URLs.

`playground-gate.md` — what the blueprint does (activate plugins/theme, runPHP import — the same function the admin button calls); pages are captured logged-out at `/?pagename=<slug>` (front page at `/`) so no rewrite-flush dependency; both sides of the diff go through the same capture path as html-to-blocks; expected new interference (block-library CSS, global-styles preset CSS, layout supports) and where to fix what (theme.json for token/element-level, theme style.css for structural shims, never the content payload); first run downloads the WP build (network); reading `reports/theme-comparison.json` and the repair loop stopping rule (same as html-to-blocks: passing thresholds is the only successful end state).

- [ ] **Step 3: Wire the repo**

`.codex-plugin/plugin.json`: add the skill entry alongside `html-to-blocks` (mirror its existing shape — open the file and copy the structure).
`README.md`: add a "Stage 2: blocks-to-theme" section after the existing workflow: one paragraph (what it does), the tool list (6 names), and the workflow's 8 steps in compressed form; update the "MCP Tools" list to include the new six.

- [ ] **Step 4: Verify and commit**

```bash
npm run check && npm test
./artifacts/mcp-call.sh analyze_theme_evidence '{"workspaceRoot": "tools/theme/fixtures/mini"}' >/dev/null && echo ok
git checkout tools/theme/fixtures/ 2>/dev/null || true  # discard report churn in fixture
git add skills/blocks-to-theme/ .codex-plugin/plugin.json README.md
git commit -m "Add blocks-to-theme skill, references and repo wiring"
```

---

### Task 18: Acceptance — full run on bucharest-feline-show

This task is agent-driven (it exercises judgment, not just code): follow `skills/blocks-to-theme/SKILL.md` end-to-end on `examples/bucharest-feline-show`.

- [ ] **Step 1: Evidence + inference**

```bash
./artifacts/mcp-call.sh analyze_theme_evidence '{"workspaceRoot": "examples/bucharest-feline-show"}'
./artifacts/mcp-call.sh infer_template_parts '{"workspaceRoot": "examples/bucharest-feline-show"}'
```

Expected evidence: bone/ink/acid colors dominating with `names` from `--bone`/`--ink`/`--acid`; expected groups: site-nav (structural ×3 — `is-current` + hrefs vary), footer (structural ×3 — Follow vs Navigate column), page-hero (structural ×2), endband (structural ×2).

- [ ] **Step 2: Write `plan/theme-plan.md`** in the workspace per the skill (token map: bone/bone-2/ink/ink-soft/acid/acid-deep palette; `--pad`/`--ease`/`--ease-io`/`--line`/`--line-strong` to `settings.custom`; nav and footer as per-page variant parts — expect `nav-home`/`nav-judges`/`nav-contact` and `footer-home`/`footer-inner`; templates: `index` (home chrome), `page-judges`, `page-contact`; front page = home).

- [ ] **Step 3: Fonts, scaffold, validate**

```bash
./artifacts/mcp-call.sh fetch_theme_fonts '{"workspaceRoot": "examples/bucharest-feline-show", "slug": "maison-feline"}' 120
# then scaffold_block_theme with the plan's full args, then:
./artifacts/mcp-call.sh validate_block_theme '{"workspaceRoot": "examples/bucharest-feline-show", "slug": "maison-feline"}'
```

Iterate until `"passed": true`.

- [ ] **Step 4: Playground gate**

```bash
./artifacts/mcp-call.sh playground_render '{"workspaceRoot": "examples/bucharest-feline-show", "slug": "maison-feline"}' 600
```

Iterate repairs (theme.json / theme style.css only) until `"passed": true` for all three pages at both viewports. Inspect `reports/playground/*-diff-*.png` for anything the numbers hide.

- [ ] **Step 5: Commit the example outputs** (the workspace is gitignored under `examples/`; commit nothing — instead paste the final aggregates into the PR/summary) and update `docs/superpowers/specs/2026-06-12-blocks-to-theme-design.md` Status line to `implemented`.

```bash
git add docs/superpowers/specs/2026-06-12-blocks-to-theme-design.md
git commit -m "Mark blocks-to-theme spec implemented"
```

---

## Self-review notes (already applied)

- Spec coverage: evidence (T5/6), parts inference (T7), fonts (T8), rewrites/scaffold/plugins (T9–T13), standing default templates incl. user's archive/single/404 decision (T12/T13), static gate (T14), Playground gate (T15), tools registration (T16), skill + references + wiring (T17), acceptance (T18). Theme→blocks-plugin admin notice: T12 `functionsPhp`. Content plugin admin screen: T11. `{{THEME_URI}}`: T11/T13/T14.
- Known judgment points left to the executing agent on purpose: exact fixture-count assertions (T6), Playground CLI flag drift (T15 Step 1 names the adaptation), serializer context shape (T4 forces it early).
- Types/names used consistently: `loadPageTrees` (T6→T7/T13), `ensureBlocksRegistered(workspaceRoot, {blocksDir})` (T3→T13/T14), `serializeBlocks` (T3→T13), token map shape (T9→T13), manifest page fields (T11→T15).
```
