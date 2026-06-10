# Dutch Dams Block Plan

## Intent

Build the "Mastering the Water" homepage as editable block data while preserving the editorial, asymmetric mockup. Core blocks carry normal document structure, headings, paragraphs, real buttons, and broad layout groups. Custom static blocks carry semantic structures that core cannot represent cleanly without fake blocks or arbitrary group-generated tags.

## Core Blocks

- `core/group` for main, editorial sections, and block-level layout containers only.
- `core/heading` and `core/paragraph` for standard editorial copy.
- `core/buttons` and `core/button` for the closing return action.

## Custom Blocks

- `wbdc/dam-navigation`: semantic header/navigation shell. Attributes contain brand mark, title, nav links, action link, and labels.
- `wbdc/dam-gateway`: editorial gateway plus telemetry panel. Attributes contain title lines, thesis, status, and definition-list metrics.
- `wbdc/water-control-grid`: asymmetric metric/data-block system. Attributes contain tiles with number, title, body, metric, and visual variant. Renders a semantic section of articles.
- `wbdc/dam-timeline-rail`: horizontal timeline rail. Attributes contain events with year, title, text, and highlight state. Renders time-based article nodes.
- `wbdc/dam-cross-section`: dam section diagram. Attributes contain layer labels/classes and caption. Renders a figure with diagram slices.
- `wbdc/archive-reveal-band`: archival reveal strip. Attributes contain plates with label, title, body, and visual plate class. Renders article plates.

## Data Contract

`wordpress/block-tree.json` is version 2, `contract: "data-only"`. It contains no `htmlLines`, `innerHTML`, `innerContent`, `html`, `markup`, `sourceHtml`, fake core blocks, or arbitrary `core/group` tag factories. `wordpress/content.html` and `rendered/rendered-blocks.html` are derived by registering the custom block `save()` implementations and serializing the tree with `@wordpress/blocks`.
