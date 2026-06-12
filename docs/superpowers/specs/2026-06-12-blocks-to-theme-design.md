# blocks-to-theme — Design

Date: 2026-06-12
Status: approved design, pre-implementation
Repo: wordpress-block-design-compiler

## Purpose

A second skill, `blocks-to-theme`, that takes the output of a completed
html-to-blocks run (single- or multi-page) and extracts a valid, installable
WordPress block theme from it. The skill converts run evidence into:

- a `theme.json` carrying as much of the design as technically possible
  (presets, global styles, per-block styles, block style variations);
- template parts inferred from cross-page repetition evidence — never from
  assumptions such as "look for a header and a footer";
- theme templates inferred from the block trees, with `templates/index.html`
  as the minimal guaranteed default;
- bundled local fonts and media declared through theme.json;
- two companion plugins (custom blocks; content import/remove).

Fidelity is paramount: anything theme.json cannot structurally represent is
preserved as custom CSS, but every such rule must carry a documented reason.
This implements the "Theme Inference Comes Later" stage anticipated in
spec.md (§8): an extraction pass over repeated evidence from successful
transforms, not an upfront constraint.

## Decisions (settled during design)

1. **Completion gate**: real-WordPress render via WordPress Playground CLI,
   screenshot-diffed against the mockups with the existing thresholds
   (mismatch ≤ 1%, height delta ≤ 8px, desktop 1440 + mobile 390, every page).
2. **Custom blocks**: packaged in a companion *blocks plugin*; the theme does
   not register blocks.
3. **Two plugins, not one**: blocks plugin (hard dependency of the rendered
   content) and content plugin (disposable import/remove tooling). The theme
   requires the blocks plugin; nothing requires the content plugin.
4. **Content model**: real pages + thin templates. Inferred chrome lives in
   template parts; everything page-specific becomes actual WP page content,
   imported via the content plugin. Templates compose parts +
   `core/post-content`.
5. **Assets**: fonts and media are bundled locally (woff2 in
   `assets/fonts/` via `theme.json` `fontFace`, media in `assets/media/`).
   No remote references survive in the theme.
6. **Architecture**: same MCP server, new tool modules (`tools/theme/*.mjs`),
   new skill folder with its own references. Tools are deterministic
   evidence-gatherers and verifiers; the agent makes design judgments.

## Inputs and outputs

**Input**: an html-to-blocks workspace — `wordpress/block-tree.json` or
`wordpress/pages/*.block-tree.json`, `wordpress/style.css`,
`wordpress/blocks/*/`, per-page serialized content, and the mockups (the
fidelity reference for the gate).

**Output** (inside the same workspace):

```
theme/<slug>/
  style.css                  theme header + only unliftable CSS
  theme.json                 v3: settings presets, styles, templateParts, customTemplates
  templates/                 index.html always; others only when inferred
  parts/                     only what inference concluded (may be empty)
  assets/fonts/              bundled woff2, declared via fontFace
  assets/media/              copied media, URLs rewritten
  functions.php              style.css enqueue, add_editor_style, blocks-plugin admin notice
theme-plugin/<slug>-blocks/    custom block registration plugin
theme-plugin/<slug>-content/   content import/remove plugin (manifest + payload + admin screen)
plan/theme-plan.md             agent-authored: token map, lift ledger, parts/templates plan
reports/theme-evidence.json    tool output: style evidence
reports/template-parts.json    tool output: subtree repetition evidence
reports/theme-validation.json  static gate result
reports/theme-comparison.json  Playground gate result (per page, existing aggregates shape)
```

## Required workflow (SKILL.md)

1. `analyze_theme_evidence` → read `reports/theme-evidence.json`.
2. `infer_template_parts` → read `reports/template-parts.json`.
3. Write `plan/theme-plan.md`: token mapping, lift ledger, parts decision per
   evidence group, template plan, content split, front-page designation.
4. `fetch_theme_fonts` → woff2 files + ready `fontFace` entries.
5. Author theme.json content + partition decisions as data;
   `scaffold_block_theme` deterministically writes theme, plugins, and
   content payload (it owns all block serialization, reusing the existing
   registration machinery).
6. `validate_block_theme` → repair until clean.
7. `playground_render` → repair until every page passes both viewports.
8. Completion: quote validation result and comparison aggregates.

### Hard gates

- **Evidence Gate**: no template part without a cited occurrence group from
  `reports/template-parts.json`. The standing template set is `index.html`
  plus the generic-situation defaults `archive.html`, `single.html`, and
  `404.html` (good practice; composed from the inferred chrome + global
  styles, no per-run evidence required). Any template beyond that set needs
  a cited difference in chrome variants or front-page designation.
  Single-page runs normally produce zero parts.
