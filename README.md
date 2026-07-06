# HTML to WordPress Blocks

This repo turns a designed HTML/CSS page into editable WordPress block content, and then into an installable block theme. It runs as an MCP server: an agent (Claude Code, Codex, or any MCP-capable client) calls the tools, and a set of skills tells the agent how to use them.

For the full picture — directory map, the workspace layout, the fidelity gates, how the deterministic tools and the skills divide the work — read [`docs/architecture.md`](docs/architecture.md).

## The problem

Ask an LLM to "rebuild this design as WordPress blocks" and the result usually looks flatter than the design it started from. Direct block generation drops layout, rhythm, and typography even when the model can see the original. The hard part is design transfer: keeping a page's visual language while ending up with content a person can still edit in the block editor.

This repo splits that work into stages. The HTML mockup stays the visual source of truth. Deterministic tools do the mechanical parts — analysis, serialization, preview, screenshot diffing, validation. The LLM does the judgment — which blocks to use, when a custom block earns its keep, which controls keep the content editable. Every stage leaves files on disk you can open and check.

## How it is put together

Two pieces:

- **MCP tools** (`tools/`) do the deterministic work. Given files in a workspace, they produce more files: analysis JSON, serialized block markup, rendered previews, screenshots, pixel diffs, scaffolded plugins, a booted Playground comparison. Same input, same output. They never call a model.
- **Skills** (`skills/`) are the playbooks the agent follows. Each `SKILL.md` plus its `references/` is the contract for one stage: what to look at, which decision to make, which tool to call next, when the stage is done. The judgment lives here; the tools enforce the facts.

There is no CLI and no hosted backend. The server speaks JSON-RPC over stdio, and an agent drives it.

## The three stages

A run moves through up to three stages. Many pages only need the middle one.

**Stage 0 — content modeling** (`skills/content-modeling`). Decide what is page content and what belongs in WordPress admin as data: custom post types, taxonomies, post meta, form submissions, seed records. The output is `content-model/content-model.json` and an installable plugin that registers all of it. Skip this stage for static pages.

**Stage 1 — html-to-blocks** (`skills/html-to-blocks`). The core. Analyze the mockup, plan a core-first block tree, build it as data (`wordpress/block-tree.json` — block names, attributes, supports, classes, inner blocks, no raw HTML), serialize it through WordPress packages, and diff the result against the mockup until both the rendered page and the editor preview match within threshold. When the design has dynamic collections, mark those regions as stand-ins during the visual pass, then hydrate them into real `core/query` / `core/comments` blocks once the layout is locked.

**Stage 2 — blocks-to-theme** (`skills/blocks-to-theme`). Turn a passed run into an installable block theme. Read style evidence across pages, lift recurring tokens into `theme.json`, infer template parts from what actually repeats across pages, scaffold the theme plus a blocks plugin and a content plugin, validate it statically, then boot it in WordPress Playground and screenshot-diff every page against the original mockups.

## The data-only rule

The block tree is data, never markup. It carries block names, attributes, supports, style attributes, classes, and inner blocks. It must not contain raw-markup escape hatches such as `htmlLines`, `innerHTML`, `innerContent`, `markup`, or `sourceHtml`. Canonical markup comes out of `serialize_wordpress_blocks` (and `fix_block_markup` for anything hand-edited), so the editor never sees block-validation errors.

## MCP tools

Workspace and html-to-blocks:

- `create_workspace` — make a workspace with mockup, plan, wordpress, rendered, editor, and report folders.
- `import_provided_markup` — pull an existing HTML/CSS export into the workspace instead of generating a mockup. Returns a `pages` manifest for multi-page sources.
- `analyze_mockup` — content inventory and CSS selector summaries from the mockup.
- `scaffold_custom_block` — a vanilla-JS custom block baseline (`block.json`, `index.js`, `style.css`).
- `serialize_wordpress_blocks` — turn `block-tree.json` into canonical content markup, a frontend render, an editor preview, and CSS reports.
- `create_block_editor_preview` — a no-build editor preview that loads the block tree, custom blocks, and CSS.
- `screenshot_html` — screenshots for mockup / rendered / editor pages, no diff.
- `compare_html` — screenshots plus pixel diffs plus a per-page comparison report and repair tasks.
- `measure_layout` — per-element geometry drift between mockup and rendered/editor, to localize where a height delta comes from.
- `build_page` — one call that serializes, writes both previews, pixel-diffs both surfaces at both viewports, and measures geometry, returning a single report. One repair iteration in one tool call.
- `fix_block_markup` — canonicalize markup so it byte-matches `save()` output.

Content modeling and stand-ins:

- `validate_content_model` — check a content-model JSON for CPT, taxonomy, meta, REST, and seed consistency.
- `scaffold_content_model_plugin` — generate the installable plugin from the content model, with a Tools screen to import and remove seed content.
- `audit_standins` — list every stand-in mark across the page trees and validate them against the content model.
- `hydrate_standins` — swap marked stand-ins into real dynamic blocks (`core/query` + `core/post-template`, `core/comments`) once the visual gate has passed.

