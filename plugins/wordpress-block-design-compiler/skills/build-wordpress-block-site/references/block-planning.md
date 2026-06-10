# Block Planning

The block plan translates the source HTML mockup into an editable WordPress block model.

The assembled artifact is `wordpress/block-tree.json`. It must be a WordPress parsed/raw block tree that can be serialized by `@wordpress/blocks`; hand-written block comments are generated output, not source.

Core-first means:

- Use core Group, Columns, Column, Heading, Paragraph, List, Buttons, Button, Image, Separator, Spacer, Details, Quote, Table, and HTML where appropriate.
- Use block supports for spacing, color, border, typography, layout, alignment, anchor, and className before inventing attributes.
- Use custom CSS when core supports cannot express exact visual styling.
- Use custom blocks only for a better content model, reusable repeated data, frontend behavior, semantic save contracts, or editor affordances.

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
- Any block comment whose block name does not match the saved HTML contract.
- A custom block whose attributes are a raw HTML blob instead of a useful editor model.

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
  "version": 1,
  "blocks": [
    {
      "blockName": "core/group",
      "attrs": { "tagName": "section", "className": "hero" },
      "innerHTML": "",
      "innerContent": ["<section class='hero'>", null, "</section>"],
      "innerBlocks": [
        {
          "blockName": "core/heading",
          "attrs": { "level": 1 },
          "htmlLines": ["<h1>Editable headline</h1>"],
          "innerBlocks": []
        }
      ]
    }
  ]
}
```
