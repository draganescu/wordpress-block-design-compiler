---
name: html-to-blocks
description: Use when a user asks to transform designed or provided HTML/CSS/JS into editable WordPress block content. Runs a staged workflow: generate or import an HTML mockup, plan core and custom blocks, generate vanilla JS custom blocks when needed, assemble a data-only block tree, compare screenshots, and iterate from explicit repair tasks until visual drift is low.
---

# HTML To Blocks

Use this skill when the user wants an HTML/CSS/JS design or provided markup transformed into editable WordPress blocks. The agent remains responsible for design judgment and code edits. The tools provide workspace setup, mockup analysis, custom-block scaffolding, preview wrapping, screenshot comparison, and DOM geometry measurement (`measure_layout`).

## Fast Path — minimum turns

This skill is turn-bound: each page is **author once → `build_page` → repair →
`build_page`**, not a five-tool round-trip per iteration. Follow the recipe; do
not re-plan between calls.

1. **One `build_page` call replaces** serialize → create_block_editor_preview →
   screenshot_html → compare_html → measure_layout. It returns ONE report:
   per-surface metrics, per-section height deltas (`driftedSections`), localized
   `tasks`, `diffImages` paths, and the style audit. Act on `driftedSections`
   (largest `|deltaHeight|` first) and `tasks` in **one** edit pass, then call
   `build_page` again. Open a `diffImages` path only when the numbers are
   ambiguous — do not read screenshots every turn.
2. **Author the whole page tree in one write.** Never section-by-section.
3. **Read budget:** work from tool output, not raw files. Do not read the mockup
   stylesheet or `content-inventory.json` wholesale — `analyze_mockup` is
   exhaustive (every band, including non-semantic `<div>` bands, flagged
   `structural` when it has no heading/card/form) and `build_page` localizes drift
   for you.
4. **The capture self-heals mockup load/scroll animations** (the body load-fade and
   `.reveal`/AOS/WOW scroll-reveal are forced visible for the screenshot). Do NOT
   hand-patch the mockup CSS to un-blank a shot — that is handled in the tool.

### Multi-page protocol (declare all → foundation → fan out)

1. `import_provided_markup` once; read the `pages` manifest and **declare all pages
   up front**.
2. Build the **foundation page** (usually index) fully with the loop above — it
   locks the shared chrome, design tokens, and reusable components.
3. **Fan the remaining pages out to parallel subagents**, dispatched in one
   message, each owning ONE page, with a tool-call budget (~30) and a wall-clock
   cap. On exceed a subagent reports partial metrics and stops; it does not grind.
   Cap concurrency to a handful.
4. **Per-page CSS goes to `wordpress/pages/<page>.css`**, not the shared
   `wordpress/style.css`, so parallel agents never clobber one file — `build_page`
   and the theme scaffold pick those up automatically.
5. Each page is PASS or blocked-with-metrics under its cap. "Most pass, a few
   blocked at the floor" is a complete run.

The numbered workflow below is the underlying contract; the Fast Path is how to
execute it in the fewest turns.

## Required Workflow

1. Create an artifact workspace with `create_workspace`.
2. If the user provided existing markup, run `import_provided_markup` and treat that imported HTML/CSS as the source mockup. Otherwise generate `mockup/index.html`, `mockup/style.css`, and optional `mockup/script.js` from the user request plus `references/design-prompt.md`.
3. Run `analyze_mockup` and read `analysis/content-inventory.json`.
4. Write `plan/block-plan.md` and `plan/block-plan.json`.
5. Generate custom blocks only where core blocks cannot preserve both fidelity and editability. Before creating any custom section block, complete the Core-First Gate below.
6. Assemble editable block content in `wordpress/block-tree.json`; put custom block source in `wordpress/blocks/<slug>/`; put styling in block support/style attributes first, custom block scoped CSS second, and tiny page CSS last.
7. Run `serialize_wordpress_blocks`; it registers official core blocks with `@wordpress/block-library`, registers custom blocks from `wordpress/blocks/*/index.js`, serializes `wordpress/block-tree.json` with `@wordpress/blocks`, writes canonical block markup to `wordpress/content.html`, writes frontend preview HTML to `rendered/rendered-blocks.html`, writes a no-build editable block editor preview to `editor/block-editor.html`, and writes `reports/style-audit.json`. The preview CSS source list comes from `wordpress/style.css` and custom block `style.css` files. `mockup/style.css` is intentionally excluded from rendered block preview by default.
8. Use `create_block_editor_preview` whenever you need to refresh or inspect a block editor instance from a generated tree without reserializing all outputs. For multi-file generations, call it per tree/page.
9. Use `screenshot_html` for inspection screenshots of mockup, rendered, editor, or arbitrary workspace HTML files. For multi-file generations, pass explicit targets for the page under inspection.
10. Run `compare_html`.
11. When a comparison fails, run `measure_layout` BEFORE staring at pixel diffs: it returns per-element top/height deltas between the mockup and the rendered or editor page (`candidateKind: "editor"`), aligned by selector order. Drill from sections to children with narrower selectors until the drift names a specific element, then fix that. Pixel diffs localize; measurements identify.
12. Inspect rendered frontend screenshots, editable editor screenshots, and diffs. Write the repair-tasks file, fix each task as an agent, then repeat preview/compare until both saved frontend and editor-preview thresholds are met. Do not stop at "close", "structurally close", or "good enough".
13. Run `audit_standins` and read `reports/standins.json`. Confirm every data-driven region is a marked core-block stand-in (not a custom block), and that no stand-in references a postType/taxonomy the content model will not provide. Stand-ins stay static until the content-modeling skill runs `hydrate_standins`.

