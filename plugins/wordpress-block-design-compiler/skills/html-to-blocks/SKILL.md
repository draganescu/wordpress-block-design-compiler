---
name: html-to-blocks
description: Use when a user asks to transform designed or provided HTML/CSS/JS into editable WordPress block content. Runs a staged workflow: generate or import an HTML mockup, plan core and custom blocks, generate vanilla JS custom blocks when needed, assemble a data-only block tree, compare screenshots, and iterate from explicit repair tasks until visual drift is low.
---

# HTML To Blocks

Use this skill when the user wants an HTML/CSS/JS design or provided markup transformed into editable WordPress blocks. The agent remains responsible for design judgment and code edits. The tools provide workspace setup, mockup analysis, custom-block scaffolding, preview wrapping, and screenshot comparison.

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
11. Inspect rendered frontend screenshots, editable editor screenshots, and diffs. Write `reports/repair-tasks.md`, fix each task as an agent, then repeat preview/compare until both saved frontend and editor-preview thresholds are met. Do not stop at "close", "structurally close", or "good enough".

Default thresholds: `maxMismatchPercent <= 1` and `maxHeightDelta <= 8`.

Completion requires both `reports/comparison.json` aggregates to pass:

- `aggregates.rendered.maxMismatchPercent <= maxMismatchPercent` and `aggregates.rendered.maxHeightDelta <= maxHeightDelta`
- `aggregates.editor.maxMismatchPercent <= maxMismatchPercent` and `aggregates.editor.maxHeightDelta <= maxHeightDelta`

If these criteria are not met, the skill run is incomplete. Continue repairing. If progress is impossible after concrete repair attempts, report the run as blocked with the current metrics and blocking cause; do not present it as complete.

## Hard Gates

### Core-First Gate

Before generating custom blocks or `wordpress/block-tree.json`, write a core-first audit in `plan/block-plan.md`:

- For every mockup section, list the candidate core block assembly first.
- For every chosen core block, list the native attributes/support props that will carry the visual styling before writing CSS.
- Only then list any custom block and the specific reason core blocks fail.
- A custom block that replaces a whole section is rejected unless the section itself is a semantic widget, form, query/data component, navigation component, or reusable component with a typed editing model.
- Complex layout is not a sufficient reason for a custom block. Use `core/group`, `core/columns`, `core/column`, `core/heading`, `core/paragraph`, `core/buttons`, `core/button`, `core/list`, `core/details`, `core/image`, `core/media-text`, `core/spacer`, and supports/classes first.
- The final tree should normally contain more core blocks than custom blocks. If custom blocks are equal to or more than core blocks, treat the plan as failed unless the user explicitly asked for mostly custom blocks.
- If the editable preview drifts because WordPress editor wrappers, RichText sizing, placeholders, or editor chrome alter layout, fix the editor harness, custom block `edit()`, or editor-scoped CSS. Do not replace core assemblies with custom section blocks to make editor comparison easier.

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

Prefer core blocks, block supports, and style variations before custom blocks. Use custom blocks for reusable data models, real forms/search/booking widgets, nontrivial repeated components, or semantic save contracts. Do not create a custom block just to make a section easier to render or repair.

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

Read `references/repair-loop.md` before starting visual repair.

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
