# Block Planning

The block plan translates the source HTML mockup into an editable WordPress block model.

The assembled artifact is `wordpress/block-tree.json`. It must be a data-only block tree. WordPress packages serialize block names, attributes, styles, classes, and inner blocks into canonical block markup; hand-written block comments and saved HTML are generated output, not source.

Core-first means:

- Use real core blocks registered by `@wordpress/block-library` where appropriate. Prefer static blocks with useful saved markup for local preview; dynamic core blocks may serialize only block comments outside WordPress.
- Use block supports for spacing, color, border, typography, layout, alignment, anchor, and className before inventing attributes.
- Use custom CSS when core supports cannot express exact visual styling.
- Use custom blocks only for a better content model, reusable repeated data, frontend behavior, semantic save contracts, or editor affordances.
- Use only real registered core block names and attributes present in WordPress block metadata. Do not invent convenience core blocks.
- Use `core/group` only for block-level layout containers. Do not use it to emit inline tags, definition-list internals, links, buttons, form fields, or arbitrary HTML.

Do not use custom blocks for:

- An entire section only because its layout is complex.
- Static text that core Heading/Paragraph/List/Button can edit.
- A disguised HTML blob.
- Decorative wrappers that could be a core Group with classes.

Use custom blocks for:

- Semantic forms/search/subscription/booking/contact UI.
- Marquees, sliders, accordions, tabs, or repeated widgets that need structured item data.
- Repeated cards where each item needs a coherent editing model.
- Components where save markup must be very specific and core block nesting would be brittle.

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
- The serializer registers official core blocks, registers `wordpress/blocks/*/index.js`, and calls WordPress package serialization. Do not create a parallel markup-generation layer.
- The block tree references custom blocks by `blockName` and `attrs`; it never embeds the custom block's saved HTML.
- Custom blocks should be generated for semantic shells that core cannot represent cleanly, such as bespoke navigation, definition-list telemetry panels, search/subscription/booking forms, maps, marquees, archive reveal systems, and data visualizations.
