# Turn-efficiency plan — collapse the agent loop

## The problem, measured

One real index-page run (transcript-decomposed):

- **46 min wall** · **322 assistant turns** · **134 tool calls** · ~**9 s generation/turn**
- **80% model generation**, **4% tool execution**, 11% waiting on the human, 6% harness.
- **827k output tokens** generated; **102.9M** cache tokens read/created (large, growing context).

Wall-clock ≈ turns × per-turn generation latency. The tools are fast (the whole
deterministic pipeline is 29 s). The cost is the **serial, chatty loop over a big
context**: one tool call per turn, each paying generation latency, the context
re-read every turn.

Three levers, in priority order: **(1) fewer turns** (composite tools so one call
finishes a step), **(2) parallelism** (independent pages run as concurrent
subagents), **(3) lower per-turn latency** (lean context, compact tool output).
Stricter skills make the agent execute a recipe instead of deliberating between
every call.

## A. Collapse the per-page loop into one composite tool (biggest single lever)

Today one repair iteration is ~5–6 calls across ~5–6 turns:
`serialize` → `create_block_editor_preview` → `screenshot_html` → `compare_html`
→ read 3 diff images → `measure_layout`. Each hands off to the next via a new turn.

1. **New tool `build_page`** (wraps the existing `tools/lib/*` functions): serialize
   + preview + screenshot + compare + measure in **one** call. Returns a single
   structured report: `{ rendered, editor }` metrics, **per-section height deltas**
   (fold `measure_layout` in — always returned), **localized repair tasks**, and
   small base64 diff thumbnails so the agent rarely needs a separate image read.
   Register in `tools/mcp-server.mjs`; reuse `compare_html`/`measure_layout` internals.
   *Effect: ~5 turns/iteration → 1.*
2. **`measure_layout` becomes part of the report, not a separate tool call.** The
   agent should never need a second turn to find *where* the drift is.
3. **`--fix` mode for mechanical repairs.** `build_page`/`scaffold` auto-apply the
   deterministic fixes the agent currently spends turns on: `fix_block_markup`,
   internal-link rewrite, `blockGap`, full-bleed `align` (see C). It applies and
   reports; the agent does not round-trip for them.

## B. Multi-page: batch the tool, fan out the LLM

4. **`build_pages` (batch).** One call runs the html-stage capture for **every**
   page, launching the per-page browsers in parallel internally (capture already
   relaunches per call — pool them). Returns the whole-site report in one turn
   instead of N.
5. **Parallel page subagents.** Skill protocol: read the import manifest, declare
   **all** pages up front, build the **foundation** page inline (locks shared
   chrome, tokens, components, theme), then **fan the remaining pages out to
   concurrent subagents** (the `Agent` tool, sent in one message), each with a
   strict tool-call budget (~30) and a wall-clock cap; on exceed it reports partial
   metrics, it does not grind. The shared work is already done, so each page is
   "author tree → `build_page` → ≤N repairs."
6. **Kill shared-file contention.** Per-page CSS goes to **per-page files**
   (`wordpress/pages/<page>.css` or block CSS), concatenated by the scaffold — so
   parallel subagents never fight over `wordpress/style.css`. The foundation owns
   the shared token/component layer; pages only add their own.

## C. Harden tools so the agent stops diagnosing (each line = turns wasted this run)

7. **`capture.mjs`: auto-neutralize JS reveal/load-fade.** The mockup hid below-fold
   content behind a scroll-`IntersectionObserver` (`.reveal { opacity:0 }`) and a
   `body { opacity:0 }`→`.loaded` fade; full-page capture never scrolled, so the
   mockup shot was blank and I burned ~5 turns diagnosing + hand-patching CSS.
   Extend the existing `motionFreezeCss` to force `.reveal`/`[class*=reveal]`
   visible and `body` opaque. *Removes a whole diagnosis detour.*
8. **`analyze_mockup`: exhaustive section coverage.** It silently dropped the page's
   stats bar; I found it only by eyeballing a screenshot (~3 turns). Every top-level
   block in `<body>`/`<main>` must appear in the inventory, flagged if it has no
   heading/card/form.
9. **`scaffold` / `content-plugin`: don't fatal on a single-page subset.** Links to
   pages not in the manifest must be **rewritten to the front page or stripped with
   a warning**, not a validate error (cost ~6 turns of link-chasing). *(The
   blocks-plugin `Requires Plugins` fatal for core-only themes is already fixed this
   session — keep that.)*
10. **`scaffold`: infer the WordPress layout cascade.** Auto-set `align:full` on
    full-bleed bands (background spans the viewport in the mockup) and default
    `styles.spacing.blockGap` to `0` when the workspace CSS owns vertical rhythm.
    The manual `blockGap` fix alone took the gate 27% → 8.8%; making it a default
    (or one inferred knob) saves a gate iteration.

## D. Make the skills strict (remove deliberation + discovery turns)

11. **Replace prose with a recipe.** `skills/html-to-blocks/SKILL.md` and
    `blocks-to-theme/SKILL.md` should give the **exact ordered tool calls with
    argument templates** for the happy path, so the agent executes instead of
    re-deciding each step.
12. **Batch authoring rule:** author the **entire** page tree in one write; never
    section-by-section. (One 18,959-token write took 92 s — fine; ten small writes
    cost ten turns.)
13. **Read budget:** forbid reading whole stylesheets / inventories / evidence into
    context. The tools surface what's needed; the agent works from tool output, not
    raw files.
14. **Fixed multi-page protocol** (declare-all → foundation → parallel fan-out) and a
    **tightened repair loop**: each iteration is exactly `build_page` → one edit →
    `build_page`, ≤N iters, plateau-stop.

## E. Cut per-turn latency (the 9 s floor)

15. **Compact tool output by default.** `analyze_theme_evidence` returned 112 KB
    (4,758 lines) — every subsequent turn re-processed it. Return a ranked summary +
    a file path for detail; same for the content inventory.
16. **Delegate heavy reads to `Explore`/`fork` subagents** that return conclusions,
    not file dumps, keeping the orchestrator context small. 102.9M cache tokens
    processed is the per-turn tax; the orchestrator should hold a plan, not a corpus.

## Expected shape after

- Per-page iteration: ~5 turns → **1** (`build_page` returns everything).
- A page end-to-end: ~20 turns → **~4–5** (author → build → repair → build).
- A site: **serial → parallel** (wall = slowest page, not the sum).
- Orchestrator context: large/growing → lean (reads delegated, outputs compact),
  dropping the per-turn generation floor.

The clock isn't the target — turns and context are. Cut both and the wall-clock
(which is 80% generation) collapses with them.

## Sequencing

Land in impact order: **A1 `build_page`** (kills the per-iteration round-trips) →
**C7–C10** (the four hardening fixes remove fixed turn-detours) → **B4–B6**
(batch + parallel pages) → **D/E** (skill recipe + context discipline). A1 alone
removes the largest share of turns on a single page; B unlocks multi-page without
multiplying turns.
