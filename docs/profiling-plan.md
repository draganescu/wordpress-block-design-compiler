# Profiling Plan: Where Does a Skill Run Spend Its Time?

A skill run (html-to-blocks, blocks-to-theme, content-modeling) is an
agent-driven loop: the model reasons, emits a tool call, an MCP tool executes
(often spawning a browser or the Playground CLI and pulling assets over the
network), a result returns, the model reasons again. To make these skills faster
we first need to attribute wall-clock **accurately** across the layers, with no
double-counting and with cold-vs-warm and interactive-vs-batch separated.

## Goals — the questions this must answer

1. Of total run wall-clock, what fraction is **agent reasoning** vs **tool CPU**
   vs **subprocess boot** vs **network streaming**?
2. Within tool CPU, which tools dominate (serialize? compare? scaffold?)?
3. Within network, which hosts/resources dominate, and how much is re-fetched
   needlessly across calls?
4. Which costs are **repeated** per call that could be amortized (browser
   relaunch, core-block registration, the 47 s.w.org editor scripts)?
5. **Cold vs warm**: first-run penalties (Playground WP download, font fetch,
   npm cache, CDN cold) vs steady state.
6. **Interactive vs batch**: persistent MCP server (caches across calls) vs the
   `artifacts/mcp-call.sh` driver (fresh `node` process per call).

## The four layers, and how to attribute each

Every millisecond of run wall-clock belongs to exactly one bucket:

| Layer | Definition | Where measured |
|---|---|---|
| **Agent step** | model TTFT + generation + reasoning between a tool_result and the next tool_use | transcript timestamps; harness telemetry |
| **Transport** | MCP JSON-RPC framing, arg/result (de)serialization, `node` spawn in driver mode | server receive/respond stamps minus handler time |
| **Tool CPU** | synchronous Node work in the handler (WP registration, serialize, CSS parse, evidence, scaffold, IO) | in-process `performance.now()` phase marks |
| **Subprocess + network** | chromium launch, Playground CLI boot, and all in-browser/in-CLI network (s.w.org scripts, fonts, WP download, `networkidle` waits) | phase marks around spawns + Playwright request capture |

Accuracy rules:
- **In-process** durations use `performance.now()` (monotonic). **Cross-process**
  ordering (agent ↔ server ↔ subprocess) uses wall-clock (`Date.now`/epoch ns)
  stamped at each boundary; never subtract a monotonic clock from a wall clock.
- Tool wall-clock seen by the agent = Transport + Tool CPU + Subprocess/network.
  Capturing all three independently lets us check they sum to the agent-observed
  tool duration (no gaps, no double-count).

## Confirmed hotspots to target (so the profiler has real subjects)

Grounded in the current code, not hypotheticals:

- **Editor preview = 47 remote scripts** from `s.w.org` (`wordpressBrowserScripts()`)
  + 4 `s.w.org` CSS `@import`s + Google Fonts, re-fetched on **every** editor
  capture. With `waitUntil: 'networkidle'`, each editor screenshot blocks on all
  of them settling. Repair loops take many editor captures × pages × viewports.
- **Browser launched per call.** `screenshot_html`, `compare_html`, and
  `measure_layout` each `chromium.launch()` + `close()` themselves
  (`tools/lib/capture.mjs`, `tools/mcp-server.mjs`). No pooling.
- **`networkidle` everywhere.** Every capture (rendered too — Google Fonts)
  waits for network idle, making screenshot latency network-bound on the tail.
- **Core-block registration** (`registerWordPressCoreBlocks` + jsdom) costs
  ~1.7s and is cached per process — free in a persistent session, paid on every
  `mcp-call.sh` invocation.
- **Playground**: WP build download (first run) + server boot + import wait
  dominate the first blocks-to-theme gate; later runs hit cache.
- **fetch_theme_fonts**: css2 fetch + N woff2 downloads, once.

## Instrumentation, by layer

### P0 — Tool CPU + phase timing (always-on, ~0 overhead)

- Add `tools/lib/profile.mjs`: `start(label)`, `end(label)`, `span(label, fn)`
  built on `performance.now()`, plus a per-run collector that nests spans and
  serializes to JSON. Gated by `WBDC_PROFILE` (default on for a lightweight
  top-level record, full nesting when `=deep`).
- Wrap the dispatch in `mcp-server.mjs handleMessage`/`tools/call`: record
  `{ tool, tStartEpoch, durMs, argBytes, resultBytes }` and append to
  `reports/profile/tools.jsonl`. **Write profiling to stderr/files only** —
  stdout carries the Content-Length MCP stream and must not be polluted.