Default thresholds: `maxMismatchPercent <= 1` and `maxHeightDelta <= 8`.

Completion requires both comparison aggregates to pass for EVERY page in the run:

- `aggregates.rendered.maxMismatchPercent <= maxMismatchPercent` and `aggregates.rendered.maxHeightDelta <= maxHeightDelta`
- `aggregates.editor.maxMismatchPercent <= maxMismatchPercent` and `aggregates.editor.maxHeightDelta <= maxHeightDelta`

Comparison reports are per page: `reports/comparison.json` for the index page, `reports/<page>.comparison.json` for the rest. They never overwrite each other; a complete multi-page run leaves one passing report per page.

Each page's repair loop is **bounded** — see `references/repair-loop.md`: at most
6 iterations per page, stop early on a plateau (2 iterations each improving
`maxMismatchPercent` by <0.3%), and on cap/plateau without passing, record that
page **blocked** with its metrics rather than grinding on. A geometry-exact
surface still reads ~1% from webfont antialiasing — that is the floor and passes;
mismatch well above ~1.5% with small height deltas is real line-height drift, not
a floor (do not relabel it "done"). Report the run with every page's end-state
(passed / blocked + metrics); do not present a blocked page as complete, and do
not exceed the per-page cap chasing a sub-threshold number.

## Multi-Page Exports

`import_provided_markup` detects sibling `.html` pages in the source root and returns a `pages` manifest with suggested per-page paths. Follow the manifest conventions for every page, including the primary/index page, so the workspace stays symmetric:

