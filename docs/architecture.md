# Architecture

This is the repo-wide guide. It explains what the project does, how the pieces fit, what a run produces on disk, and where to look when you need to change something. The README is the short version; this is the one to read before working in the code.

## What this repo is

A staged compiler that takes a designed HTML/CSS page and produces editable WordPress block content, and then an installable block theme. It ships as an MCP server. An agent — Claude Code, Codex, or any MCP-capable client — calls the tools; a set of skills tells the agent how and in what order. The whole thing is a toolbox plus the playbooks for using it.

There is also a second, non-agent surface: the `wbdc` CLI (`cli/`, `docs/cli.md`). It runs the same workflow as a fixed program — deterministic steps call the tools directly; the judgment steps each become one non-interactive `claude -p` call returning structured JSON — so a run is a bounded, scripted sequence instead of an open-ended agent loop. The CLI is additive: it drives the same `tools/` engine and reuses the `skills/` text as its per-step prompts.

## The problem it solves

Modern LLMs design good HTML. Point one at a rough brief and it returns a page with real layout, type, color, and motion. The same model, asked to "rebuild that as WordPress blocks," tends to hand back something flatter — the structure survives, the design does not. This shows up even when the model can see the original markup and screenshots.

The reason is that two goals pull against each other. You want the WordPress output to look like the mockup, and you want it to stay editable in the block editor. Optimizing for one quietly costs the other. Pour the page into a single `core/html` block and it matches pixel-for-pixel while being uneditable. Break it into tidy core blocks and the layout drifts.

So the work is split at the seam where it actually gets hard — design transfer — and that seam is wrapped in deterministic checks. The HTML mockup is the visual source of truth for the entire run. Tools handle the parts a computer should own: parsing, serialization, preview, screenshots, pixel and geometry diffs, plugin scaffolding, booting WordPress. The model handles the parts that need taste: choosing blocks, deciding when a custom block is worth building, picking the controls that keep content editable. After every change, the tools measure how far the result has drifted from the mockup and hand back specific repair tasks.

## The shape: deterministic tools and skills

Two layers, with a clear line between them.

**Deterministic tools** live in `tools/` and are exposed over MCP by `tools/mcp-server.mjs`. They read files from a workspace and write files back. The same inputs always give the same outputs, and none of them call a model. They are the facts: this is the canonical markup, this is the pixel mismatch, this template part recurs on four pages, this is the geometry delta at section three.

**Skills** live in `skills/` and are markdown. Each `SKILL.md` plus its `references/` folder is the contract for one stage — what to inspect, which decision to make, which tool to call, what counts as done. The judgment lives here. When the system "decides" to use a `core/cover` instead of a custom block, that decision came from an agent following a skill, validated afterward by a tool.

This division is the main thing to hold onto. If a behavior is mechanical and repeatable, it belongs in a tool. If it needs a model to weigh fidelity against editability, it belongs in a skill, and a tool checks the result.

## Directory map

```
tools/                      deterministic MCP tools (the engine)
    mcp-server.mjs          JSON-RPC stdio server; registers and dispatches every tool
    lib/                    workspace, capture (screenshots), serialize, dynamic render, fix-markup, profile
    content/                content-model validation and stand-in handling
    theme/                  blocks-to-theme: evidence, parts, fonts, scaffold, validate, Playground
        generate/           theme files, blocks plugin, content plugin, Playground gate mu-plugin
        fixtures/mini/      a tiny two-page theme used by tests
    profile/                timing harness and its fixtures

skills/                     the agent-facing contracts (one folder per stage)
    content-modeling/       Stage 0: SKILL.md + references
    html-to-blocks/         Stage 1: SKILL.md + references (design, planning, core blocks, repair)
    blocks-to-theme/        Stage 2: SKILL.md + references (theme.json, parts, fonts, Playground)

docs/                       this guide and the planning notes
claude/                     CLAUDE.md and a Claude Desktop config example
.codex-plugin/plugin.json   Codex plugin manifest
.mcp.json                   MCP config for Claude Code
spec.md                     the original grounding spec (historical — see below)
```

