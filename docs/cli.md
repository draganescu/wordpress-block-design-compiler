# The `wbdc` CLI — deterministic workflow runner

The MCP server exposes the deterministic tools; the skills tell an agent how to
drive them. `wbdc` is a third surface: it runs the **same** workflow as a fixed
program instead of an agent, so the step order lives in code and the model is
called only for the judgment steps — each as one non-interactive `claude -p`
turn that returns structured JSON.

Why: an agent-driven run spends most of its wall-clock on model turns deciding
*what to do next* (one real index-page run was 322 assistant turns; see
`docs/turn-efficiency-plan.md`). `wbdc` removes that deliberation. The pipeline
is a fixed list of steps; the repair loops are bounded counters; the LLM is a
pure function (structured input → structured output, no tools, one turn).

## Install / setup

```bash
npm install
node cli/index.mjs doctor      # or: npx wbdc doctor
```

`doctor` verifies and, unless `--no-install`, provisions the deterministic
components:

- **`claude` CLI** — required. If it is missing the CLI exits; install Claude
  Code and run `claude login` first.
- **node_modules** — `npm install` if absent.
- **Playwright Chromium** — `npx playwright install chromium` if absent (used for
  screenshots/diffs).
- **WordPress Playground CLI** — installed on demand for the Stage 2 gate.

## Run

```bash
# From a provided HTML export (single or multi-page):
node cli/index.mjs run --source ./site-export --workspace ./runs/acme

# From a brief (generates the mockup first):
node cli/index.mjs run --brief @brief.md --workspace ./runs/acme
```

### Options

| Flag | Default | Meaning |
|------|---------|---------|
| `--source <path>` | — | HTML export file or directory (siblings become pages) |
| `--brief <text\|@file>` | — | Design brief; generates a mockup when no `--source` |
| `--brochure` | — | Brief only: minimal N-page brochure site, no content model, no custom blocks (see Brochure mode). Ignored with `--source`. |
| `--pages <n>` | `5` | Brochure page count |
| `--no-custom-blocks` | — | Core blocks only (implied by `--brochure`) |
| `--workspace <dir>` | — | Run workspace (required) |
| `--stages 0,1,2` | `0,1,2` | Which stages to run |
| `--stage0 auto\|on\|off` | `auto` | Content-modeling gate (auto = a classify step decides) |
| `--harness claude\|mock` | `claude` | Judgment backend |
| `--model <id>` | `sonnet` | Model for judgment calls. Always pinned explicitly — the account CLI default is never inherited, and fable-class models are refused (a flagship default makes single calls outlast their own timeout). |
| `--fast` | — | Speed preset — see Fast mode below. Same gates and thresholds. |
| `--model-design <id>` | `--model` | Model for design steps (`site_design`, `page_design`, `design_mockup`) |
| `--model-build <id>` | `--model` | Model for build steps (plan, author, theme plan) |
| `--model-repair <id>` | `--model` | Model for repair/fix loops |
| `--effort <level>` | account default | `claude -p --effort` for all judgment calls (`low`…`max`) |
| `--effort-design/build/repair <level>` | `--effort` | Per-role effort override |
| `--concurrency <n>` | `3` (`6` fast) | Max parallel `claude -p` sessions (page fan-out) |
| `--max-repair <n>` | `6` (`2` fast) | Repair/gate loop cap per page and per theme |
| `--call-timeout <s>` | `600` | Per `claude -p` call timeout in seconds |
| `--threshold-mismatch <n>` | `1` (`10` brochure) | Pixel mismatch % gate |
| `--threshold-height <n>` | `8` (`100` brochure) | Height delta px gate |
| `--no-editor` | — | Skip the editor-surface comparison (offline/faster) |
| `--no-playground` | — | Skip the Stage 2 Playground gate |
| `--no-command-log` | — | Don't write `reports/commands.log` |
| `--verbose` | — | Per-call debug logging |

Every run writes **`reports/commands.log`** — a verbatim record of every command it
ran: each MCP tool call (name + full JSON args) and each `claude -p` invocation
(full argv, including the `--append-system-prompt` and `--json-schema`, plus the
exact stdin prompt and the result/cost). It's the auditable, reproducible trail of
what the run actually executed.

