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
- Declare supports for style controls: spacing, color, typography, border, align, anchor, className.
- `edit` should render like the frontend while being editable.
- Visible copy uses in-canvas `RichText`.
- Repeated visible items should render in canvas; if item management is needed, use inspector controls or a small toolbar, not raw JSON textareas.
- URLs, method, required flags, speed, style variants, and other behavior/settings go to InspectorControls or BlockControls.
- `save` returns semantic frontend markup and preserves accessibility.
- `save()` is the single source of frontend structure; the local preview serializes it through `@wordpress/blocks`.
- Do not output attribute metadata as visible text.
- Do not use `dangerouslySetInnerHTML` or HTML blob attributes for generated custom blocks.

Form-like blocks:

- Save real `<form>` markup.
- Preserve labels, field names, input types, placeholders, required state, options, action, method, and submit text.
- Use disabled form controls in `edit` when necessary so the canvas visually matches without submitting.
- Labels and button text are inline editable with `RichText`.
- Action/method/field behavior belongs in inspector controls.

Quality bar:

- CSS is scoped to the block class.
- Class names are stable and match the block plan.
- Editor and save output use the same visual structure unless the editor needs disabled controls.
- The block remains useful after import into the WordPress editor.
