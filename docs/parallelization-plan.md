# Running pipeline stages at once, where we can

Companion to `docs/profiling-plan.md` (that one measures time; this one finds overlap).

**The project:** feed it a web page design, get back a WordPress theme. An AI agent does it by calling small tools — turn the page into blocks, screenshot it, fix the markup, download fonts, build the theme, render it in a throwaway WordPress. Three stages, in order: html-to-blocks → content-modeling → blocks-to-theme.

**The takeaway:** stages mostly run in order, but only one ordering rule is enforced by the tools; the other is a written instruction the agent follows. The slow part is the fix-and-recheck loops, and those are step-by-step. The big win is *not paying setup twice* and *making each recheck cheaper*. Running things side by side is the smaller prize.

## Measured vs. reasoned

One profiler run on a fixed sample (`tools/profile/run-profile.mjs`) drives **only four html-to-blocks tools**: `serialize_wordpress_blocks`, `create_block_editor_preview`, `screenshot_html`, `compare_html`. It never runs the theme builder, font download, stand-in swap, content-model tools, or the throwaway-WordPress render.

- **MEASURED:** the html-to-blocks capture path (those four tools).
- **REASONED** (read from code, not timed): fonts, content-modeling, the theme stage, the throwaway-WordPress render, multi-page scaling.

Every claim below is tagged. Profile before and after every change.

## The order: one hard rule, one soft rule

    html-to-blocks ──(screenshots match)──▶ swap in real data ──▶ blocks-to-theme

Two things keep the stages in order. Only one is enforced by code.

**Hard rule (enforced).** The swap overwrites each `block-tree.json` in place (`hydrate_standins`, `mcp-server.mjs:850`), and the theme builder reads those exact files (`scaffold.mjs:80`). So the theme stage always sees whatever the swap last wrote. No code change can race this without touching both sides. The swap is also reversible — it backs up originals to `wordpress/standin-backup` first (`mcp-server.mjs:845-851`).

**Soft rule (docs only).** "Swap in real content *after* the screenshots match the design" lives only in the skill docs (`content-modeling/SKILL.md:26`, `references/hydration.md:39`, `html-to-blocks/SKILL.md:24`). The swap tool (`hydrateStandinsHandler`, `mcp-server.mjs:834-862`) never reads `comparison.json` or any pass/fail value. Its only enforced check is that stand-in placeholders match the content model's post types and taxonomies (`checkStandins`, `standins.mjs:73-89`). It swaps whether or not the screenshots ever matched. The three sequencing docs agree on the order, but agreement is documentation, not enforcement.

**If you parallelize, guard this yourself.** Nothing stops the agent from swapping against an unverified page. The throwaway-WordPress render later is what catches a bad swap, not the swap tool. (Reasoned from code; the profiler never touches the swap or theme stage.)

## What can overlap

### Across stages (REASONED — none of this is in the profiler)

- **Prefetch fonts early.** The font download reads only the mockup's CSS (`fonts.mjs:28-29`), never the page files, so it can start as soon as the mockup exists. Catch: the theme builder consumes the result — it takes the font list as an argument (`scaffold.mjs:132`) and the validator requires every font file on disk (`validate.mjs:98-102`). So this isn't free-floating; it just moves the download latency earlier. The bound is the download host (Google Fonts), not local CPU.
- **Draft the content model during the fix loop.** The model tools read and write only `content-model/*` (`model.mjs:14-16,45-71`), separate from the page files the fix loop edits, so authoring can run alongside html-to-blocks. But the model is **not** write-once: the swap and its audit (`audit_standins`) check every placeholder against the model's post types and taxonomies (`standins.mjs:73-88`). The model has to cover every placeholder the agent drops into the pages, so it co-evolves with them. Reconcile it against the placeholder inventory before swapping.

### Inside a stage (mostly REASONED)