- **Lift-First Gate**: every rule remaining in `style.css` or block `css`
  carries a reason category: `media-query` | `pseudo` | `position` | `blend`
  | `grid` | `interaction` | `selector` (rule targets an arbitrary class
  composition that theme.json cannot address; never valid for body, bare
  elements, or block roots). A rule with no category must lift to theme.json.
  The ledger lives in `plan/theme-plan.md`.
- **Completion Gate**: `validate_block_theme` clean AND
  `reports/theme-comparison.json` aggregates within thresholds for every
  page. Both quoted in the final response. Anything less is incomplete or
  blocked — never "close enough".

## Tools (registered in tools/mcp-server.mjs, implemented in tools/theme/)

### analyze_theme_evidence (`tools/theme/evidence.mjs`)

Scans all page trees + `wordpress/style.css` + `wordpress/blocks/*/style.css`.
Emits facts, no decisions: recurring colors / font stacks / font sizes /
spacing values with occurrence counts and locations (block attrs vs CSS,
which selectors); CSS custom properties and their usage; which block types
carry which support attrs; selector buckets (media-query, pseudo, position,
blend, grid, interaction candidates) for the lift ledger.

### infer_template_parts (`tools/theme/parts.mjs`)

For every top-level subtree on every page computes:
- **exact hash**: blockName + normalized attrs + child hashes (content
  included);
- **structural hash**: content-insensitive — blockName + classNames +
  attribute keys + child structure.

Groups across pages. Output per group: kind (exact | structural),
occurrences (page, path, index-in-page, first/last flags), variance table
for structural groups (exactly which attrs/text differ per page), and tag
evidence (`tagName` from the tree). The agent maps groups to decisions:
*unify*, *variant parts* (e.g. `nav-home` / `nav-inner` when a current-page
flag differs), or *leave in content*. Part names and `templateParts[].area`
come from this evidence (a part may be named "footer" because its subtree
says `tagName: "footer"` and sits last on every page — concluded, not
assumed). Single-page runs: no cross-page evidence → no candidates.

### fetch_theme_fonts (`tools/theme/fonts.mjs`)

Resolves the source Google Fonts `@import` (families, weights, styles) to
woff2 files downloaded into `theme/<slug>/assets/fonts/`, returns ready
`fontFace` entries (file-relative `src`). Offline → explicit error; the run
reports blocked rather than falling back to remote fonts.

### scaffold_block_theme (`tools/theme/scaffold.mjs`)

Takes agent-authored data (theme.json content, part definitions as
tree-paths, template compositions, page manifest, token map) and writes
everything deterministically:

- theme skeleton: `style.css` header, `theme.json`, `templates/*.html`,
  `parts/*.html`, `functions.php`, assets;
- blocks plugin from `wordpress/blocks/*` (`register_block_type` per
  block.json);
- content plugin: admin screen code, `content/manifest.json`,
  `content/<slug>.html` payload per page (page tree minus extracted part
  subtrees, serialized through @wordpress/blocks);
- mechanical rewrites (exact-match only, driven by the approved token map):
  - preset refs: raw values matching a preset become preset syntax in block
    attrs across templates, parts, payload;
  - custom property names: `var(--x)` → `var(--wp--custom--x)` across
    theme.json values, all CSS, all markup (no `:root` alias bridge);
  - internal links: `<page>.html` → permalink paths from the manifest;
  - media URLs: rewritten to a `{{THEME_URI}}` placeholder in the payload
    (resolved at import time), and to relative paths in theme CSS.

### validate_block_theme (`tools/theme/validate.mjs`)

All checks hard:
- theme.json validates against a vendored, version-pinned schema (no
  network);
- every `templates/*.html` and `parts/*.html` parses via @wordpress/blocks
  with core + plugin blocks registered; zero invalid/unknown blocks;
- `style.css` header completeness; slug/text-domain consistency;
- `templates/index.html` exists; every template contains `core/post-content`;
- `theme.json` `templateParts[]` ↔ `parts/` files reconcile; every
  `wp:template-part` ref resolves;
- every `fontFace.src` exists; no remote `url()`/`@import` anywhere in theme
  CSS or theme.json;
- content plugin manifest ↔ payload files reconcile; no internal `*.html`
  links and no raw absolute asset URLs in the payload;
- `Requires Plugins:` header present on the content plugin.

