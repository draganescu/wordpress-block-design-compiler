# WordPress Block Design Compiler

Codex/Claude plugin for turning a website request into editable WordPress block content through a staged agent workflow.

The plugin does not try to make an autonomous server-side orchestrator. It gives the agent a skill and deterministic tools:

- create a contained workspace
- generate a high-quality HTML/CSS/JS mockup
- analyze the mockup structure and CSS
- plan core blocks, custom blocks, and styling responsibilities
- scaffold vanilla JavaScript static custom blocks
- assemble editable `wordpress/block-tree.json`
- serialize the block tree through `@wordpress/blocks` and registered custom-block `save()` functions
- compare mockup and rendered output with screenshots and pixel diffs
- return concrete repair tasks for the agent to fix

## Codex

The local marketplace entry is at:

```text
.agents/plugins/marketplace.json
```

The plugin source is:

```text
plugins/wordpress-block-design-compiler
```

Install dependencies for screenshot comparison:

```sh
cd plugins/wordpress-block-design-compiler
npm install
```

## Claude

Use the example MCP config:

```text
claude/claude_desktop_config.example.json
```

Use `claude/CLAUDE.md` as the Claude project instruction file when running this workflow outside Codex.

## MCP Tools

- `create_workspace`: creates `mockup`, `analysis`, `plan`, `wordpress`, `rendered`, `reports`, and `visual` folders.
- `analyze_mockup`: extracts a content inventory, sections, forms, links, cards, headings, CSS custom properties, and selectors.
- `scaffold_custom_block`: writes `block.json`, `index.js`, and `style.css` for a vanilla JavaScript static block.
- `serialize_wordpress_blocks`: registers custom blocks from `wordpress/blocks/*/index.js`, serializes `wordpress/block-tree.json` with `@wordpress/blocks`, writes canonical block markup to `wordpress/content.html`, and writes frontend preview HTML to `rendered/rendered-blocks.html`. It rejects source trees that contain `htmlLines`, `innerHTML`, `innerContent`, `html`, `markup`, or `sourceHtml`.
- `compare_html`: captures mockup/rendered screenshots, generates diffs, and writes `reports/comparison.json` plus `reports/repair-tasks.md`.

## Workflow

Ask the agent for a website that should become WordPress blocks. The `build-wordpress-block-site` skill drives the steps and the agent remains responsible for design, implementation, and repair judgment.

Default comparison thresholds:

- `maxMismatchPercent <= 1`
- `maxHeightDelta <= 8`

The repair loop is deliberately agent-led: the tool reports differences and image paths, then the agent fixes block composition, block source, or CSS as appropriate.
