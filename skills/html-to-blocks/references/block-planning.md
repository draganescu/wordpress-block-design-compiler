# Block Planning

The block plan translates the source HTML mockup into an editable WordPress block model.

The assembled artifact is `wordpress/block-tree.json`. It must be a data-only block tree. WordPress packages serialize block names, attributes, styles, classes, and inner blocks into canonical block markup; hand-written block comments and saved HTML are generated output, not source.

Core-first means:

- Use real core blocks registered by `@wordpress/block-library` where appropriate. Prefer static blocks with useful saved markup for local preview; dynamic core blocks may serialize only block comments outside WordPress.
- Use block supports for spacing, color, border, dimensions, typography, layout, alignment, anchor, and className before inventing attributes.
- Use block style variations/classes for named editor-facing design choices.
- Use custom CSS only when block supports cannot express exact visual styling.
- Use custom blocks only for a better content model, reusable repeated data, frontend behavior, semantic save contracts, or editor affordances.
- Use only real registered core block names and attributes present in WordPress block metadata. Do not invent convenience core blocks.
- Use `core/group` only for block-level layout containers. Do not use it to emit inline tags, definition-list internals, links, buttons, form fields, or arbitrary HTML.

Core-first hard gate:

- Start each section plan with a core block assembly candidate.
- Reject "custom block for the whole section" unless the section is itself a semantic widget, real form/search/subscription component, query/data component, navigation component, or reusable component with a typed editing model.
- Complex asymmetric layout, overlapping visuals, sticky behavior, or precise responsive grids are CSS/support problems first, not automatic custom block reasons.
- Static prose, headings, button rows, editorial bands, footer copy, and ordinary two-column layouts must use core blocks unless the serializer proves a specific core block cannot represent the structure.
- The final `wordpress/block-tree.json` should normally have more core blocks than custom blocks. If custom blocks are equal to or more than core blocks, rewrite the plan before implementation unless the user explicitly requested a mostly custom-block site.
- For every custom block, include a "core rejection" sentence naming the exact core blocks considered and why they fail editability, semantic output, or fidelity.

Do not use custom blocks for:

- An entire section only because its layout is complex.
- An entire section only because it is easier to make `edit()` match `save()`.
- Static text that core Heading/Paragraph/List/Button can edit.
- A disguised HTML blob.
- Decorative wrappers that could be a core Group with classes.
- Anything a dynamic core block already covers because the static serializer
  shows it blank. Navigation, search, comments, comment form, pagination,
  prev/next, site title/logo, and post fields are real core blocks that the
  pipeline now renders in both previews. "Doesn't preview statically" is a
  harness limitation, not a core-rejection reason.
- A repeated content card. Repeated records (products, objects, posts, events)
  are a `core/query` over a post type, built first as a marked core-block
  stand-in (see "Stand-ins" below). A `variant` enum (featured/row/grid) that
  only changes placement is layout, expressed by the container class and CSS,
  not a content model — never an attribute.
- Images. Use `core/image`; a missing photo is a `data:` SVG placeholder in the
  `url` at the right aspect ratio. Never hide a media URL in InspectorControls.

Use custom blocks ONLY for:

- A real submission form WordPress has no core block for (contact, newsletter,
  subscription, booking, sourcing request) that must save semantic `<form>`
  markup and POST somewhere.
- A genuinely bespoke interactive widget (a configurator, a typed data
  visualization) with an editing model no core block expresses.
- A component whose exact save markup core block nesting genuinely cannot
  produce — proven, after trying the core assembly, not assumed.

Map the named element to its core block before considering custom:

| Design element | Core block |
|---|---|
| Primary/footer nav, menu | `core/navigation` + `core/navigation-link`/`-submenu` |
| Search field | `core/search` |
| Wordmark / logo | `core/site-title` (+ tagline) / `core/site-logo` |
| Comment list / comment form | `core/comments` / `core/post-comments-form` |
| Pagination, prev/next | `core/query-pagination` / `core/post-navigation-link` |
| Post/product grid, index | `core/query` + `core/post-template` (stand-in first) |
| Category eyebrow, date, title, excerpt, featured image | `core/post-terms` / `core/post-date` / `core/post-title` / `core/post-excerpt` / `core/post-featured-image` |

Custom block examples that are usually INVALID (use the core block / stand-in):

- A "site-nav" / "search-form" / "pagination" / "comment-form" block.
- A "post-card" / "product-card" block with a `variant` enum.
- A "post-meta" block that exists only to carry an inline SVG icon (the icon is
  CSS decoration on a core composition).
- Hero, editorial, footer sections of heading + paragraph + buttons + image.

### Stand-ins for data-driven regions

A grid/index of records is a query with no data yet. Build it from real core
blocks (`core/group` + `core/image` + `core/heading` + `core/paragraph`) seeded
with representative content so the visual gate can style it, and mark it:

- the repeating container: `attrs.metadata.standin = { "for": "core/query", "postType": "objet", "taxonomy": "objet_cat", "query": { "perPage": 4, "orderBy": "date", "order": "desc" } }`. Its first child is the item template.
- each per-item field in the template: `attrs.metadata.standin = { "for": "core/post-title" }` (or `core/post-featured-image`, `core/post-terms`, `core/post-excerpt`, `core/post-date`).
- a comment thread: `attrs.metadata.standin = { "for": "core/comments" }`.

Keep stable classNames on the card and its fields; the lifted theme CSS targets
them after `hydrate_standins` swaps the marked blocks into `core/query` /
`core/post-*` / `core/comments`. Run `audit_standins` to verify the marks.