- Block tree: `wordpress/pages/<page>.block-tree.json`
- Serialized markup: `wordpress/pages/<page>.content.html`
- Frontend preview: `rendered/<page>.html`
- Editor preview: `editor/<page>.html`
- Comparison report: `reports/<page>.comparison.json` (pass via `compare_html`'s defaults — the report name is derived from the mockup filename)

Workflow for multi-page runs:

1. Import once; read the `pages` manifest.
2. Analyze and read every page before planning: shared chrome (header/nav/footer), shared components (cards, forms, teasers), and page-local sections. Plan custom blocks ONCE for the whole site; pages reuse them with different attributes.
3. Build and fully pass one page first (usually the index) — it forces the shared blocks, design tokens, and editor parity into shape. Subsequent pages then converge in a few iterations each.
4. Page-specific CSS goes into clearly labelled sections of `wordpress/style.css` (or block CSS when component-scoped). Keep the shared token/base layer at the top.
5. Run serialize + compare per page with the manifest paths. The completion gate applies to every page; a run where one page fails is an incomplete run.
6. Beware margins hidden by layout context: a missing margin can be invisible at desktop (a taller sibling column masks it) and only surface at mobile when columns stack. Always compare both viewports per page.

## Effort Budget and Delegation Limits

A multi-page run is a budget, not an open-ended grind. State the page count and
plan before building; for large sites, build ONE foundation page fully (it locks
shared chrome, tokens, and custom blocks), then converge the rest under the cap.

- **Per page:** at most 6 repair iterations (`references/repair-loop.md`), then
  PASS or report blocked. Retry a page at most ONCE.
- **Delegating pages to subagents:** give each a tool-call budget (≈30 calls) and
  a wall-clock timeout; on exceed it stops and reports its partial metrics — it
  does not keep going. Cap concurrency to a handful. Do not fan out one agent per
  page across a large site with no budget.
- **Whole-run stop condition:** every page is PASS or blocked-with-metrics.
  "Most pages pass, a few blocked at the floor" is a complete, honestly-reported
  run — not a reason to keep grinding the blocked ones.

## Known Harness Artifacts — Do Not Chase

Not fidelity defects. Recognize them and STOP rather than burning iterations:

- **Webfont-load reflow.** The capture waits for `document.fonts.ready`, but
  residual sub-pixel antialiasing of identical webfonts across two DOM contexts
  still costs ~1% mismatch on a geometry-exact surface. That ~1% is the floor.
- **Shared template parts.** Nav and footer become ONE template part in the
  theme. When page mockups carry slightly different footer copy/links, reuse the
  shared chrome — the per-page difference is expected and resolved at the theme
  stage. Never fork shared chrome per page to win a diff.
- **Editor-only canvas quirks.** The no-build editor preview adds wrappers/inline
  styles the frontend lacks; normalize via editor-scoped CSS, do not restructure
  blocks to match the canvas.

## Hard Gates

### Core-First Gate

Before generating custom blocks or `wordpress/block-tree.json`, write a core-first audit in `plan/block-plan.md`:

- For every mockup section, list the candidate core block assembly first.
- For every chosen core block, list the native attributes/support props that will carry the visual styling before writing CSS.
- Only then list any custom block and the specific reason core blocks fail.
- A custom block that replaces a whole section is rejected unless the section itself is a real submission form (contact/newsletter/booking) or a genuinely bespoke interactive widget with a typed editing model that no core block expresses. Navigation, search, site identity, comments, pagination, and post fields are NOT custom-block reasons — they are real core blocks (see "The serializer is not the design" below).
- Complex layout is not a sufficient reason for a custom block. Use `core/group`, `core/columns`, `core/column`, `core/heading`, `core/paragraph`, `core/buttons`, `core/button`, `core/list`, `core/details`, `core/image`, `core/media-text`, `core/spacer`, and supports/classes first.
- The final tree should normally contain far more core blocks than custom blocks. If custom blocks approach the core-block count, treat the plan as failed unless the user explicitly asked for mostly custom blocks.
- If the editable preview drifts because WordPress editor wrappers, RichText sizing, placeholders, or editor chrome alter layout, fix the editor harness, custom block `edit()`, or editor-scoped CSS. Do not replace core assemblies with custom section blocks to make editor comparison easier.

### The serializer is not the design

"It doesn't render in the static preview" is a HARNESS fact, never a design fact, and never a valid core-rejection reason. WordPress server-renders its dynamic blocks; the pipeline renders them too, via `tools/lib/dynamic-render.mjs`, so they now appear on both preview surfaces. Use the real core block and prepopulate it:

- Navigation → `core/navigation` with `core/navigation-link` / `core/navigation-submenu` inner blocks (prepopulated, it serializes and previews as a real menu). Never a custom "site-nav" block.
- Search → `core/search` (label, placeholder, buttonText, buttonPosition). Never a custom "search-form".
- Site identity → `core/site-title`, `core/site-tagline`, `core/site-logo`. A text wordmark is `core/site-title` (+ a tagline/paragraph), not an image and not a custom block.
- Comments → `core/comments`; comment form → `core/post-comments-form`. Never a custom "comment-form".
- Pagination → `core/query-pagination` (+ `-previous`/`-numbers`/`-next`). Prev/next post → `core/post-navigation-link`. Never a custom "pagination" block.
- Images → `core/image`. Missing media is a `data:` SVG placeholder at the right aspect ratio in the `url`, NOT an image URL hidden in InspectorControls and NOT a custom media block.

If a dynamic core block genuinely cannot preview after prepopulation, that is a renderer-shim gap to report and fix in `dynamic-render.mjs`, not a licence to invent a custom block.

Supply `wordpress/preview-context.json` (`{ "siteTitle": "...", "siteLogoUrl": "...", "homeUrl": "...", "postDate": "...", "postTerms": "..." }`) so the entity-backed blocks (site title/logo, post date/terms) render with real-looking values on both surfaces.

### Provided markup is binding

When the source export annotates intended blocks — `<!-- core/navigation -->`, `<!-- core/search -->`, a handoff table that maps components to blocks, a data file shaped like a CPT — those are requirements, not hints. Use the named block. Deviating needs an explicit design-level reason written in the plan, never "the serializer/editor preview is easier this way".

### Stand-ins for data-driven regions

Some regions are real queries/comments with no data yet (object/product grids, post indexes, comment threads). Build them as a static core-block composition seeded with representative content so the visual gate can style them, and MARK the region with `attrs.metadata.standin`:

- repeating container → `{ "for": "core/query", "postType": "...", "taxonomy": "...", "query": { "perPage": N, "orderBy": "date", "order": "desc" } }`; the container's FIRST child is the item template.
- each per-item field inside that template → `{ "for": "core/post-title" | "core/post-featured-image" | "core/post-terms" | "core/post-excerpt" | "core/post-date" }`.
- comment thread → `{ "for": "core/comments" }`.

The card itself stays real core blocks (`core/group` + `core/image` + `core/heading` + `core/paragraph`), with stable classNames the CSS targets — never a custom "post-card" block, and never a `variant` enum encoding placement (featured/row/grid is layout, expressed by the container's class/CSS, not the content model). Run `audit_standins` before completion; the content-modeling skill later runs `hydrate_standins` to swap these into `core/query`/`core/comments` against real seed content.

### Completion Gate

Before final response, read `reports/comparison.json` and state the rendered/editor aggregate metrics. You may only say the run is done when both aggregates pass the configured thresholds. If they do not pass, keep repairing or say the run is blocked; never summarize a failed comparison as a successful skill execution.

## Design Stage

Read `references/design-prompt.md` before generating the mockup. Make one strong visual direction, not a generic template. The mockup can use expressive HTML/CSS/JS, but it must be inspectable and deterministic: no network assets, no remote fonts, no runtime build tools.

If the markup is provided, skip mockup generation. Use `import_provided_markup` to copy the existing site export into `mockup/`, bundle local linked stylesheets into `mockup/style.css` for analysis, and preserve the provided HTML as the visual source of truth. Do not redesign or simplify provided markup before analysis.

## Block Planning

Read `references/block-planning.md` and `references/core-block-selection.md` before writing the plan.

The plan must answer:

- Which sections are core block assemblies.
- Which specific core blocks are chosen and why they are a better fit than nearby alternatives.
- Which sections require custom blocks and why.
- Which styling belongs in block support attributes, block style variations/classes, custom block scoped CSS, or page CSS.
- Which content remains inline editable.
- Which settings belong in InspectorControls or BlockControls.
- How each core assembly or custom block will keep the editable editor canvas visually aligned with the saved frontend.
- Which parts may use `core/html`, with explicit reasons.

Prefer core blocks, block supports, and style variations before custom blocks. The legitimate custom-block cases are narrow: a real submission form WordPress has no core block for (contact, newsletter, booking, sourcing request) that must save semantic `<form>` markup, or a genuinely bespoke interactive widget with a typed editing model. Repeated content cards are NOT a custom-block case — they are core-block stand-ins for a `core/query` (see the Core-First Gate). Search, navigation, comments, pagination, site identity, and post fields are NOT custom-block cases — they are real dynamic core blocks. Do not create a custom block to make a section easier to render or repair.

Styling priority is strict:

1. Use native block attributes and block support attributes in `wordpress/block-tree.json`: media URLs, overlay settings, focal points, min heights, `backgroundColor`, `textColor`, `gradient`, `style.background`, `style.spacing`, `style.color`, `style.typography`, `style.border`, `style.dimensions`, `layout`, `align`, `className`, and preset color/spacing/font attributes.
2. Use custom block attributes and style variations/classes when an editor-facing design choice needs a named setting.
3. Use `wordpress/blocks/<slug>/style.css` only for scoped internals that supports cannot express: pseudo-elements, nested form controls, sticky behavior, horizontal rails, overlapping children, responsive grid templates, ornaments, and interaction states.
4. Use `wordpress/style.css` only for design tokens, document-level defaults, shared responsive rules, and page-specific glue that cannot be attached to a block.

Do not solve visual parity by dumping the mockup stylesheet into `wordpress/style.css`. After serialization, inspect `reports/style-audit.json`; a good transform should show substantial `blocksWithSupportAttrs` usage and keep page CSS small enough to explain line-by-line.

Use only real WordPress core block names and attributes registered by `@wordpress/block-library`. Do not invent convenience core blocks such as `core/link`, and do not use `core/group` as an arbitrary HTML element factory. `core/group` is for block-level layout containers only; inline elements, definition lists, navigation shells, telemetry panels, and other semantic structures need either real core blocks or custom blocks with typed attributes.

## Custom Blocks

Read `references/custom-block-standards.md` before creating custom blocks.

Generated blocks must use vanilla JavaScript with WordPress globals. No JSX/build step is assumed. Use the `scaffold_custom_block` tool for a correct baseline, then edit the generated files to match the mockup precisely.

Visible content belongs in the canvas with `RichText`. Behavior and design settings belong in `InspectorControls`, `BlockControls`, and native block supports. Do not render `TextControl` or `TextareaControl` as the primary in-canvas UI for visible content.

Forms, search boxes, subscriptions, booking widgets, and contact/inquiry UI must render real semantic `<form>` markup on save.

The `edit()` output must visually match the mockup and the saved frontend, not merely expose controls. Use the same root tag, class names, child order, repeated-item layout, and visual structure as `save()`. Editor-only wrappers, controls, helper labels, and disabled form behavior must not change layout geometry in screenshot comparison.

## Assembly

The block assembly source of truth is `wordpress/block-tree.json`, not hand-written block comments or saved HTML. The tree is data-only: `blockName`, `attrs`, `innerBlocks`, block styles, support-like attributes, and classes. `serialize_wordpress_blocks` turns that data into canonical block markup by calling WordPress block package serialization, official core block `save()` implementations, and each registered custom block's `save()` implementation.

Never put `htmlLines`, `innerHTML`, `innerContent`, `html`, `markup`, or `sourceHtml` in `wordpress/block-tree.json`. The serializer rejects those fields.

The serializer also rejects unregistered core block names, attributes absent from WordPress block metadata, and non-layout `core/group` tag names. If WordPress core cannot model a structure cleanly, generate a custom static block whose attributes represent the editable content model.

The tree should match the mockup, not merely contain the same text. Preserve source order, links, labels, placeholders, repeated items, and button group layout. Use stable class names that map cleanly to CSS.

Do not hide structure inside rich-text attributes. Inline rich text is acceptable for emphasis or spans inside a heading; repeated items, forms, metrics, timelines, maps, and data blocks should be represented as custom block attributes and saved by the custom block's `save()` implementation.

Do not use `mockup/style.css` as the rendered block stylesheet. Generate separate WordPress CSS in `wordpress/style.css` and custom block `style.css` files so comparison measures the transform, not shared source CSS.

## Reusable Editor Inspection

The editor setup is reusable and must not be recreated by hand for each generated page.

- Use `create_block_editor_preview` to write a no-build editor page that loads a specific block tree JSON file, CSS sources, and workspace custom blocks.
- For a single page, the default paths are `wordpress/block-tree.json` and `editor/block-editor.html`.
- For multi-file generations, store each page tree under a stable path such as `wordpress/pages/home.block-tree.json` or `wordpress/pages/shop.block-tree.json`, then call `create_block_editor_preview` with `treePath` and `editorPath` for that page.
- Use `screenshot_html` with `kind: "editor"` to capture editor screenshots for inspection without running a diff.
- Keep the block tree as the source of truth. The editor preview is an inspection surface, not a separate implementation.

## Repair Loop

Read `references/repair-loop.md` and `references/css-transfer-gotchas.md` before starting visual repair.

The comparison tool returns metrics and images; the agent must inspect the screenshots/diffs and write concrete tasks. Tasks must be implementation-level:

- visible issue
- target file/selector/block
- cause
- exact fix
- verification check

Repair from large to small:

1. Missing/extra/escaped content and semantic failures.
2. Macro section layout and grid geometry.
3. Responsive structure.
4. Editor-surface drift: `edit()` structure, RichText tag/class parity, disabled form geometry, wrapper classes, and editor-only CSS.
5. Component scale, wrapper, and selector failures.
6. Spacing, color, and typography polish.

Do not spend a pass on minor spacing while obvious missing buttons, stacked button groups, broken marquees, wrong grid geometry, or fake forms remain.

## Expected Output

When done, leave the workspace with:

- `mockup/index.html`
- `mockup/style.css`
- `plan/block-plan.md`
- `plan/block-plan.json`
- `wordpress/block-tree.json`
- `wordpress/content.html` generated from the block tree
- `wordpress/style.css`
- `wordpress/blocks/*`
- `rendered/rendered-blocks.html`
- `editor/block-editor.html`
- `reports/comparison.json`
- `reports/repair-tasks.md`
