# Maison Clouet Core-First Block Plan

## Core-First Gate

This run rejects the previous section-block shortcut. Every section starts from a core assembly:

- Header: `core/group` header, nested `core/group` brand, `core/buttons` nav links. No custom block.
- Hero: `core/group` section, `core/columns`, `core/heading`, `core/paragraph`, and decorative `core/group`/`core/spacer` flatlay shapes. No custom block.
- Arrivals: `core/group` section, core heading/filter buttons/grid wrapper, repeated `wbdc/maison-object-card` instances. Custom is justified only for the reusable object card data model.
- Scent: `core/group`, `core/columns`, `core/paragraph`, `core/heading`. No custom block.
- Visit: `core/group`, `core/columns`, core storefront illustration wrappers, core metadata rows. No custom block.
- Journal: `core/group`, `core/columns`, `core/heading`, `core/paragraph`. No custom block.
- Newsletter: core section/copy layout plus `wbdc/maison-newsletter-form` for the semantic form only.
- Footer: `core/group` footer, core paragraphs, core button link. No custom block.

Expected block coverage: many more core blocks than custom block instances. Custom blocks are not used for whole editorial sections.

## Custom Blocks

### `wbdc/maison-object-card`

Core rejection: core `group`/`image`/`heading`/`paragraph` can approximate a card, but the requested object card is reusable inside shop grids and journal posts with structured title, price, category, story, condition, dimensions, image variant, and a story reveal. A custom static block preserves that typed editing model and save contract.

### `wbdc/maison-newsletter-form`

Core rejection: core buttons and paragraphs cannot save a real newsletter `<form>` with labels, field names, placeholders, method, and submit button. `core/search` has the wrong semantics. A custom static form block is required.

## Styling Responsibilities

- Block supports: root section padding, borders, colors, min heights, and layout classes in `wordpress/block-tree.json`.
- Core block classes: section geometry, nav buttons, flatlay shapes, editorial columns, journal cards, footer rhythm.
- Custom block CSS: object-card internals and form controls only.
- Page CSS: tokens, body background, headings/body defaults, shared core/editor wrapper normalization.

## Completion Gate

The run is not complete until both `aggregates.rendered` and `aggregates.editor` in `reports/comparison.json` are under `1%` mismatch and `8px` height delta, or the run is explicitly marked blocked.
