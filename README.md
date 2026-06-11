# HTML to WordPress Blocks

This repository is a local agent plugin plus MCP server for transforming designed or provided HTML/CSS/JS into editable WordPress block content.

The workflow is intentionally staged. The HTML mockup stays the visual source of truth, while the WordPress output is built as a data-only block tree, rendered through WordPress block packages, inspected in a no-build block editor preview, and repaired from screenshot diffs.

## What Is Included

- `skills/html-to-blocks/SKILL.md` - the orchestrator skill an agent should follow.
- `skills/html-to-blocks/references/` - design, planning, core-block, custom-block, and repair-loop guidance.
- `tools/mcp-server.mjs` - deterministic workspace, analysis, serialization, editor preview, screenshot, and comparison tools.
- `.codex-plugin/plugin.json` - Codex plugin manifest.
- `.mcp.json` - MCP server config for agents that can load MCP servers.
- `claude/` - Claude-oriented instructions and config example.
- `spec.md` - historical grounding/specification for the approach.

Generated runs should live outside the repository, or under ignored local folders such as `examples/`.

## Workflow

1. Create a workspace with `create_workspace`.
2. Generate `mockup/index.html` and `mockup/style.css` from the user brief, or import existing markup with `import_provided_markup`.
3. Analyze the mockup with `analyze_mockup`.
4. Write a core-first block plan in `plan/block-plan.md` and `plan/block-plan.json`.
5. Generate custom blocks only when core blocks and block supports cannot preserve both fidelity and editability.
6. Assemble `wordpress/block-tree.json` as data only: block names, attributes, supports/style attrs, classes, and inner blocks.
7. Run `serialize_wordpress_blocks` to produce canonical block markup, rendered preview HTML, editor preview HTML, and a style audit.
8. Run `compare_html` against both the saved frontend render and the editable editor preview.
9. Repair from explicit visual-diff tasks until rendered and editor mismatch thresholds pass.

The block tree must not contain raw markup escape hatches such as `htmlLines`, `innerHTML`, `innerContent`, `markup`, or `sourceHtml`.

## Core-First Rule

Use WordPress core blocks and design supports before custom blocks:

- Use `core/group`, `core/columns`, `core/cover`, `core/image`, `core/heading`, `core/paragraph`, `core/buttons`, `core/list`, and related core blocks when they express the structure.
- Put color, spacing, typography, dimensions, border, layout, alignment, media, and overlay styling into block attributes/supports wherever possible.
- Keep `wordpress/style.css` small and explainable.
- Create custom blocks for real forms, search/booking/subscription widgets, reusable typed components, semantic data structures, or UI that core blocks cannot model editably.

Custom block `edit()` output should visually mirror `save()` and use inline `RichText` for visible copy, with InspectorControls or BlockControls for non-inline settings.

## MCP Tools

The server exposes these tools:

- `create_workspace`
- `import_provided_markup`
- `analyze_mockup`
- `scaffold_custom_block`
- `serialize_wordpress_blocks`
- `create_block_editor_preview`
- `screenshot_html`
- `compare_html`

Run the syntax check with:

```bash
npm run check
```

## Codex

Use the repository as a Codex plugin. The manifest is at:

```text
.codex-plugin/plugin.json
```

The skill name is `html-to-blocks`.

## Claude / MCP

Install dependencies, then point Claude or another MCP-capable agent at the server:

```bash
npm install
node tools/mcp-server.mjs
```

Example Claude Desktop server entry:

```json
{
  "mcpServers": {
    "html-to-blocks": {
      "command": "node",
      "args": ["/absolute/path/to/html-to-blocks/tools/mcp-server.mjs"]
    }
  }
}
```

Agents should read `claude/CLAUDE.md` or `skills/html-to-blocks/SKILL.md` before calling the tools.