- **Per-block authoring.** Each custom block writes to its own directory (`mcp-server.mjs:734-752`), no shared files — so generating them is independent. **Caveat:** the moment any block tree is serialized or previewed, *every* block registers together (`ensureBlocksRegistered`, `scaffold.mjs:79`; `mcp-server.mjs:394,408`). One malformed block fails registration for all. Authoring is per-block; downstream steps treat the block set as one unit.
- **Per-page work (UNMEASURED).** The tools take per-page file arguments and read each page on its own (`evidence.mjs:69-76`, `mcp-server.mjs:801-811,762-766`), so on multi-page sites you can build and screenshot each page independently. The structure supports it, but the sample is a single page — this is reasoned, not measured. Add a multi-page sample before claiming the result.
- **Style scan and parts finder already run as separate calls.** Two read-only tools, disjoint outputs (`evidence.mjs`, `parts.mjs`), no merge step — nothing to "split." But both are synchronous CPU on one Node thread, so back-to-back calls can't overlap without worker threads. Treat them as already-separate, not a parallel win. Both read whatever page files are on disk, and the swap rewrites those files — run them on the post-swap pages so they analyze the real dynamic blocks, not placeholders.

### Inside a tool (one real win, two with caveats)

- **`fetch_theme_fonts`: download fonts at once (REASONED).** It fetches one font file at a time (`fonts.mjs:43-61`), each an independent network GET. `Promise.all` over the fetches is a real win, bounded by the Google Fonts host. **Watch out:** the loop also fills a shared counter Map that names the files — compute names first, then download in parallel, or the names race. Never profiled, and it runs once per build, not in the fix loop, so don't credit it with cheapening the loop.
- **`fix_block_markup`: not a "download at once" win (REASONED).** It already loops over files (`mcp-server.mjs:401`), but the work is pure synchronous CPU (`fix-markup.mjs:64-75`) sharing one process-wide block registry and cache (`fix-markup.mjs:21`). `Promise.all` buys nothing on one Node thread, and the shared registry makes naive threading unsafe. Two real levers: hoist the registry load out of the per-file path, and for large file counts use worker threads with per-worker registration. Never profiled.
- **Captures: several tabs on one browser (MEASURED tools, multi-tab UNBUILT).** `compare_html`, `screenshot_html`, and `measure_layout` take one shot at a time, opening and closing a fresh tab per shot (`mcp-server.mjs:1389-1419,1596-1613,1490-1524`; `capture.mjs:270,308`). Within one `compare_html` call the three surfaces — mockup, rendered page, editor view — are independent and could run as parallel tabs. **Catch:** only the editor tab hits the network (the 47 WordPress scripts, below); the other two are local files. The editor tab sets the floor. Parallel tabs help the local shots a lot, the editor shot little, until those scripts are served locally.

### Limits on "at once"

- **One browser per call, no reuse.** Each capture tool launches and closes a browser (`mcp-server.mjs:1384,1485,1591`). MEASURED: the persistent run still did 2 launches (one per browser-using tool), the per-process run did 1. No browser pool exists yet.
- **The shared login is not in html-to-blocks.** The editor screenshot loads a static file with no login (`capture.mjs:283-296`). The only login flow is in the throwaway-WordPress render (`playground.mjs:168`), a stage the profiler never touches. The "shared login" constraint belongs there.
- **One throwaway WordPress per render check (REASONED).** The render tool spins up one server and reuses one browser across all pages (`playground.mjs:81-138`). Never profiled.

## Where the time really goes

Numbers below are from the profiler on the four html-to-blocks tools, in two modes: *persistent* (one long-running server, 4 calls) and *per-process* (fresh server per call). Wall time: 8.8s persistent, 10.0s per-process.

