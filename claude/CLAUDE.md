# HTML to Blocks

Use this plugin when the user asks to plan WordPress content architecture, transform designed or provided HTML/CSS/JS into editable WordPress blocks, or turn a completed block workspace into a block theme.

Workflow:

1. Generate a polished standalone HTML/CSS/JS mockup from the user request plus the design prompt in `skills/html-to-blocks/references/design-prompt.md`, or call `import_provided_markup` when the user supplied existing markup.
2. Analyze the mockup with the `analyze_mockup` tool.
3. If the design implies durable content collections, run `skills/content-modeling/SKILL.md`: write `content-model/content-model.json`, validate it with `validate_content_model`, then generate the plugin with `scaffold_content_model_plugin`.
4. Plan core blocks, custom blocks, and style responsibilities. Use block support/style attributes first; CSS needs a support-limitation reason.
5. Generate vanilla JavaScript custom blocks with real editor affordances: in-canvas RichText for visible copy, InspectorControls for behavior/settings, block supports for style controls, and semantic save markup.
6. Assemble block content and serialize it with `serialize_wordpress_blocks`.
7. Refresh editor previews with `create_block_editor_preview` when inspecting a generated tree directly or when working with multiple generated page trees.
8. Capture inspection screenshots with `screenshot_html` when you need to look at mockup, rendered output, editor output, or multiple generated pages without running a pixel diff.
9. Compare the mockup against both the rendered frontend preview and editable editor preview with `compare_html`.
10. Turn the screenshots/diffs into explicit repair tasks, fix them, and repeat until both `aggregates.rendered` and `aggregates.editor` are under threshold.

Keep the HTML mockup as the source of truth. Prefer core blocks and block supports before custom blocks. Use custom blocks only when they provide a better editable content model or semantic frontend contract.

When the user supplied markup, do not redesign it before analysis. Import it into `mockup/`, preserve it as the source of truth, and transform that markup into blocks.

For multi-file generations, do not make one-off editor pages by hand. Keep the setup reusable: store each page's block tree in a stable JSON file, call `create_block_editor_preview` for that tree, then use `screenshot_html` or `compare_html` against that page's mockup/rendered/editor files.

Editor parity is required. Custom block `edit()` output should be a visual twin of `save()` with inline `RichText`, disabled controls where needed, and the same wrapper/class/order geometry. If the rendered frontend passes but the editor preview fails, fix `edit()` implementations or editor-owned CSS rather than accepting the drift.

After `serialize_wordpress_blocks`, read `reports/style-audit.json`. Move block-level color, spacing, typography, border, dimensions, layout, and alignment out of CSS and into `wordpress/block-tree.json` wherever WordPress supports can express it. Keep page CSS tiny and reserve custom block CSS for scoped internals such as pseudo-elements, nested controls, sticky behavior, horizontal rails, and responsive grids.
