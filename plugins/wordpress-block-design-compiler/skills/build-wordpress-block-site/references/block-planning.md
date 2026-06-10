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

Use custom blocks for:

- Semantic forms/search/subscription/booking/contact UI.
- Marquees, sliders, accordions, tabs, or repeated widgets that need structured item data.
- Repeated cards where each item needs a coherent editing model.
- Components where save markup must be very specific and core block nesting would be brittle.

Custom block examples that are usually valid:

- Product/object/event card with structured metadata and a reusable embed model.
- Newsletter/contact/search form that must save real form controls.
- Bespoke navigation when `core/navigation` is dynamic or unsuitable for the static serializer.

Custom block examples that are usually invalid:

- Hero section containing only heading, paragraph, and buttons.
- Editorial story section containing only text and decorative layout.
- Footer containing ordinary copy and links.
- Journal teaser row that can be `core/group`/`core/columns`/`core/heading`/`core/paragraph`.

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