1. **Setup paid every fresh process — and it's block registration, not a "WordPress load."** No WordPress server boots in these four tools. The cost is registering WordPress core blocks under a fake browser (jsdom) in Node (`wp-serialize.mjs:332-341`), guarded to run once per process. MEASURED: `create_block_editor_preview` is 1.2ms persistent (already registered by the prior call) vs 908ms per-process — that 908ms *is* registration paid fresh. `serialize` is ~1.7-2.0s the first time, ~0.8-1.6s after; the code comment calls it "~1.7s cold." Keep one process alive → pay it once. **Biggest amortizable win, and it has nothing to do with overlap.**
   - Two related taxes the old plan folded together wrongly:
     - **Browser launch is small and only some tools pay it.** MEASURED: 2 launches = 325ms persistent, 1 = 184ms per-process — a few percent of wall. `serialize` and `create_block_editor_preview` launch no browser; only the three capture tools do. No single call pays both a browser launch and block registration.
     - **Process spawn and module load is a third per-process cost.** MEASURED: the per-process run carries ~1.9s of unattributed/IO vs ~1.5s persistent; the extra is spawning and importing across fresh processes, separate from registration.
2. **The editor screenshot re-fetches 47 WordPress scripts every time (MEASURED).** The editor preview pulls 47 scripts from `s.w.org` (`mcp-server.mjs:1232-1283`), plus 4 remote CSS imports. MEASURED: `s.w.org` = 102 requests, 2.56 MB, dominating the network in both modes. Serve those files locally to kill the fetch. **Correction:** "drop the wait for the network to settle" is not the win — the navigate waits so the scripts finish loading; the extra wait for editor-ready is already tiny. Local scripts are what makes "wait for ready" cheap. Keep both halves coupled.
3. **The local mockup/rendered captures also wait for the network to settle, pointlessly (MEASURED gap).** Both local-file captures use the same "network settle" wait (`capture.mjs:280`) even though local files make zero network requests. Dropping to a plain page-loaded wait for the local shots is a free win, no fidelity cost — exactly where "drop the settle wait" actually applies.
4. **Network is the cost center, but read the number right (MEASURED).** `s.w.org` dominates the *volume*; its *wall* contribution is ~3.9s of the ~8.8-10s run. The ~18s "cumulative request time" sums requests running at the same time — a cost-center signal, not wall time. Don't add it to navigate time.
5. **Agent thinking (UNMEASURED — this harness can't see it).** In a real run the agent's reasoning between calls is real wall time and code can't parallelize it. The profiler scripts calls back-to-back with no model in the loop, so it reports ~0 thinking by construction. Measuring it needs a different instrument (transcript timing, `tools/profile/transcript.mjs`).

## Order of work (profile each before/after)

1. **Cheap, real:** parallel font downloads (precompute names first); local mockup/rendered captures drop the network-settle wait; multi-tab captures.
2. **Structural, biggest payoff:** keep one process alive to pay block registration once; serve the 47 editor scripts (and 4 CSS imports) locally; build a browser pool so launches head toward one per run.
3. **Spread out (REASONED):** per-page work side by side; prefetch fonts; draft the content model during the fix loop (reconcile against the placeholder inventory before swapping).

## Leave alone

- **Trying several speculative fixes at once in copies** — the cost is agent thinking, not the tool.
- **Splitting the editor check in the throwaway-WordPress render** — one shared login, adds flakiness. (REASONED; never profiled.)
- **Running more than one throwaway WordPress** — startup likely costs more than the screenshots save. (REASONED; never profiled, and the cold-build path can dominate — the part most worth measuring before trusting.)

The style scan and parts finder are *not* a "leave alone" item: they already run as separate calls, nothing to merge. The reason not to thread them is they're synchronous CPU, not a merge-cost tradeoff.

## How we'll know

Profiler harness (`tools/profile/run-profile.mjs`), same input, both modes.

- **Cheap wins:** fewer one-at-a-time steps, lower per-tool time.
- **Structural:** browser launches drop from 2 (persistent) / 1 (per-process) toward one per run once a pool exists; `s.w.org` drops off the top of the network list; per-process registration stops recurring.
- **Spread-out:** add a multi-page sample first, then check that runs stop getting slower per page.

The current harness covers only the four html-to-blocks capture tools. Anything about fonts, the theme stage, the throwaway-WordPress render, or content-modeling needs its own sample before we can claim it moved.

If it doesn't move the numbers, it doesn't ship.
