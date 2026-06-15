# HTML to WordPress Blocks

This repository is a local agent plugin plus MCP server for transforming designed or provided HTML/CSS/JS into editable WordPress block content.

The workflow is intentionally staged. The HTML mockup stays the visual source of truth, while the WordPress output is built as a data-only block tree, rendered through WordPress block packages, inspected in a no-build block editor preview, and repaired from screenshot diffs.

## What Is Included

- `skills/content-modeling/SKILL.md` - the content architecture skill for posts, CPTs, taxonomies, meta, submissions, seed data, and model plugins.
- `skills/content-modeling/references/` - content modeling and plugin-contract guidance.
- `skills/html-to-blocks/SKILL.md` - the HTML-to-editable-blocks skill an agent should follow.
- `skills/html-to-blocks/references/` - design, planning, core-block, custom-block, and repair-loop guidance.
- `skills/blocks-to-theme/SKILL.md` - the stage-2 skill that turns a completed run into an installable block theme.
- `skills/blocks-to-theme/references/` - theme.json mapping, part inference, template planning, fonts/media, and Playground-gate guidance.
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
4. If the brief/design contains dynamic content collections, run the `content-modeling` skill: write `content-model/content-model.json`, validate it, and scaffold the installable content-model plugin.
5. Write a core-first block plan in `plan/block-plan.md` and `plan/block-plan.json`.
6. Generate custom blocks only when core blocks and block supports cannot preserve both fidelity and editability.
7. Assemble `wordpress/block-tree.json` as data only: block names, attributes, supports/style attrs, classes, and inner blocks.
8. Run `serialize_wordpress_blocks` to produce canonical block markup, rendered preview HTML, editor preview HTML, and a style audit.
9. Run `compare_html` against both the saved frontend render and the editable editor preview.
10. Localize failures with `measure_layout` (per-element geometry drift between mockup and rendered/editor pages), then repair from explicit tasks until rendered and editor mismatch thresholds pass.

## Stage 0: content-modeling

Use `skills/content-modeling/SKILL.md` when the site needs durable data architecture: custom post types, taxonomies, structured meta, submission storage, or sample data. This stage looks at the design and brief before blocks are assembled and decides what should remain page content versus what belongs in WordPress admin as posts, CPTs, taxonomy terms, or form submissions.

Stage-0 tools:

- `validate_content_model`
- `scaffold_content_model_plugin`

The canonical model is `content-model/content-model.json`. The generated installable plugin is written to `content-model/plugin/<plugin-slug>/` and registers CPTs, taxonomies, post meta, and submission REST routes while active. Like the theme page-content importer, seed records are explicit: manifests describe records, seed post markup is moved to `content/seeds/...` payload files, and the plugin adds a Tools screen to import generated seed content, report slug collisions/modified imports, and remove generated seed content.

## Multi-Page Exports

`import_provided_markup` returns a `pages` manifest when the source root contains sibling `.html` pages. Use the suggested paths for every page (including the primary one):

- `wordpress/pages/<page>.block-tree.json` + `wordpress/pages/<page>.content.html`
- `rendered/<page>.html` + `editor/<page>.html`
- `reports/<page>.comparison.json` (compare_html derives this from the mockup filename, so per-page reports never overwrite each other)

Plan shared blocks once, pass the first page fully, then iterate the rest. The run is complete only when every page's comparison passes both surfaces.

The block tree must not contain raw markup escape hatches such as `htmlLines`, `innerHTML`, `innerContent`, `markup`, or `sourceHtml`.

## Core-First Rule

Use WordPress core blocks and design supports before custom blocks:

- Use `core/group`, `core/columns`, `core/cover`, `core/image`, `core/heading`, `core/paragraph`, `core/buttons`, `core/list`, and related core blocks when they express the structure.
- Put color, spacing, typography, dimensions, border, layout, alignment, media, and overlay styling into block attributes/supports wherever possible.
- Keep `wordpress/style.css` small and explainable.
- Create custom blocks for real forms, search/booking/subscription widgets, reusable typed components, semantic data structures, or UI that core blocks cannot model editably.

Custom block `edit()` output should visually mirror `save()` and use inline `RichText` for visible copy, with InspectorControls or BlockControls for non-inline settings.

## Stage 2: blocks-to-theme

Once an html-to-blocks run has passed its comparison gates, the `blocks-to-theme` skill (`skills/blocks-to-theme/SKILL.md`) extracts an installable WordPress block theme from the workspace: theme.json built from style evidence (presets first, residual CSS only with a documented reason), template parts inferred from cross-page repetition instead of header/footer assumptions, an `index` template plus generic `archive`/`single`/`404` defaults, bundled fonts and media with zero remote URLs, a companion blocks plugin, and a content plugin that imports (and can remove) the generated pages. The theme is verified statically and then booted in WordPress Playground and screenshot-diffed against the original mockups.

Stage-2 tools:

- `analyze_theme_evidence`
- `infer_template_parts`
- `fetch_theme_fonts`
- `scaffold_block_theme`
- `validate_block_theme`
- `playground_render`
- `fix_block_markup` — canonicalize any block markup (parse → recreate from
  attributes → re-serialize) so it byte-matches `save()` output; fixes editor
  block-validation errors in hand-written or AI-generated templates. Theme
  files generated by `scaffold_block_theme` are canonical by construction
  (everything serializes from data-only block trees), so this tool is for
  ingested or hand-edited markup.

Workflow, compressed (the skill and its `references/` docs are the contract):

1. Run `analyze_theme_evidence`; read `reports/theme-evidence.json`.
2. Run `infer_template_parts`; read `reports/template-parts.json`.
3. Write `plan/theme-plan.md`: token map, lift ledger, a decision for every part-evidence group, template plan, page manifest, media map.
4. Run `fetch_theme_fonts` to bundle Google Fonts locally as theme.json fontFace entries.
5. Run `scaffold_block_theme` with the plan's decisions as data.
6. Run `validate_block_theme`; fix and re-scaffold until `errors` is empty.
7. Run `playground_render`; repair (theme.json or theme style.css, never the content payloads) until every page passes both viewports.
8. Quote `reports/theme-validation.json` and the `reports/theme-comparison.json` aggregates in the final response.

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
- `measure_layout`
- `validate_content_model`
- `scaffold_content_model_plugin`
- `analyze_theme_evidence`
- `infer_template_parts`
- `fetch_theme_fonts`
- `scaffold_block_theme`
- `validate_block_theme`
- `playground_render`
- `fix_block_markup`

Run the syntax check with:

```bash
npm run check
```

## Codex

Use the repository as a Codex plugin. The manifest is at:

```text
.codex-plugin/plugin.json
```

The skill names are `content-modeling`, `html-to-blocks`, and `blocks-to-theme`.

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

Note for stdio clients: the server speaks JSON-RPC with `Content-Length` framing (LSP-style), not newline-delimited JSON. It accepts both framings on input but always frames its responses.
