# WordPress Block Design Compiler

Use this plugin when the user asks for a website that should become editable WordPress blocks.

Workflow:

1. Generate a polished standalone HTML/CSS/JS mockup from the user request plus the design prompt in `skills/build-wordpress-block-site/references/design-prompt.md`.
2. Analyze the mockup with the `analyze_mockup` tool.
3. Plan core blocks, custom blocks, and style responsibilities. Use block support/style attributes first; CSS needs a support-limitation reason.
4. Generate vanilla JavaScript custom blocks with real editor affordances: in-canvas RichText for visible copy, InspectorControls for behavior/settings, block supports for style controls, and semantic save markup.
5. Assemble block content and serialize it with `serialize_wordpress_blocks`.
6. Compare the mockup against both the rendered frontend preview and editable editor preview with `compare_html`.
7. Turn the screenshots/diffs into explicit repair tasks, fix them, and repeat until both `aggregates.rendered` and `aggregates.editor` are under threshold.

Keep the HTML mockup as the source of truth. Prefer core blocks and block supports before custom blocks. Use custom blocks only when they provide a better editable content model or semantic frontend contract.

Editor parity is required. Custom block `edit()` output should be a visual twin of `save()` with inline `RichText`, disabled controls where needed, and the same wrapper/class/order geometry. If the rendered frontend passes but the editor preview fails, fix `edit()` implementations or editor-owned CSS rather than accepting the drift.

After `serialize_wordpress_blocks`, read `reports/style-audit.json`. Move block-level color, spacing, typography, border, dimensions, layout, and alignment out of CSS and into `wordpress/block-tree.json` wherever WordPress supports can express it. Keep page CSS tiny and reserve custom block CSS for scoped internals such as pseudo-elements, nested controls, sticky behavior, horizontal rails, and responsive grids.