Use `core/html` only for the smallest non-editable fragment that cannot reasonably become core or custom static blocks. Give a concrete reason each time.

Invalid assembly examples:

- `core/list` whose saved markup is a `<section>`.
- `core/paragraph` whose saved markup contains multiple headings, buttons, and forms.
- Any `htmlLines`, `innerHTML`, `innerContent`, `html`, `markup`, or `sourceHtml` field in `wordpress/block-tree.json`.
- A custom block whose attributes are a raw HTML blob instead of a useful editor model.
- Structural HTML hidden inside rich-text content instead of represented as blocks or custom-block attributes.
- An invented core block such as `core/link`.
- `core/group` with inline or special-purpose tag names such as `span`, `strong`, `time`, `dl`, `dt`, or `dd`.

Plan shape:

```json
{
  "sections": [
    {
      "id": "hero",
      "sourceSelector": ".hero",
      "strategy": "core-assembly | custom-block | mixed | html-fragment",
      "coreBlocks": ["core/group", "core/heading"],
      "customBlocks": [],
      "styleResponsibilities": {
        "blockSupports": ["spacing.padding", "color.background"],
        "blockCss": [".hero-card"],
        "pageCss": [":root tokens"]
      },
      "editableModel": "what remains inline editable and what goes to inspector",
      "editorParity": "how edit() or core editor output preserves the same visual structure as the mockup",
      "reason": "why this mapping preserves fidelity and editability"
    }
  ],
  "customBlocks": [
    {
      "name": "namespace/block-name",
      "reason": "why core is not enough",
      "attributes": [],
      "supports": [],
      "editorModel": "RichText in canvas, InspectorControls, BlockControls",
      "editorParity": "same wrapper/classes/order as save(); disabled controls keep frontend geometry",
      "saveContract": "semantic frontend markup"
    }
  ]
}
```

Tree shape:

```json
{
  "version": 2,
  "contract": "data-only",
  "blocks": [
    {
      "blockName": "core/group",
      "attrs": { "tagName": "section", "className": "hero" },
      "innerBlocks": [
        {
          "blockName": "core/heading",
          "attrs": {
            "level": 1,
            "content": "Editable headline",
            "className": "hero-title",
            "style": { "typography": { "fontSize": "clamp(4rem, 12vw, 12rem)" } }
          },
          "innerBlocks": []
        },
        {
          "blockName": "namespace/custom-data-block",
          "attrs": {
            "items": [
              { "label": "Delta height", "value": "8.4m" }
            ]
          },
          "innerBlocks": []
        }
      ]
    }
  ]
}
```

Custom block serialization requirements:

- Each generated custom block must implement `save()` in `index.js`; that `save()` is the single source of frontend markup for WordPress and preview comparison.
- Each generated custom block must implement `edit()` as a visual twin of `save()`: same root tag, class names, child order, repeated-item wrappers, and component geometry, with `RichText` or disabled controls replacing static frontend text/inputs.
- The serializer registers official core blocks, registers `wordpress/blocks/*/index.js`, and calls WordPress package serialization. Do not create a parallel markup-generation layer.
- The block tree references custom blocks by `blockName` and `attrs`; it never embeds the custom block's saved HTML.
- Custom blocks should be generated for semantic shells that core cannot represent cleanly, such as bespoke navigation, definition-list telemetry panels, search/subscription/booking forms, maps, marquees, archive reveal systems, and data visualizations.

Editor parity requirements:

- `compare_html` measures both `rendered/rendered-blocks.html` and `editor/block-editor.html` against the mockup.
- A transform is complete only when `aggregates.rendered` and `aggregates.editor` are both under threshold.
- If rendered passes but editor fails, change custom block `edit()` implementations, block-owned editor CSS, or editable markup choices. Do not damage saved frontend parity to improve editor parity.
- If both rendered and editor fail in the same area, fix the shared block tree, custom block structure, or scoped CSS so both surfaces converge together.
- Do not accept a custom block whose `save()` is pixel-close but whose `edit()` is a generic inspector panel, raw inputs, simplified placeholder, or visibly different wrapper tree.
- Do not accept a core-light tree as a shortcut for editor parity. If editor wrappers make core assemblies hard to compare, fix comparison CSS or block-level classes before replacing core assemblies with section custom blocks.

CSS transfer requirements:

- `mockup/style.css` belongs only to the source mockup.
- The rendered block preview uses `wordpress/style.css` and `wordpress/blocks/*/style.css`.
- Recreate styling as WordPress block data first: `attrs.style`, `layout`, `align`, `textColor`, `backgroundColor`, `fontSize`, spacing, border, typography, and dimensions settings.
- Put custom block internals in `wordpress/blocks/<slug>/style.css` only when supports cannot target the needed child, pseudo-element, interaction state, responsive grid, sticky behavior, or form control.
- Keep `wordpress/style.css` small: tokens, base document defaults, shared responsive glue, and cross-block rules only.
- Do not import, concatenate, or mechanically copy the mockup stylesheet into the rendered preview.

Style audit requirements:

- `serialize_wordpress_blocks` writes `reports/style-audit.json`.
- Read the audit after each serialization.
- If page CSS is large, move block-level color, spacing, typography, border, dimensions, and layout decisions back into `wordpress/block-tree.json`.
- If a block needs many scoped internal rules, prefer a custom block with explicit typed attributes and block-scoped CSS over page-level selectors.
- Every remaining CSS rule should have a reason that maps to a support limitation.
