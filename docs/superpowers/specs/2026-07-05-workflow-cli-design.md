# Design: a deterministic CLI runner for the html-to-blocks workflow

## The point

Today the workflow runs as an **agent** driving an MCP server. The agent reads the
skills, decides what to do next, picks a tool, calls it, reads the result, decides
again. On one real index-page run that was **322 assistant turns / 46 min wall**,
with **80% of the clock spent on model generation** over a big, growing context
(see `docs/turn-efficiency-plan.md`). Most of those turns are the agent *deciding*,
not the tools *working* (the whole deterministic pipeline is ~29 s).

This project builds a **CLI that owns the control flow**. The sequence of steps is
fixed in code, not rediscovered by a model every run. Deterministic steps call the
existing tools directly. The steps that genuinely need taste (planning, authoring
the block tree, repair decisions) each become **exactly one non-interactive
`claude -p` call** that takes structured input and returns structured JSON. No
agentic loop, no "what should I do next," no divergence onto newly-discovered
side-quests. The loops that today are open-ended ("repair until close") become
**bounded deterministic loops** (cap + plateau) that the CLI, not the model, drives.

The LLM is demoted from *driver* to *pure function*: structured-in → structured-out,
one turn, no tools. The CLI is the driver.

## What stays, what's new

**Stays untouched:** the entire deterministic engine — `tools/mcp-server.mjs` and
everything under `tools/`. These are the facts (parse, serialize, screenshot, diff,
scaffold, validate, boot Playground). The CLI reuses them verbatim.

**New:** a `cli/` surface and a `wbdc` bin. It adds three things the agent used to
supply itself: (1) the fixed step order, (2) an LLM-as-pure-function harness, and
(3) deterministic bounded loops.

The three stage **skills** (`skills/*/SKILL.md` + references) do not go away — they
become the **source material for the per-step prompts**. Each judgment step's prompt
is grounded in the relevant skill/reference text, so the hard-won judgment rules
(core-first gate, lift-first gate, repair order, harness-artifact stop rules) still
apply. We reuse them; we do not re-derive them.

## Architecture

Two backends behind two interfaces, and a runner that owns the sequence.

```
cli/
  index.mjs            entrypoint: arg parse, dispatch to `run` / `doctor`
  doctor.mjs           setup checks + installers (claude, deps, playwright, playground)
  tool-client.mjs      McpToolClient: spawn tools/mcp-server.mjs, JSON-RPC call(name,args)
  harness/
    index.mjs          Harness interface + getHarness(name) factory
    claude.mjs         ClaudeHarness -> `claude -p` (structured, single-turn, concurrent)
    mock.mjs           MockHarness -> canned/fixture replies for tests & --dry-run
  schemas/             one JSON Schema per judgment step (ajv-validated)
  prompts/             per-step prompt builders, grounded in the skills
  steps/               step definitions (tool steps + judgment steps)
  loops.mjs            bounded repair loop (cap=6, plateau<0.3%, per-page)
  pipeline.mjs         the runner: ordered steps, per-page fan-out, run report
```

### Backend 1 — the tools (`McpToolClient`)

The CLI spawns the existing MCP server once (`node tools/mcp-server.mjs`) and speaks
its newline-delimited JSON-RPC. `client.call('build_page', {...})` returns the tool
result object. This reuses the deterministic engine with **zero changes** and keeps
one source of truth for the tools. (Alternative considered: extract the handlers into
an in-process module. Rejected for v1 — a 2,400-line refactor with more risk than the
IPC it saves; the tools already run in seconds, so subprocess overhead is noise.)

### Backend 2 — the harness (LLM as pure function)

```
Harness.complete({ id, systemPrompt, prompt, schema, model?, timeoutMs? })
   -> { ok: true, data }              // data validated against schema
   -> { ok: false, error, raw }
```

`ClaudeHarness` maps one `complete()` to one child process:

```
claude -p "<prompt>" \
  --output-format json \
  --json-schema <schemaFile> \      # native structured output
  --allowedTools "" \               # no tools => single turn, no agentic divergence
  --no-session-persistence \
  --append-system-prompt "<systemPrompt>"   # the grounded skill rules
```

