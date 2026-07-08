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

### API keys and `.env`

Environment keys (`GEMINI_API_KEY` for `--with-images`, anything the `claude`
CLI honors) can live in a `.env` file instead of the shell profile:

```bash
echo 'GEMINI_API_KEY=...' > .env
```

Every command loads it at startup — the directory you invoke `wbdc` from is
checked first, then the wbdc checkout — and the subprocesses (the `claude -p`
judgment calls, Playground) inherit the result. Variables already set in the
real environment always win over the file; a missing file is fine. `.env` is
gitignored.

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
| `--with-images` | — | Generate real images for the design's placeholders (Google Gemini / Nano Banana; needs `GEMINI_API_KEY`) |
| `--image-model <id>` | `gemini-3.1-flash-lite-image` | Image model for `--with-images` |
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

### Images (`--with-images`)

By default, generated designs are CSS-only (no `<img>` elements). With
`--with-images` (and `GEMINI_API_KEY` set — shell or `.env`), the design calls declare
photographic placeholders — `<img src="images/<name>.jpg">` with alt text, a
`data-image-prompt` describing subject/setting/composition, and an optional
`data-image-aspect` — and a generation pass (Google Gemini, the Nano Banana
image models; `--image-model` to override) creates each unique file under the
exact name the placeholder expects, as soon as its page's mockup exists. The
site design's `artDirection`/`mood` tokens are appended to every image prompt
so all photos share one look; the same `src` reused across pages is generated
once. Stage 2 bundles the files into the theme (`assets/images/`) and rewrites
every reference; failures warn and skip, never blocking a page. Without the
key, the flag downgrades to a warning and the design stays CSS-only.

## Fast mode

For a brochure, the generated mockup is scaffolding the user never sees — the
shipped artifact is the WordPress theme. `--fast` therefore treats the design
as a **suggestion**: what must carry over is content, style, spacing rhythm,
mood, tokens, color, typography, and layout direction — not pixel parity with
an internal artifact. Imports are untouched (there the source site is ground
truth, and parity is the product); non-fast brochure keeps the strict
pixel gates too.

```bash
node cli/index.mjs run --brief "a wine bar in Lisbon" --brochure --fast --workspace ./runs/tinta
```

What it changes:

- **Pages gate on sanity, not pixels.** A page passes when its tree
  serializes, renders on both surfaces, and covers **every mockup section**
  (heading coverage is checked deterministically — dropped sections were the
  #1 authoring failure). Pixel mismatch and height are still measured and
  land in the run report as information. Each sanity failure gets exactly one
  bounded fix call; there are no pixel repair loops.
- **The mockup briefs the author, lean trees ship.** The author is told the
  mockup is a design guide: carry content verbatim, keep section order and
  style, and prefer the design system's class names over per-block styling —
  smaller trees generate faster and edit cleaner in the block editor.
- **The site design's tokens land in `theme.json`.** `site_design` emits
  structured tokens (palette, font sizes, spacing scale, mood, layout
  direction); the CLI sanitizes them deterministically into theme.json
  settings, so the user gets a real palette/typography/spacing experience in
  the editor — the surface they actually see.
- **Brochure pages are pipelined end-to-end.** After the one `site_design`
  call, each page runs its own `page_design → analyze → author → check` chain
  concurrently; plan+author merge (custom blocks are off); the shared chrome
  authors once and splices around every page. Concurrency defaults to 6.
  (Per-section author fan-out was tried and reverted — isolated sections lose
  cross-section rhythm.)
- **The theme assembles deterministically** — zero theme judgment calls. The
  splice makes the structure a known fact: chrome blocks lift as template
  parts, pages render through `post-content`, payloads drop their chrome
  copy. Theme validation stays (with deterministic markup canonicalization),
  and Playground runs a **smoke render** — every page must render in real
  WordPress; its mismatch numbers are informational.
- **Judgment calls default to a fast model** (`sonnet`) instead of the
  account's CLI default. Pin any role separately with `--model-design` /
  `--model-build` / `--model-repair`.

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

## Publish a shareable link

```bash
node cli/index.mjs publish --workspace ./runs/acme [--slug <theme-slug>] [--dry-run]
```

Packages the built site as a WordPress Playground bundle — `blueprint.json` plus a
`site.zip` holding `theme/<slug>` and every shipped plugin — pushes it to a
dedicated `playground-artifacts` branch on this checkout's GitHub origin, and
prints a `https://playground.wordpress.net/?blueprint-url=...` link. Opening the
link boots the same site `wbdc serve` shows (the blueprint replays serve's
activation/import steps), entirely in the visitor's browser — no server involved.

Details worth knowing:

- Artifacts go on a **git branch**, not GitHub Releases: Playground fetches the
  ZIP from the browser, and `raw.githubusercontent.com` sends the CORS headers
  that allow that; the release CDN does not. The repo must be public for the
  raw URL to be fetchable — and everything in the bundle becomes public with it
  (the bundle carries only the theme and plugins, never logs or reports).
- The branch keeps an `index.json` and a README table of every published bundle;
  re-publishing a same-named asset needs `--clobber`, and `--name`/`--out`
  control the asset filename and local bundle path (default
  `<workspace>/reports/publish/`).
- `--repo OWNER/REPO` overrides the origin-derived repo; `--dry-run` builds the
  bundle without uploading.

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
  index.mjs        arg parsing + command dispatch (run / serve / publish / doctor)
  doctor.mjs       setup checks + installers
  serve.mjs        boot a built theme in WordPress Playground and keep it running
  publish.mjs      package a run as a Playground bundle + push to the artifact branch
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
