# Custom Block Standards

Generate vanilla JavaScript WordPress blocks. Assume no build step and no JSX.

Use:

- `wp.blocks.registerBlockType`
- `wp.element.createElement`
- `wp.blockEditor.useBlockProps`
- `wp.blockEditor.RichText`
- `wp.blockEditor.InspectorControls`
- `wp.blockEditor.BlockControls` when toolbar controls are useful
- `wp.components.PanelBody`, `TextControl`, `ToggleControl`, `SelectControl`, `RangeControl`, etc. only for settings

Block requirements:

- `block.json` uses `apiVersion: 3`.
- Declare all attributes with types and defaults where useful.
- Declare supports for style controls: spacing, color, typography, border, dimensions, align, anchor, className.
- `edit` should render like the frontend while being editable. Visual parity in the editor canvas is a deliverable, not a nice-to-have.
- Visible copy uses in-canvas `RichText`.
- Repeated visible items should render in canvas; if item management is needed, use inspector controls or a small toolbar, not raw JSON textareas.
- URLs, method, required flags, speed, style variants, and other behavior/settings go to InspectorControls or BlockControls.
- `save` returns semantic frontend markup and preserves accessibility.
- `save()` is the single source of frontend structure; the local preview serializes it through `@wordpress/blocks`.
- Do not output attribute metadata as visible text.
- Do not use `dangerouslySetInnerHTML` or HTML blob attributes for generated custom blocks.
- Root block color, spacing, typography, border, and min-height styling should come from supports-backed attributes in `wordpress/block-tree.json`, not from hard-coded CSS.
- Use the block `style.css` only for scoped internal layout and visuals that supports cannot address.

Editor parity contract:

- Prefer a shared render helper or deliberately mirrored `edit()` and `save()` trees so tag names, class names, child order, repeated-item wrappers, and data attributes stay aligned.
- `RichText` in `edit()` must use the same `tagName` and className that `RichText.Content` uses in `save()`.
- Avoid editor-only structural wrappers. If a wrapper is necessary for selection or controls, it must not affect layout or screenshot geometry.
- The editor canvas may disable links, buttons, form fields, media controls, or animations, but the disabled state must preserve dimensions, spacing, typography, colors, and visual hierarchy.
- Inline editing affordances belong on existing visual elements. Do not add visible helper copy, placeholders, settings labels, empty field names, or control chrome that is absent from the frontend.
- `InspectorControls` and `BlockControls` are for settings; they must not create visible canvas layout unless the same visual element exists on the frontend.
- Treat WordPress editor wrappers as comparison noise only. All block-owned markup inside those wrappers should match the mockup as closely as the saved frontend.

Form-like blocks:

- Save real `<form>` markup.
- Preserve labels, field names, input types, placeholders, required state, options, action, method, and submit text.
- Use disabled form controls in `edit` when necessary so the canvas visually matches without submitting.
- Disabled controls in `edit` should keep the same element type, dimensions, classes, and state-dependent styling as the saved form.
- Labels and button text are inline editable with `RichText`.
- Action/method/field behavior belongs in inspector controls.

Quality bar:

- CSS is scoped to the block class.
- Class names are stable and match the block plan.
- Editor and save output use the same visual structure unless the editor needs disabled controls.
- `compare_html` editor screenshots must pass the same mismatch and height thresholds as rendered screenshots.
- The block remains useful after import into the WordPress editor.