It parses the `json` envelope, pulls the structured result, and **re-validates**
locally with ajv (belt and suspenders). On parse/validation failure it retries
**once**, appending the validation error to the prompt. Still invalid → `{ ok:false }`,
and the pipeline records the step blocked rather than looping forever.

Concurrency is free: each `complete()` is an independent process. "Run multiple
`claude -p` sessions" = fire several `complete()` calls under a small semaphore
(default 3). Used to fan out pages.

The interface is the extension point. A future `CodexHarness` / `GeminiHarness`
implements the same `complete()` and registers in `getHarness()`; nothing else changes.

### The runner (`pipeline.mjs`)

Owns the fixed order. Every step is `{ id, kind, run(ctx) }`:

- **tool step** — calls `McpToolClient`. Deterministic.
- **judgment step** — builds a prompt (from `prompts/`) + a schema (from `schemas/`),
  calls `Harness.complete`, then **applies** the structured result to the workspace
  (writes files) deterministically. The model returns data; the CLI does the writing.

Because the block tree is already **data-only** (the project's core invariant), a
judgment step can return it as pure JSON — no code-gen escape hatch, no markup. Custom
block source and CSS are returned as string fields and written by the CLI.

## The fixed step sequence

Setup args select which stages run and the inputs. A full provided-markup → theme run:

**Setup (deterministic)**
1. `doctor()` — verify/install prerequisites; **exit non-zero if `claude` is absent**.
2. `create_workspace`
3. `import_provided_markup` → pages manifest. (Brief-only runs instead take a judgment
   `design_mockup` step returning `{html, css, js}`; the import path is the primary,
   fully-deterministic path and the one tested end-to-end first.)

**Stage 1 — html-to-blocks, per page**
4. `analyze_mockup` (tool)
5. **plan** (judgment) → `block-plan.json` (+ `.md`). Grounded in the core-first gate.
6. **custom_blocks** (judgment, optional) → `[{slug, blockJson, indexJs, styleCss}]`.
   Applied by writing the block files (baseline via `scaffold_custom_block`, then the
   returned source).
7. **author_tree** (judgment) → `{ blockTree, pageCss }`. Writes
   `wordpress/pages/<page>.block-tree.json` and `wordpress/pages/<page>.css`.
8. **repair loop** (deterministic, bounded — `loops.mjs`): repeat up to 6×:
   `build_page(page)` → if both surfaces pass thresholds → **PASS, break**; else
   **repair** (judgment) given the report + current tree + current css → returns the
   full updated `{ blockTree, pageCss }` (full-artifact replacement: deterministic to
   apply, robust). Plateau stop (2 iters improving `maxMismatchPercent` < 0.3%). On
   cap/plateau without pass → record page **blocked** with metrics. Never grind.

**Foundation-first + fan-out.** The index (foundation) page runs steps 4–8 inline —
it locks shared chrome, tokens, and custom blocks. The remaining pages each run 4–8
as an **independent sequence**, dispatched as concurrent harness sessions under the
semaphore. Per-page CSS lands in `wordpress/pages/<page>.css`, so parallel sessions
never fight over one file (the tools already read those per-page files).

**Stage 0 — content-modeling (optional, auto-detected)**
A cheap judgment `classify_content` step (or `--stage0 on|off`) decides if the design
implies managed content. If yes: **content_model** (judgment) → `content-model.json`
(+ `.md`) → `validate_content_model` (tool, bounded fix loop) →
`scaffold_content_model_plugin` (tool) → `audit_standins` (tool, must be clean) →
after the Stage-1 gate passes, `hydrate_standins` (tool). Static brochure sites skip
Stage 0 entirely.

**Stage 2 — blocks-to-theme**
9. `analyze_theme_evidence` (tool, compact summary)
10. `infer_template_parts` (tool)
11. **theme_plan** (judgment) → the full `scaffold_block_theme` args object
    (slug, name, tokenMap, themeSettings, themeStyles, parts, templates, pages,
    mediaMap, fontFamilies) + `theme-plan.md`. Grounded in the lift-first + evidence
    gates. Its structured output *is* the scaffold input.
12. `fetch_theme_fonts` (tool, uses the plan's slug)
13. `scaffold_block_theme(args)` (tool)
14. `validate_block_theme` (tool) → bounded fix loop: on errors, **theme_fix**
    (judgment) returns updated `theme.json`/theme `style.css` → re-scaffold → re-validate.
15. **playground gate** (deterministic, bounded): repeat up to 6×: `playground_render`
    → if every page within thresholds at both viewports → **PASS**; else **theme_repair**
    (judgment) given the comparison + `theme.json` + theme `style.css` + gate rules →
    returns updated theme.json/style.css **only** (never content payloads). Plateau/cap
    as Stage 1.
16. `playground_stop` (tool).

**Finish.** Emit `reports/run-report.json` + a human summary: per-page Stage-1 metrics,
theme validation, `theme-comparison` aggregates, custom-block count, stand-ins hydrated.
Exit code reflects pass vs. blocked. **The run is done when the sequence ends** — no
open-ended agent loop remains.

## Structured data is the contract

Every judgment step has an ajv JSON Schema in `cli/schemas/`. The same schema is passed
to `claude -p --json-schema` (native enforcement) and re-checked locally. The step's
`apply()` consumes only validated data. This is what makes each LLM call a *step in one
turn*: it cannot "explore," it must return the one artifact the next step needs.

Full-artifact replacement (return the whole updated tree/css/theme.json) is chosen over
patch/diff ops: applying a patch can fail ambiguously; writing a validated whole file
cannot. The block tree and theme.json are bounded in size, so the token cost is acceptable.

## Setup / doctor

`wbdc doctor` (and the front of every `run`) checks, and installs what it can:

- **`claude` on PATH** — required. Absent → print guidance and **exit 1**.
- **node_modules** — absent → `npm install`.
- **Playwright Chromium** (capture/screenshots) — absent → `npx playwright install chromium`.
- **`@wp-playground/cli`** (Stage 2 only) — absent → install; optionally warm-boot.
- **Network** — needed for `fetch_theme_fonts` and the first Playground boot; warn if offline.

"Download and set up the needed components such as Playground" = these installers.

## CLI surface

```
wbdc run  --source <html-export-dir> --workspace <dir>
          [--brief <text|@file>] [--stages 0,1,2] [--stage0 auto|on|off]
          [--harness claude|mock] [--model <id>] [--concurrency 3]
          [--max-repair 6] [--threshold-mismatch 1] [--threshold-height 8]
          [--force] [--dry-run] [--verbose]
wbdc doctor
```

`--dry-run` uses `MockHarness` so the whole pipeline wiring (order, loops, fan-out,
apply, reports) can run and be tested without spending LLM calls or booting WordPress.

## Testing

- **Unit (no claude, no network):** `tool-client` against the real server on a fixture
  workspace; `loops.mjs` cap/plateau logic; every schema validates its fixture payloads;
  each judgment step's `apply()` writes the expected files given a canned result.
- **Pipeline wiring:** full `run` with `MockHarness` replaying recorded structured
  outputs for `tools/theme/fixtures/mini` — asserts the step order, the bounded loops,
  and the run report, with zero LLM/Playground cost.
- **End-to-end smoke:** one real `run` on `examples/3-artist-music/mockup` (a 5-page
  export) with the real `ClaudeHarness`, Stage 1 only first, then the full theme stage —
  proving turn count and wall-clock against the agent baseline in `turn-efficiency-plan.md`.

## Non-goals (v1)

- Replacing or deleting the MCP server / skills (they remain the engine and the prompt
  source).
- A general workflow-definition DSL — the step list is code.
- Resuming a partially-completed run from disk (nice-to-have; the workspace already
  holds all state, so it can be added later).
- Harnesses other than `claude` and `mock` (the interface exists; implementations are future).
```
