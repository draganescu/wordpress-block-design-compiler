# Running the pipeline at the same time, where we can

Companion to `docs/profiling-plan.md` (that one measures time; this one finds
overlap).

**The project:** feed it a web page design, get back a WordPress theme. An AI
agent does it by calling small tools — screenshot this, download the fonts,
build the theme, spin up a test WordPress. Three stages, in order:
html-to-blocks → content-modeling → blocks-to-theme.

**The takeaway:** the stages run in order and two checkpoints lock that in, so
you can't run them at once. The slow part is the fix-and-recheck loops, and those
are step-by-step, so you can't split them either. Most of the speedup is *not
paying setup twice* and *making each recheck cheaper* — overlap is the smaller
prize. Profile before and after every change; the notes below are reasoning, not
measurements.

## The two checkpoints that force the order

    html-to-blocks ──(screenshots match)──▶ swap in real data ──▶ blocks-to-theme

- Swapping placeholders for live content waits until the screenshots match the
  design (`hydrate_standins`, `tools/content/standins.mjs`).
- The theme stage reads the swapped-in pages, so it waits for the swap.

These don't go away. Everything below fits inside a stage or in the gaps.

## What can overlap

**Across stages — two clean ones:**
- Download fonts early — fonts only need the mockup CSS, not the pages
  (`fetchThemeFonts`, `tools/theme/fonts.mjs`).
- Write the content model while html-to-blocks is still fixing the page — only
  the swap-in step waits on the screenshot check (`tools/content/model.mjs`).

**Inside a stage — independent steps:**
- Build each custom block on its own; on multi-page sites, build and screenshot
  each page on its own.
- blocks-to-theme: style scan ∥ shared-parts finder; font download ∥ theme build
  (`evidence.mjs`, `parts.mjs`).

**Inside a tool — stop going one at a time:**
- `fetch_theme_fonts`: download fonts all at once.
- `fix_block_markup`: clean files all at once.
- `compare_html` / `screenshot_html` / `measure_layout`: several tabs on one
  browser instead of one shot at a time.

Limits: one browser per call (no reuse), one test-WordPress per render check, one
shared login for the editor check. So "at once" means more tabs, not more
browsers or more WordPress copies.

## Where the time really goes

1. **Setup paid every call.** Fresh process per call = a new browser launch + a
   ~1.7s WordPress load each time. Reuse one browser and keep the program running
   → pay it once. Biggest win, and it isn't about overlap.
2. **Editor screenshots re-fetch 47 WordPress scripts every time** and wait for
   the network to fully settle first. Save those scripts locally, wait only for
   the page to be ready. The fix loop takes many of these, so it adds up.
3. **The agent's own thinking** is a big slice in interactive runs and code can't
   parallelize it. The profiler says how big.

## Order of work (profile each before/after)

1. Easy wins: parallel font downloads, parallel `fix_block_markup`, multi-tab
   screenshots. Cheapens every fix-loop pass.
2. Structural: reuse one browser + keep the program running; save editor scripts
   locally and drop the wait-for-network-to-settle.
3. Spread out: per-page work side by side; start fonts early; write the content
   model during the html-to-blocks fix loop.

## Leave alone

- Splitting the style scan / parts finder — merging the results costs more than
  it saves.
- Trying several fixes at once in copies — the cost is the agent thinking, not
  the tool.
- Splitting the editor check — shared login, adds flakiness.
- Running more than one test-WordPress — startup costs more than the screenshots
  save.

## How we'll know

Profiler harness (`tools/profile/run-profile.mjs`), same input, both modes, cold
and warm. Easy wins → fewer one-at-a-time steps, lower per-tool time. Structural
→ browser launches head toward one per run, the WordPress script host drops off
the top. Spread-out → multi-page runs stop getting slower per page.

If it doesn't move the numbers, it doesn't ship.