Exit code: `0` all gates passed · `3` completed with blocked pages/theme · `1`
hard error or `claude` missing.

## What runs, in order

1. **Setup** — `doctor` → `create_workspace` → `import_provided_markup` (or, from a
   brief, a `design_mockup` call — or the `site_design` + per-page `page_design`
   calls under `--brochure`).
2. **Stage 1 (html-to-blocks), per page** — `analyze_mockup` → **plan** →
   **custom blocks** (scaffold + author) → **author tree** → bounded repair loop
   (`build_page` + **repair**). The foundation/index page runs first to lock the
   shared chrome, tokens, and custom blocks; the remaining pages fan out as
   concurrent `claude -p` sessions.
3. **Stage 0 (content modeling)** — a classify step (or `--stage0 on`) decides if
   the site needs a durable content model; if so: **content model** →
   `validate_content_model` → `scaffold_content_model_plugin`, then after the
   Stage 1 gate, `audit_standins` → `hydrate_standins`.
4. **Stage 2 (blocks-to-theme)** — `analyze_theme_evidence` →
   `infer_template_parts` → **theme plan** → `fetch_theme_fonts` →
   `scaffold_block_theme` → `validate_block_theme` (bounded fix loop) → bounded
   Playground gate (`playground_render` + **theme repair**) → `playground_stop`.
5. **Report** — `reports/run-report.json` plus a printed summary (per-page
   metrics, theme validation, gate result, `claude` call count and est. cost).

Steps in **bold** are the judgment steps — each is one `claude -p` call whose
system prompt is the actual skill text (`skills/**`) and whose output is
validated against a JSON Schema (retried once on mismatch).

## Brochure mode

`--brochure` (brief only) makes a minimal, cohesive multi-page brochure site
instead of a single generated page:

```bash
node cli/index.mjs run --brief "a wine bar in Lisbon" --brochure --pages 5 --workspace ./runs/tinta
```

It replaces the single `design_mockup` step with a `site_design` call (one shared
design system + CSS + header/nav/footer + the page list) followed by one
`page_design` call per page, run concurrently; the CLI wraps each page's `<main>`
in the shared chrome and writes `mockup/<slug>.html` + a shared `mockup/style.css`.
The first page is the home page (slug `index`). Then Stage 1 runs **core blocks
only** (custom blocks are off) and **Stage 0 is forced off** — static brochure
content needs no content model. Stage 2 still builds the installable theme.

This is a prompt-only shortcut: with `--source`, `--brochure` is ignored (with a
warning) because an import must respect the site you provided. `--no-custom-blocks`
is available on its own if you want core-only output without the brochure design flow.

## Fast mode

`--fast` cuts wall-clock time without touching the fidelity gates (mismatch/height
thresholds, editor comparison, and the Playground gate all stay on):

```bash
node cli/index.mjs run --brief "a wine bar in Lisbon" --brochure --fast --workspace ./runs/tinta
```

What it changes:

- **Judgment calls default to a fast model** (`sonnet`) instead of the account's
  CLI default (often the largest, slowest model). Pin any role separately with
  `--model-design` / `--model-build` / `--model-repair`.
- **Brochure pages are pipelined end-to-end.** After the one `site_design` call,
  each page runs its own `page_design → analyze → author → repair` chain
  concurrently — no "design all pages, then build all pages" barrier, and no
  foundation-first wait (brochure pages share no custom blocks, so there is
  nothing for a foundation page to lock).
- **Plan+author are merged** for core-blocks-only pages: the plan step's output
  feeds nothing downstream when custom blocks are off, so the author call plans
  internally and one judgment call per page disappears.
- **Concurrency defaults to 6** so a 5-page site's chains actually overlap.
  (Authoring stays whole-page on purpose: fanning it out per section was tried
  and reverted — sections authored in isolation lose cross-section rhythm and
  first-build fidelity dropped measurably.)
- **One repair round per page/theme** (`--max-repair` defaults to 2), attempted
  only when the miss is within 2× of the gate — profiling showed multi-round
  repairs chasing far-off pages were the single worst time sink, usually
  plateauing above the gate anyway. The loop always **keeps the best build
  seen**: a repair that regresses the metric (or breaks serialization) is
  rolled back before the run reports. Repairs are also *sized to the miss*: a
  page whose pixels already sit under the mismatch gate but whose height
  drifts gets a targeted vertical-rhythm prompt (fewer screenshots, fewer
  turns, CSS-only bias) instead of the full repair context.