Generated runs do not live in the repo. They go in an ignored local folder (`examples/` is the convention), or anywhere outside the tree.

## A run is a folder

Every run is a workspace directory. The stages read and write files inside it, so at any point you can open the folder and see exactly where things stand. Paths vary by single-page versus multi-page, but the layout looks like this:

```
workspace/
    mockup/
        index.html              the design — source of truth (or <page>.html per page)
        style.css
    content-model/              Stage 0, when the design has data
        content-model.json
        plugin/<slug>/          the installable CPT/taxonomy/meta/submissions plugin
    content/seeds/              seed-record payloads referenced by the content model
    plan/
        block-plan.md           Stage 1 plan: tokens, per-section strategy, decisions
        block-plan.json
        theme-plan.md           Stage 2 plan: token map, lift ledger, part decisions, manifest
    wordpress/
        block-tree.json         the data-only block tree (single page)
        content.html            canonical serialized markup
        pages/<page>.block-tree.json
        pages/<page>.content.html
        blocks/<block>/         custom blocks: block.json, index.js, style.css
        style.css               small, explainable page CSS
    rendered/                   frontend renders of the serialized blocks
    editor/                     no-build editor previews
    visual/                     screenshots
    reports/                    every gate writes its result here
        comparison.json         pixel + geometry result for a page
        repair-tasks.md         localized fixes when a gate misses
        content-model-validation.json
        standins.json           regions still waiting on hydration
        standins-hydration.json
        theme-evidence.json     recurring tokens and per-rule lift buckets
        template-parts.json     repeated cross-page subtrees
        theme-validation.json   static theme gate
        theme-comparison.json   Playground screenshot diff
        playground/             Playground boot artifacts
    theme/<slug>/               Stage 2 output: the installable block theme
    theme-plugin/               the generated blocks plugin and content plugin
```

## Stage 0 — content modeling

`skills/content-modeling`, tools `validate_content_model`, `scaffold_content_model_plugin`.

This stage runs when the design implies data rather than fixed page copy: a list of events, a directory of members, a contact form that should store submissions, a gallery backed by a custom post type. It looks at the brief and the mockup and decides what should be page content and what should live in WordPress admin.

The output is `content-model/content-model.json` — the description of custom post types, taxonomies, post meta, submission REST routes, and seed records — and an installable plugin scaffolded from it. The plugin registers everything while active and adds a Tools screen that imports and removes the generated seed content, reporting slug collisions and any records a user has since modified. Seed content is explicit: the model lists records, and the seed markup moves to payload files under `content/seeds/`.

Static brochure pages skip this stage entirely.

## Stage 1 — html-to-blocks

`skills/html-to-blocks`, the bulk of the tools. This is the core of the project.

The flow:

1. **Get a mockup.** Either the agent generates one from the brief (guided by `references/design-prompt.md`) or `import_provided_markup` brings in an existing HTML/CSS export. Multi-page sources return a `pages` manifest.
2. **Analyze.** `analyze_mockup` produces a content inventory and CSS selector summary so planning works from structured facts.
3. **Plan, core-first.** Write `plan/block-plan.md` and `.json`. The rule is to reach for core blocks and block supports before anything custom — `core/group`, `core/columns`, `core/cover`, `core/image`, `core/heading`, `core/buttons`, and friends, with color, spacing, typography, and layout pushed into attributes. A custom block is for the cases core cannot model editably: real forms, carousels with editable slides, repeated structured cards, domain components. `references/core-block-selection.md` and `references/custom-block-standards.md` are the decision guides.
4. **Build the tree as data.** Assemble `wordpress/block-tree.json` — names, attributes, supports, classes, inner blocks. No markup (see the data-only rule below). Custom blocks get scaffolded with `scaffold_custom_block`.
5. **Serialize and preview.** `serialize_wordpress_blocks` runs the tree through `@wordpress/blocks` and `@wordpress/block-library` to produce canonical content markup, a frontend render, and a no-build editor preview.
6. **Diff and repair.** `build_page` is the workhorse here: in one call it serializes, writes both previews, screenshots and pixel-diffs the rendered page and the editor against the mockup at both viewports, and measures per-section geometry, returning one report with localized repair tasks. (The same work is available as the separate `serialize → create_block_editor_preview → screenshot_html → compare_html → measure_layout` chain when you want the steps individually.) Repair from the tasks and run it again. The run passes when both surfaces are within threshold. `references/repair-loop.md` describes the stopping rule.

