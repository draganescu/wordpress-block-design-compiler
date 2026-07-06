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
| `--workspace <dir>` | — | Run workspace (required) |
| `--stages 0,1,2` | `0,1,2` | Which stages to run |
| `--stage0 auto\|on\|off` | `auto` | Content-modeling gate (auto = a classify step decides) |
| `--harness claude\|mock` | `claude` | Judgment backend |
| `--model <id>` | account default | Model for judgment calls (e.g. a cheaper model to cut cost) |
| `--concurrency <n>` | `3` | Max parallel `claude -p` sessions (page fan-out) |
| `--max-repair <n>` | `6` | Repair/gate loop cap per page and per theme |
| `--call-timeout <s>` | `600` | Per `claude -p` call timeout in seconds |
| `--threshold-mismatch <n>` | `1` | Pixel mismatch % gate |
| `--threshold-height <n>` | `8` | Height delta px gate |
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

1. **Setup** — `doctor` → `create_workspace` → `import_provided_markup` (or a
   `design_mockup` judgment call from the brief).
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

## Architecture (for extending)

```
cli/
  index.mjs        arg parsing + command dispatch
  doctor.mjs       setup checks + installers
  tool-client.mjs  McpToolClient — drives tools/mcp-server.mjs over JSON-RPC
  harness/         Harness interface; ClaudeHarness (claude -p) + MockHarness
  prompts/         skill-grounding loader
  steps/           stage0 / stage1 / stage2 step definitions
  loops.mjs        bounded repair loop (cap + plateau)
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