Blocks-to-theme:

- `analyze_theme_evidence` — recurring colors, fonts, spacing, custom properties, and per-rule lift buckets across pages.
- `infer_template_parts` — group repeated cross-page subtrees into template-part candidates from evidence.
- `fetch_theme_fonts` — resolve the mockup's Google Fonts import into local woff2 files and `theme.json` fontFace entries.
- `scaffold_block_theme` — write the theme, blocks plugin, and content plugin from the agent's decisions.
- `validate_block_theme` — static gate: schema, template/part parse, file/ref/font/remote-url/payload checks.
- `playground_render` — boot the theme and plugins in WordPress Playground, import the pages, screenshot every page, and diff against the mockups.
- `playground_stop` — stop the warm Playground server held for a workspace.

## Running it

Install dependencies, then point an MCP-capable agent at the server:

```bash
npm install
node tools/mcp-server.mjs
```

Example Claude Desktop entry (there is a ready copy in `claude/claude_desktop_config.example.json` and an `.mcp.json` for Claude Code):

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

The server speaks JSON-RPC and matches whichever framing the client uses — newline-delimited JSON (the MCP stdio default, what Claude Code uses) or `Content-Length` (LSP-style). It accepts both on input and replies in kind.

Before calling the tools, an agent should read `claude/CLAUDE.md` or the relevant `skills/*/SKILL.md`.

## Running it as a CLI

There is a second surface that runs the whole workflow without an agent: the `wbdc` CLI. It owns the step order in code — deterministic steps call the tools directly, and the judgment steps (plan, author the block tree, repair) each become one non-interactive `claude -p` call that returns structured JSON. The repair loops that an agent would run open-ended become bounded loops the CLI drives. This trades the agent's many decision turns for a fixed, scripted sequence.

```bash
node cli/index.mjs doctor                                   # verify/install setup (exits if `claude` is missing)
node cli/index.mjs run --source ./site-export --workspace ./runs/acme
node cli/index.mjs run --brief @brief.md --workspace ./runs/acme --stages 1
node cli/index.mjs run --brief "wine bar in Lisbon" --brochure --workspace ./runs/tinta
node cli/index.mjs serve --workspace ./runs/acme            # boot the built theme in WordPress to look at it
```

It needs the `claude` CLI on PATH (and `claude login`); it provisions the rest (Playwright Chromium, WordPress Playground) itself.

A few things worth knowing:

- **`--brochure`** (brief only) builds a minimal multi-page brochure site — a cohesive N-page static site (default 5, `--pages`) with shared header/nav/footer and one design system, and **no content model and no custom blocks**. It's a prompt-only shortcut; with `--source` it's ignored, because an import must respect the site you gave it.
- **`wbdc serve`** boots the built block theme plus the generated blocks/content/CPT plugins in WordPress Playground and imports the pages, then leaves it running so you can open it in a browser (`http://127.0.0.1:9400/` by default).
- **Structured every step.** Each `claude -p` call is single-turn (`--allowedTools ""`) with a JSON Schema (`--json-schema`), re-validated locally and retried once — so a step returns the one artifact the next step needs, never a tool-using detour.
- **Bounded, honest loops.** Repair and gate loops stop on pass, plateau, or a cap and report blocked pages with metrics rather than grinding; a page or stage that fails is recorded, not a crash.
- **Verbatim audit trail.** Every run writes `reports/commands.log` — every MCP tool call and every `claude -p` invocation (full argv + prompt + result). Disable with `--no-command-log`.
- **Cost/scale knobs.** `--model` (e.g. a cheaper model for a first pass), `--concurrency` (parallel page sessions), `--max-repair`, `--call-timeout`, `--no-playground`, `--no-editor`.

See `docs/cli.md` for the full option list and the architecture, including how to add a non-Claude harness.

## Codex

Use the repo as a Codex plugin. The manifest is at `.codex-plugin/plugin.json`, and the skill names are `content-modeling`, `html-to-blocks`, and `blocks-to-theme`.

## Checks, tests, profiling

```bash
npm run check     # syntax-check the server and library entrypoints
npm test          # node --test across tools/lib, tools/theme, tools/content, tools/profile
npm run profile   # timing harness — see docs/profiling-plan.md
```

`npm run profile` measures tool runtime, not output quality. There is no automated fidelity eval; quality is gated per run by `compare_html` / `build_page` thresholds and `playground_render`.

## Where to read next

- [`docs/architecture.md`](docs/architecture.md) — the repo-wide guide.
- `skills/*/SKILL.md` — the stage contracts the agent follows.
- `spec.md` — the original grounding spec. It predates the current shape; `docs/architecture.md` notes where the build diverged.