- Add sub-phase spans inside the heavy handlers:
  - `wp-serialize`: `registerCore`, `registerCustom`, `serialize.clean`,
    `serialize.shimmed`.
  - `capture.mjs`: `browser.launch`, per-target `navigate`, `wait.networkidle`,
    `screenshot`, and `comparePngs`/`pixelmatch`.
  - `playground.mjs`: `cli.spawn`, `wait.server`, `wait.import`, per-page
    `capture.mockup`, `capture.wp`, `compare`, `editorValidation`.
  - `evidence`/`scaffold`/`validate`/`fonts`: top-level span only (verify they
    are cheap before investing further).

### P1 — Network waterfall (opt-in, heavier)

- Behind `WBDC_PROFILE_NET=1`, in `capture.mjs` record a HAR per context
  (`browser.newContext({ recordHar: { path, content: 'omit' } })`) OR attach
  `page.on('requestfinished'/'requestfailed')` and read `response.request().timing()`
  + `encodedBodySize` + `fromCache`.
- Aggregate per host: `s.w.org`, `fonts.googleapis.com`, `fonts.gstatic.com`,
  `127.0.0.1` (Playground), `file`/local. Report count, bytes, total transfer
  ms, cache-hit ratio, and the slowest single request that gated `networkidle`.
- This directly quantifies the 47-script editor tax and whether `networkidle`
  waits are network-bound or settle instantly (cache).

### P2 — Subprocess + cold/warm

- Time `chromium.launch()` and **count launches per run** (surfaces the
  relaunch-per-call cost; a future browser pool would show here).
- In `playground.mjs`, separate `cli.spawn → server-ready` (includes WP
  download on cold) from `server-ready → import-done`. Detect cold vs warm by
  download bytes / a marker in the CLI logs, and tag the run.

### P3 — Agent step (the loop)

- **Transcript-derived (primary, accurate, post-hoc):** parse the session's
  `agent-*.jsonl` / transcript for `tool_use` and `tool_result` events with
  timestamps. Compute, per step: `agent_think = next(tool_use).ts −
  tool_result.ts` and `tool_wall = tool_result.ts − tool_use.ts`. Reconcile
  `tool_wall` against P0's server-side `durMs` + transport to isolate transport
  overhead (and, in driver mode, `node` spawn cost).
- **Driver-mode note:** under `mcp-call.sh`, "agent step" is the gap between my
  tool calls and each call pays a fresh `node` spawn + core registration +
  browser launch — profile this mode separately; it overstates tool cost vs a
  persistent server.

## The harness + report

- `tools/profile/run-profile.mjs`: drives a fixed fixture (one single-page and
  one multi-page workspace) through a scripted tool sequence with
  `WBDC_PROFILE=deep WBDC_PROFILE_NET=1`, in both `--mode interactive`
  (one persistent server process) and `--mode batch` (mcp-call.sh per call),
  cold and warm. Emits:
  - `reports/profile/summary.json`: total wall split across the four layers;
    top-N tools by total + p50/p95; top-N network hosts by bytes + time;
    launch/boot counts; cold/warm/mode tags.
  - `reports/profile/trace.speedscope.json`: nested spans exported in
    [speedscope](https://www.speedscope.app/) format for visual flamegraph
    drill-down.
  - A short markdown digest for the console.
- Keep a committed fixture + a `make profile` (or npm script) so numbers are
  reproducible and diffable. Optionally track per-tool p50 over time to flag
  regressions (separate from gstack `/benchmark`, which measures web pages).

## Phased rollout

1. **P0** `profile.mjs` + dispatch wrapper + serialize/capture/playground spans
   → first real agent-vs-tool-vs-subprocess split. Lowest effort, highest signal.
2. **P1** network HAR/aggregation → quantify the editor-script and font tax.
3. **P2** subprocess + cold/warm tagging → size the Playground and launch costs.
4. **P3** transcript parser for agent-step → close the loop on total wall-clock.
5. **Harness + speedscope export + fixture** → repeatable, visual, diffable.

## Hypotheses the profiler should confirm or kill

- The editor preview's 47 remote scripts + fonts dominate editor-capture
  latency; **vendoring/caching them locally** (or a warm CDN/service worker)
  would cut it sharply.
- **Browser pooling** (one chromium per run instead of per call) and a
  **persistent server** remove most repeated launch + registration cost in batch
  mode.
- `waitUntil: 'networkidle'` is the tail; once assets are local, switching to
  `domcontentloaded` + explicit font-ready waits cuts capture time.
- In interactive runs, **agent reasoning** is the largest single bucket; in
  headless/batch runs, **tools** dominate — so optimization priorities differ by
  mode, which is exactly why the split must be measured, not assumed.
