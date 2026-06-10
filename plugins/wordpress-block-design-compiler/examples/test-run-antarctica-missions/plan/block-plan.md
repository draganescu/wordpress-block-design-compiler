# Block Plan

Prompt: award-winning brutalist/arctic homepage for Antarctica missions, rejecting generic hero/card/footer conventions.

## Strategy

Assembled source of truth: `wordpress/block-tree.json`. `wordpress/content.html` is generated as plain preview HTML from that data-only tree and should not be hand-edited.

Use core blocks for the mission strip, large editorial headings, paragraphs, wrappers, and footer. Use custom static blocks where the content model is more than generic prose:

- `wbdc/polar-mission-map`: structured polar-map figure with nodes, coordinate caption, and instrument framing.
- `wbdc/mission-telemetry-rail`: horizontal scroll-snap mission rail with repeated structured mission stops.
- `wbdc/mission-metrics`: definition-list metrics for extreme conditions.
- `wbdc/coordinate-stack`: stacked coordinate data rendered from label/value attributes.
- `wbdc/field-log`: repeated field-note entries with time/title/body data.

No `core/html` block is needed. Decorative wrappers are core Groups with classes; custom blocks are reserved for structured mission data components.

## Section Mapping

- Station strip: `core/group` header. Brand, coordinate line, and signal link remain editable link/text content.
- Hero field: `core/group` section with core heading/paragraph blocks plus `wbdc/polar-mission-map`.
- Rupture statement: `core/group` section with heading, paragraph, and `wbdc/mission-metrics`.
- Telemetry rail: `core/group` heading plus `wbdc/mission-telemetry-rail`. Custom block is justified by horizontal scrolling, repeated mission stops, and structured title/body/index attributes.
- Signal array: core groups for signal copy plus `wbdc/coordinate-stack`. Visual map effects are CSS.
- Field log: core group section with `wbdc/field-log` so repeated notes remain structured data.
- Footer: core group.

## Custom Blocks

### `wbdc/polar-mission-map`

Reason: the polar map has structured named nodes, a map title, and a caption that should remain editable without becoming an HTML blob. The editor should render the technical map, not a textarea.

Editable model:

- Map title and caption: inline `RichText`.
- Node labels: structured `nodes` array, rendered visibly in canvas.
- Style variant: class/supports; no raw HTML attribute.

### `wbdc/mission-telemetry-rail`

Reason: the horizontal rail is a repeated, scrollable mission data component. Core columns/cards could approximate it, but a custom block gives a durable item model and avoids manually maintaining broken-grid markup.

Editable model:

- Rail eyebrow/title and mission item title/body: inline `RichText`.
- Item index and visual variant: structured attributes.
- Save output: semantic section fragment with scrollable articles.

### `wbdc/mission-metrics`, `wbdc/coordinate-stack`, `wbdc/field-log`

Reason: these are repeated data structures. They should not be encoded as structural HTML inside paragraph content. Their attributes contain arrays of labels, values, timestamps, titles, and body copy.

## Styling Responsibilities

- Page CSS: brutalist grid, sticky station strip, large typography, arctic palette, responsive behavior, micro-interactions.
- Custom block CSS: scoped technical map internals and telemetry rail/card states.
- Block supports: spacing, color, typography, border, anchor, align, className.

## Acceptance

The render must come from data-only `wordpress/block-tree.json`. The tree must not contain `htmlLines`, `innerHTML`, `innerContent`, `html`, `markup`, or `sourceHtml`. For example, the telemetry rail is not a `core/list`; it is `wbdc/mission-telemetry-rail`.