A page is done when the rendered frontend and the editor preview both match the mockup within the configured pixel-mismatch and height-delta thresholds. Pixel-perfect but uneditable does not count as done unless the brief explicitly traded editability away.

### Stand-ins and hydration

Dynamic content creates a sequencing problem: a query loop renders whatever posts exist, which is not the fixed design you are trying to match. The fix is to hold the dynamic regions static while the layout is being nailed down, then make them dynamic once it is.

During Stage 1, regions that will become loops or comment threads are marked as stand-ins (`attrs.metadata.standin`) and filled with static placeholder content, so they screenshot deterministically and pass the visual gate. `audit_standins` lists every mark and checks it against the content model. After the gate passes — and the content-model plugin exists — `hydrate_standins` swaps the marked regions into real dynamic blocks: query stand-ins become `core/query` + `core/post-template` with the field marks turned into `core/post-title`, `core/post-featured-image`, `core/post-terms`, `core/post-excerpt`, and `core/post-date`; comments stand-ins become `core/comments`. It preserves `className` and `style` so the CSS lifted in the next stage still lands. Hydration backs up the pre-hydration trees first. The hydrated result is what feeds Stage 2.

## Stage 2 — blocks-to-theme

`skills/blocks-to-theme`, tools `analyze_theme_evidence`, `infer_template_parts`, `fetch_theme_fonts`, `scaffold_block_theme`, `validate_block_theme`, `playground_render`, `playground_stop`.

Theme work is deliberately last. Generating `theme.json` up front forces generic styling before the run has shown which styles actually repeat. Once one or more pages have passed their visual gates, the styling that matters is visible in the block trees and CSS, and the theme can be extracted from that evidence.

The flow:

1. `analyze_theme_evidence` ranks recurring colors, fonts, sizes, spacing, and custom properties across all pages, and buckets every CSS rule by how it could lift. It reports facts; the agent decides what becomes a token. (The tool returns a ranked summary and writes the full ~100KB report to `reports/theme-evidence.json` so it does not bloat the agent's context on later turns.)
2. `infer_template_parts` groups top-level subtrees that repeat across pages into template-part candidates, with occurrence and position evidence. There is no header/footer assumption — a part is a part because it recurs.
3. Write `plan/theme-plan.md`: the token map, a lift ledger (what goes to `theme.json`, what stays as residual CSS and why), a decision for every part-evidence group, the template plan, the page manifest, and the media map.
4. `fetch_theme_fonts` resolves the mockup's Google Fonts `@import` into local woff2 files and `theme.json` fontFace entries, so the theme ships with zero remote font URLs.
5. `scaffold_block_theme` writes everything from the plan's decisions: the theme (`style.css`, `theme.json`, templates including default `archive`/`single`/`404`, parts, `functions.php`, assets), a companion blocks plugin, and a content plugin that imports the generated pages. It owns the mechanical rewrites — preset references, `--wp--custom--` renames, permalink link maps, media placeholders.
6. `validate_block_theme` is the static gate: `theme.json` against the vendored schema, every template and part parsing with all blocks registered, plus header, file, reference, fontFace, remote-URL, and payload checks. Fix and re-scaffold until it reports no errors.
7. `playground_render` boots the theme and plugins in WordPress Playground, imports the pages through the content plugin, screenshots every page logged-out at both viewports, and diffs against the mockups into `reports/theme-comparison.json`. Repair `theme.json` or the theme `style.css` — never the content payloads — until every page passes. `playground_stop` releases the warm Playground server when you are finished.

## What "passing" means

Every gate is deterministic, so "done" is a measured state, not a judgment call.

- **Block markup round-trips.** The tree serializes through `@wordpress/blocks` and parses back without validation errors. `fix_block_markup` canonicalizes anything hand-edited so it byte-matches `save()`.
- **Visual fidelity.** Full-page screenshots of the rendered frontend and the editor preview are pixel-diffed against the mockup at desktop and mobile. The default thresholds are 1% pixel mismatch and an 8px height delta; `measure_layout` localizes any miss to a specific section.
- **Editor fidelity.** Text edits as text, images as images, repeated content as repeated blocks or inner blocks, custom blocks expose real controls, and raw HTML stays out of the tree.
- **Theme gates.** Static validation passes with no errors, then Playground renders every page within the same pixel and height thresholds.

There is no scored eval suite. Quality is enforced one run at a time by these gates. The profiling harness under `tools/profile/` measures how long tools take, not how good the output is.

## The data-only block tree rule

The block tree carries data and nothing else: block names, attributes, supports, style attributes, classes, and inner blocks. It must never contain raw-markup escape hatches — `htmlLines`, `innerHTML`, `innerContent`, `markup`, `sourceHtml`. Markup is generated from the data by `serialize_wordpress_blocks`, which is the only thing that should be producing block HTML.

Two reasons. First, markup that does not exactly match a block's `save()` output throws block-validation errors in the editor, and hand-written or model-written markup rarely matches. Generating it from data sidesteps that. Second, a raw-HTML escape hatch is the easy way to "win" the pixel diff while losing editability, which is the exact failure this project exists to avoid. Keeping the tree data-only makes that shortcut unavailable.

## Running, testing, profiling

```bash
npm install
node tools/mcp-server.mjs     # start the MCP server an agent will drive

npm run check                 # syntax-check the server and library entrypoints
npm test                      # node --test across lib, theme, content, profile
npm run profile               # timing harness; see docs/profiling-plan.md
```

`tools/theme/fixtures/mini/` and `tools/profile/fixture*/` are small fixed inputs the tests and the profiler run against, so neither needs a live design or a network call for the deterministic paths. `fetch_theme_fonts` and `playground_render` do need the network on first use (font download, WordPress build).

## How spec.md relates

`spec.md` is the original grounding spec, written before the build settled into its current shape. The core ideas held: mockup as source of truth, a staged deterministic pipeline with the model used only for judgment, core-first block decisions, preview without a WordPress install, pixel and editor fidelity as gates, and theme inference as a later extraction pass. Read it for the reasoning behind the approach.

A few things landed differently from the spec, worth knowing so the spec does not mislead you:

- **Surface.** The spec described a CLI engine (`wp-block-compiler design/analyze/plan/...`) with MCP as an optional add-on. The build went MCP-first: the MCP server + skills is the primary surface. A CLI came later but in a different shape than the spec imagined — `wbdc` (`docs/cli.md`) is not the engine, it is a deterministic *driver* over the MCP engine that replaces the agent with a fixed step list and per-step `claude -p` calls.
- **Eval harness.** The spec's Slice 8 called for a fixture-driven quality eval with strategy assertions and editability scores. What exists is a performance profiler (`tools/profile/`). Fidelity is gated per run by `build_page` / `compare_html` and `playground_render`, not by a standing eval suite.
- **Beyond the spec.** Content modeling (Stage 0) and the full theme extractor (Stage 2) are larger than the spec anticipated — the spec sketched theme inference in a few bullets and did not mention content modeling, stand-ins, or hydration at all. Multi-page support is also new; the spec scoped itself to a single page.

## Other docs

- `docs/cli.md` — the `wbdc` deterministic CLI runner (non-agent surface).
- `docs/parallelization-plan.md` — running stages and pages concurrently.
- `docs/profiling-plan.md` — what `npm run profile` measures and how.
- `docs/turn-efficiency-plan.md` — cutting agent turns per run.
- `docs/from-html-to-editable-wordpress.md` — narrative walkthrough of the approach.
- `skills/*/SKILL.md` — the per-stage contracts the agent actually follows.
