---
name: build-wordpress-block-site
description: Use when a user asks to create a website, landing page, homepage, microsite, or theme page that should become editable WordPress block content. Runs a staged workflow: generate a beautiful HTML/CSS/JS mockup, plan core and custom blocks, generate vanilla JS custom blocks, assemble a data-only block tree, compare screenshots, and iterate from explicit repair tasks until visual drift is low.
---

# Build WordPress Block Site

Use this skill when the user wants a website that should end as editable WordPress blocks. The agent remains responsible for design judgment and code edits. The tools provide workspace setup, mockup analysis, custom-block scaffolding, preview wrapping, and screenshot comparison.

## Required Workflow

1. Create an artifact workspace with `create_workspace`.
2. Generate `mockup/index.html`, `mockup/style.css`, and optional `mockup/script.js` from the user request plus `references/design-prompt.md`.
3. Run `analyze_mockup` and read `analysis/content-inventory.json`.
4. Write `plan/block-plan.md` and `plan/block-plan.json`.
5. Generate custom blocks only where core blocks cannot preserve both fidelity and editability.
6. Assemble editable block content in `wordpress/block-tree.json`; put custom block source in `wordpress/blocks/<slug>/`.
7. Run `serialize_wordpress_blocks`; it registers custom blocks from `wordpress/blocks/*/index.js`, serializes `wordpress/block-tree.json` with `@wordpress/blocks`, writes canonical block markup to `wordpress/content.html`, and writes frontend preview HTML to `rendered/rendered-blocks.html`.
8. Run `compare_html`.
9. Inspect screenshots and diffs, write `reports/repair-tasks.md`, fix each task as an agent, then repeat preview/compare until thresholds are met.

Default thresholds: `maxMismatchPercent <= 1` and `maxHeightDelta <= 8`.

## Design Stage

Read `references/design-prompt.md` before generating the mockup. Make one strong visual direction, not a generic template. The mockup can use expressive HTML/CSS/JS, but it must be inspectable and deterministic: no network assets, no remote fonts, no runtime build tools.

## Block Planning

Read `references/block-planning.md` before writing the plan.

The plan must answer:

- Which sections are core block assemblies.
- Which sections require custom blocks and why.
- Which styling belongs in block supports, block attributes, block CSS, or page CSS.
- Which content remains inline editable.
- Which settings belong in InspectorControls or BlockControls.
- Which parts may use `core/html`, with explicit reasons.

Prefer core blocks, block supports, style variations, and scoped CSS before custom blocks. Use custom blocks for reusable data models, real forms/search/booking widgets, nontrivial repeated components, or semantic save contracts.

## Custom Blocks

Read `references/custom-block-standards.md` before creating custom blocks.

Generated blocks must use vanilla JavaScript with WordPress globals. No JSX/build step is assumed. Use the `scaffold_custom_block` tool for a correct baseline, then edit the generated files to match the mockup precisely.

Visible content belongs in the canvas with `RichText`. Behavior and design settings belong in `InspectorControls`, `BlockControls`, and native block supports. Do not render `TextControl` or `TextareaControl` as the primary in-canvas UI for visible content.

Forms, search boxes, subscriptions, booking widgets, and contact/inquiry UI must render real semantic `<form>` markup on save.

## Assembly

The block assembly source of truth is `wordpress/block-tree.json`, not hand-written block comments or saved HTML. The tree is data-only: `blockName`, `attrs`, `innerBlocks`, block styles, support-like attributes, and classes. `serialize_wordpress_blocks` turns that data into canonical block markup by calling WordPress block package serialization and each registered block's `save()` implementation.

Never put `htmlLines`, `innerHTML`, `innerContent`, `html`, `markup`, or `sourceHtml` in `wordpress/block-tree.json`. The serializer rejects those fields.

The tree should match the mockup, not merely contain the same text. Preserve source order, links, labels, placeholders, repeated items, and button group layout. Use stable class names that map cleanly to CSS.

Do not hide structure inside rich-text attributes. Inline rich text is acceptable for emphasis or spans inside a heading; repeated items, forms, metrics, timelines, maps, and data blocks should be represented as custom block attributes and saved by the custom block's `save()` implementation.

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
4. Component scale, wrapper, and selector failures.
5. Spacing, color, and typography polish.

Do not spend a pass on minor spacing while obvious missing buttons, stacked button groups, broken marquees, wrong grid geometry, or fake forms remain.

## Expected Output

When done, leave the workspace with:

- `mockup/index.html`
- `mockup/style.css`
- `plan/block-plan.md`
- `plan/block-plan.json`
- `wordpress/block-tree.json`
- `wordpress/content.html` generated from the block tree
- `wordpress/blocks/*`
- `rendered/rendered-blocks.html`
- `reports/comparison.json`
- `reports/repair-tasks.md`
