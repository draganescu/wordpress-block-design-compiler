# WordPress Block Design Compiler

Use this plugin when the user asks for a website that should become editable WordPress blocks.

Workflow:

1. Generate a polished standalone HTML/CSS/JS mockup from the user request plus the design prompt in `skills/build-wordpress-block-site/references/design-prompt.md`.
2. Analyze the mockup with the `analyze_mockup` tool.
3. Plan core blocks, custom blocks, and CSS responsibilities.
4. Generate vanilla JavaScript custom blocks with real editor affordances: in-canvas RichText for visible copy, InspectorControls for behavior/settings, block supports for style controls, and semantic save markup.
5. Assemble block content and build a rendered preview with `build_rendered_preview`.
6. Compare mockup and rendered preview with `compare_html`.
7. Turn the screenshots/diffs into explicit repair tasks, fix them, and repeat until under threshold.

Keep the HTML mockup as the source of truth. Prefer core blocks and block supports before custom blocks. Use custom blocks only when they provide a better editable content model or semantic frontend contract.