- **The brochure theme is assembled deterministically** — zero theme judgment
  calls. The pipeline spliced every page as `[header, main, footer]` around one
  authored chrome, so Stage 2 already knows the structure: it lifts the chrome
  blocks as the header/footer template parts, renders pages through
  `post-content`, and strips the chrome from each page payload. Nothing canned
  enters the output — the chrome design, page trees, and all CSS ship exactly
  as the creative calls authored them; only the bookkeeping the theme-plan call
  used to re-derive (in ~9 minutes, sometimes wrongly) is done in code. The
  theme name comes from the site design's `siteName`. If no page kept the
  spliced shape, Stage 2 falls back to the planned (LLM) path.

Every run (fast or not) also writes **`reports/timings.json`** — per-judgment-call
and per-tool-call timing records. Summarize one or more runs with:

```bash
node tools/profile/timings-summary.mjs runs/<workspace> [runs/<other> ...]
```

## Serve the result

```bash
node cli/index.mjs serve --workspace ./runs/acme [--slug <theme-slug>] [--port 9400]
```

Boots the built theme plus the generated blocks/content/CPT plugins in WordPress
Playground, runs the same blueprint the Stage 2 gate uses (activate the plugins,
import the pages), and **leaves the server running** so you can open the site in a
browser — unlike `playground_render`, which boots only to screenshot and exit. The
slug is auto-detected from `theme/<slug>/theme.json` when omitted; the port falls
back to a free one if the preferred is busy. Stop it with Ctrl-C (or
`pkill -f '@wp-playground/cli'`).

## Robustness

The pipeline is built to finish and report rather than crash on a hard site:

- **Serializer guardrail.** A `SERIALIZER CONSTRAINTS` cheat-sheet heads the author,
  repair, and theme-plan prompts (allowed `core/group` tags, no invented
  attributes, `core/navigation` for nav, no raw-markup fields) — the serializer
  throws on the first violation, so preventing them keeps the repair loop from
  stalling one-violation-at-a-time.
- **Custom blocks author one call per block**, so a big page's blocks don't blow a
  single generation's timeout; a block that still fails keeps its scaffold baseline.
- **Scaffold / validate / Playground fix loops.** A tool that rejects the model's
  output (bad theme args, validation errors, gate drift) feeds the exact error back
  to a fix step and retries, bounded by `--max-repair`.
- **Graceful failure.** A page or stage that throws is recorded in the run report
  (errored / blocked with metrics), never a stack trace; a timeout fails fast
  without a wasted retry.

## Architecture (for extending)

```
cli/
  index.mjs        arg parsing + command dispatch (run / serve / doctor)
  doctor.mjs       setup checks + installers
  serve.mjs        boot a built theme in WordPress Playground and keep it running
  tool-client.mjs  McpToolClient — drives tools/mcp-server.mjs over JSON-RPC
  harness/         Harness interface; ClaudeHarness (claude -p) + MockHarness
  prompts/         skill-grounding loader + serializer-constraints cheat-sheet
  steps/           stage0 / stage1 / stage2 step definitions
  loops.mjs        bounded repair loop (cap + plateau)
  lib/             logger, semaphore, verbatim command log
  pipeline.mjs     the fixed-order runner + fan-out + run report
```

- **Add a harness** (Codex, Gemini, a local server): implement
  `complete({ id, systemPrompt, prompt, schema })` in a new `harness/<name>.mjs`
  and register it in `harness/index.mjs`. Nothing in the steps/loops/pipeline
  changes — they only know the interface.
- **Structured-data contract**: every judgment step has a JSON Schema; the block
  tree is data-only, so it is returned as pure JSON and written by the CLI.
- **Test without spending calls**: `--harness mock` (or `runPipeline({ harness })`)
  replays canned structured outputs; `cli/pipeline.test.mjs` runs a full Stage 1
  against the real tools with a mock LLM and relaxed thresholds.
```
