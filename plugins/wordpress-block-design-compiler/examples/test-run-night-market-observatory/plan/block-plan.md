# Night Market Observatory Block Plan

The source mockup is an editorial star-map homepage for a travelling food and telescope market. The block tree is data-only and uses official core blocks plus static custom blocks with typed attributes.

## Core-First Decisions

- Use `core/group` for block-level sections, article wrappers, and the `main` container.
- Use `core/paragraph` and `core/heading` for ordinary editorial copy.
- Keep the field etiquette section as core block composition because the text structure is simple and editor-friendly.
- Put block-level spacing, color, typography, border, and gap decisions in `wordpress/block-tree.json` support-style attributes.
- Keep `wordpress/style.css` to tokens, document defaults, core section grid glue, and responsive rules that core supports cannot express.
- Keep `wordpress/blocks/*/style.css` scoped to custom block internals: sticky navigation layout, orbit map pseudo-elements, card variants, horizontal rails, and form controls.
- No `core/html` is needed.

## Custom Blocks

- `wbdc/market-nav`: brand, route metadata, nav links, and action link need a semantic header/nav contract.
- `wbdc/orbit-hero`: multi-line hero, sensor definition list, and positioned orbit nodes need one coherent editable data model.
- `wbdc/stall-constellation`: repeated stalls need stable article markup and variant classes.
- `wbdc/sky-rail`: schedule items need semantic `time` elements and a horizontal rail.
- `wbdc/market-rsvp-form`: RSVP must save a real form with labels, inputs, names, placeholders, and submit button.
- `wbdc/market-footer`: footer link is semantic saved markup without inventing `core/link`.

## Editor Model

Visible text is edited with `RichText` in the canvas. Repeated rows live in array attributes. Form field structure is represented as data attributes, with labels and button text editable inline. There are no `htmlLines`, `innerHTML`, `innerContent`, `markup`, or `sourceHtml` fields.

## Style Audit

- `32 / 34` blocks carry support-style attributes.
- Support-styled block coverage is `94.12%`.
- Page CSS is `131` non-empty lines and limited to tokens, document defaults, page grid glue, and responsive exceptions.
- Scoped custom block CSS covers child selectors and behaviors that block supports cannot target.
