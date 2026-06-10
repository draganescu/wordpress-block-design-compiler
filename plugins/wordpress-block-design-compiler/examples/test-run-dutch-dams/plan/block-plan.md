# Dutch Dams Block Plan

## Intent

Build the "Mastering the Water" homepage as editable block data while preserving the editorial, asymmetric mockup. Core blocks carry normal document structure, headings, links, paragraphs, and broad groups. Custom static blocks carry repeated or highly specific design structures that would be brittle or semantically wrong as core block nests.

## Core Blocks

- `core/group` for header, main, editorial sections, gateway panel, and layout containers.
- `core/link` for navigation and text links, using nested typed inline blocks where the visual label needs split spans/strong text.
- `core/heading` and `core/paragraph` for standard editorial copy.
- Inline `core/group` with `tagName` for spans/strongs inside headings and labels, so the tree stays data-only without raw HTML fragments.

## Custom Blocks

- `wbdc/water-control-grid`: asymmetric metric/data-block system. Attributes contain tiles with number, title, body, metric, and visual variant. Renders a semantic section of articles.
- `wbdc/dam-timeline-rail`: horizontal timeline rail. Attributes contain events with year, title, text, and highlight state. Renders time-based article nodes.
- `wbdc/dam-cross-section`: dam section diagram. Attributes contain layer labels/classes and caption. Renders a figure with diagram slices.
- `wbdc/archive-reveal-band`: archival reveal strip. Attributes contain plates with label, title, body, and visual plate class. Renders article plates.

## Data Contract

`wordpress/block-tree.json` is version 2, `contract: "data-only"`. It contains no `htmlLines`, `innerHTML`, `innerContent`, `html`, `markup`, `sourceHtml`, or raw tag fragments inside attributes. Preview HTML is derived from attrs, classes, styles, nested blocks, and custom `render.mjs` functions.