### playground_render (`tools/theme/playground.mjs`)

Dev dependency `@wp-playground/cli`. Blueprint: mount theme + both plugins,
activate, set `/%postname%/` permalinks, `runPHP` the content plugin's
import function (the same code path as the admin button), serve. Captures
the manifest's page URLs logged-out with the existing Playwright path (same
viewports, reducedMotion, animations disabled, full page); recaptures
mockups in the same pass; runs the existing PNG comparison; writes
`reports/theme-comparison.json` in the existing aggregates/thresholds shape.

Known repair territory, named upfront: the real frontend loads
block-library CSS and global-styles output that the html-to-blocks rendered
preview deliberately excluded (separator opacity, button resets, layout
supports). The repair loop resolves such drift in theme.json/`style.css`,
never by editing content. First run needs network to cache the WP build.

## theme.json lifting ladder (reference: theme-json-mapping.md)

1. settings presets: palette (named from source custom properties where they
   exist), fontFamilies + fontFace, fontSizes (clamp() preserved verbatim),
   spacingSizes, `settings.custom` for non-preset tokens;
2. global styles: body → `styles.color/typography`; anchors →
   `styles.elements.link`; shared heading treatment →
   `styles.elements.heading`; block-generic CSS → `styles.blocks[...]`;
3. block style variations: named variants (e.g. a `--solid` button) become
   registered block styles (registration in the blocks plugin) styled via
   `styles.blocks[...].variations`;
4. `styles.blocks[block].css` (with `&` scoping) for block-scoped internals
   supports cannot express;
5. `style.css` file only for: media queries, pseudo-element ornaments,
   position compositions, mix-blend-mode, grid templates, interaction
   states. Served to the editor too via `add_editor_style`.

## Companion plugins

**`<slug>-blocks`**: registers the run's custom blocks from their block.json
files. Nothing else. The theme's `functions.php` checks for it and shows a
persistent admin notice naming it when missing (no fatal; custom-block
markup degrades silently) — WordPress has no theme→plugin requires header.

**`<slug>-content`**: declares `Requires Plugins: <slug>-blocks`. Admin
screen (Tools → "<Theme name> content") listing each manifest page with live
status: *not imported* / *imported* / *modified since import*
(`post_modified` vs stored import timestamp). Actions:
- **Import**: `wp_insert_post` per page from the payload, stamps a marker
  meta, stores a slug→post_id map in one option, resolves `{{THEME_URI}}`,
  sets `show_on_front`/`page_on_front` per manifest. Idempotent; never
  overwrites slug collisions with user content (reports them).
- **Remove**: deletes exactly the mapped posts that still carry the marker,
  warns on modified pages, resets front-page options when applicable.
Nothing runs on activation; import is always explicit. Deleting the plugin
after import has no effect on the site.

## Templates

- `templates/index.html` always: most-common chrome variants +
  `core/post-content` with a non-constraining layout so content sections
  render full-bleed exactly like the static pages.
- `page-{slug}.html` only when that page's chrome variant set differs from
  index's choice (the nav current-page variant case).
- `front-page.html` only when the manifest designates a front page and its
  chrome differs from index.
- Always make archive, single and 404 templates for generic situations; anything beyond
 generic cites evidence in the plan.

## Edge cases

- Pure-core run: no blocks plugin, no dependency notice.
- Single page: zero parts, index-only, one-page manifest — valid theme.
- Offline font fetch: run blocked with explicit cause.
- First Playground run: needs network for the WP build cache.

## Repo changes

```
skills/blocks-to-theme/SKILL.md
skills/blocks-to-theme/references/
  theme-json-mapping.md, template-part-inference.md, template-planning.md,
  fonts-and-media.md, playground-gate.md
tools/theme/{evidence,parts,fonts,scaffold,validate,playground}.mjs
tools/lib/                       shared capture/compare/workspace helpers
                                 extracted from mcp-server.mjs (targeted move,
                                 not a rewrite) and used by both skills
tools/mcp-server.mjs             registers the 6 new tools
tools/theme/theme-json-schema.json  vendored, version-pinned schema for validation
.codex-plugin/plugin.json        lists the second skill
README.md                        documents the second stage
package.json                     + @wp-playground/cli (dev)
```

## Acceptance

Run the full pipeline on `examples/bucharest-feline-show` (multi-page, 4
custom blocks, variant chrome — exercises variant parts, preset rewriting,
fonts, both plugins). Done = `validate_block_theme` clean + all three pages
pass the Playground comparison at both viewports. A single-page smoke run
follows later; it is not part of this milestone.
