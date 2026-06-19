---
name: blocks-to-theme
description: Use when a user asks to turn the output of an html-to-blocks run (single or multi page) into an installable WordPress block theme. Extracts theme.json from style evidence, infers template parts from cross-page repetition (no header/footer assumptions), plans templates with index plus generic archive/single/404 defaults, bundles fonts and media, generates a blocks plugin and a content import/remove plugin, and verifies the theme in WordPress Playground against the mockups.
---

# Blocks To Theme

Run this skill on a COMPLETED html-to-blocks workspace (its comparison gates
passed). The tools gather evidence and verify; you make the design decisions.

The page trees are expected to contain real dynamic core blocks (navigation,
search, site-title, comments, query-pagination, post fields) and, when a
content-modeling run hydrated them, `core/query` loops — not custom stand-in
blocks. A workspace heavy with custom `site-nav`/`search`/`pagination`/`card`
blocks is an upstream smell: such a tree was built before the core-first rules
and should be fixed in html-to-blocks, not papered over in the theme. If a
`content-model/plugin-manifest.json` exists, `playground_render` mounts,
activates, and seeds that plugin automatically so the hydrated query loops
render real entries in the gate.

## Fast Path — minimum turns

Run on a COMPLETED html-to-blocks workspace. The recipe is linear; the tools
auto-apply the mechanical fixes so you do not round-trip for them.

1. `analyze_theme_evidence` returns a **compact** ranked summary (top colors /
   fonts / spacing + a `reportPath`). Build the token map from that — read
   `reports/theme-evidence.json` only for rule-level (`cssRules`/`supportUsage`)
   detail.
2. `infer_template_parts`, then `fetch_theme_fonts`.
3. `scaffold_block_theme` with your decisions. It now: **defaults `blockGap` to 0**
   when you ship component `customCss` (so WordPress's layout layer does not inflate
   page height — the largest avoidable first-gate drift); **rewrites links to pages
   outside the manifest** to the front page and returns them as `orphanLinks` (a
   single-page subset no longer fatals validate); **folds `wordpress/pages/<page>.css`**
   into the theme stylesheet; **omits the blocks-plugin dependency** for a
   core-only theme; and **reads `wordpress/style.css` as `customCss`** when you omit
   that arg, so the shared design system always ships (do not hand-pass the large
   file inline; pass `customCss: ''` only to deliberately ship no shared CSS).

   The content-model plugin's `plugin.slug` must NOT equal `<theme-slug>-content`
   (the theme's own page-import plugin) — `playground_render` now errors early on
   that collision instead of crashing the boot with an opaque "exited before
   becoming ready". Use e.g. `<theme-slug>-cpts`.
4. `validate_block_theme` → fix until zero errors → `playground_render`. The gate
   loop is bounded; fix the worst page first.

For the full-bleed cascade, set `align: "full"` on banded sections in the stage-1
tree (their background spans the viewport) and re-serialize — width is a block
attribute, not a `style.css` override.

## Required Workflow

1. Run `analyze_theme_evidence`; read `reports/theme-evidence.json`.
2. Run `infer_template_parts`; read `reports/template-parts.json`.
3. Read `references/theme-json-mapping.md`, `references/template-part-inference.md`,
   and `references/template-planning.md`. Write `plan/theme-plan.md` containing:
   the token map (value → preset slug), the lift ledger, the parts decision for
   every evidence group (unify / variant parts / leave in content, with the cited
   group), the template plan, the page manifest (slugs, titles, front page), and
   the media map.
4. Run `fetch_theme_fonts` (read `references/fonts-and-media.md` first).
5. Run `scaffold_block_theme` with the plan's decisions as data.
6. Run `validate_block_theme`; fix and re-scaffold until `errors` is empty.
7. Run `playground_render` (read `references/playground-gate.md` first); repair
   until every page passes both viewports. Expect block-library and global-styles
   CSS interference the preview never had — fix it in theme.json or theme
   style.css, never by editing content payloads to dodge the diff.
8. Final response: quote `reports/theme-validation.json` (`passed`) and
   `reports/theme-comparison.json` aggregates, plus the custom-block count and
   how many stand-ins were hydrated (from `reports/standins-hydration.json` when
   present). A run shipping many custom blocks for core-block work is not clean
   even if the gates pass — say so.

## Hard Gates

### Evidence Gate
No template part without a cited occurrence group from
`reports/template-parts.json`. The standing template set is `index.html` plus
the generic defaults `archive.html`, `single.html`, `404.html` (no evidence
needed — composed from inferred chrome + global styles). Any template beyond
that set needs a cited difference in chrome variants or the front-page
designation. Single-page runs normally produce zero parts.

### Lift-First Gate
Every rule remaining in theme `style.css` or any `styles.blocks[...].css`
carries a reason category in the plan's lift ledger: `media-query`, `pseudo`,
`position`, `blend`, `grid`, `interaction`, or `selector`. A rule with no
category must be lifted into theme.json (presets, root styles, elements, block
styles). `selector` is the narrow escape for rules theme.json structurally
cannot target (arbitrary class compositions like `.hero__copy`); it never
applies to rules on `body`, bare elements, or `.wp-block-*` block roots —
those always lift. Do not solve fidelity by dumping the workspace stylesheet
into the theme.

### Completion Gate
The run is complete only when `validate_block_theme` reports zero errors AND
`reports/theme-comparison.json` shows every page within thresholds
(`maxMismatchPercent <= 1`, `maxHeightDelta <= 8`) at both viewports AND
every page's `editorValidation.failures` is zero (the gate reads each page's
stored content back from the booted WordPress and runs the same
`@wordpress/blocks` validator headlessly — see `references/playground-gate.md`).
Quote both in the final response. The repair loop is **bounded**
(`references/playground-gate.md`): at most 6 gate iterations with a plateau
early-stop. On cap/plateau without passing, report the run blocked with
per-page metrics and the worst remaining drift — do not grind past the cap or
relabel a sub-threshold page "done".

### Timing Gate

If the user asks to time a run, report separate clocks:

- **Agent wall-clock**: elapsed time from the user's request to the final answer,
  including context reads, LLM planning/editing, repair loops, debugging, tests,
  commits, pushes, and failed or blocked attempts.
- **Deterministic tool time**: measured runtime of tools such as
  `analyze_theme_evidence`, `infer_template_parts`, `fetch_theme_fonts`,
  `scaffold_block_theme`, and `validate_block_theme`. This is a sub-stage
  metric, not a transformation time.
- **Playground verification time**: measured runtime of `playground_render`,
  reported separately because WordPress boot/import/screenshot work can dominate
  or block the run.

Never label deterministic `blocks-to-theme` timing from a reused completed
html-to-blocks workspace as "HTML to theme". Call it "static theme scaffold from
existing block trees" and explicitly state that the html-to-blocks agent/LLM
stage was reused, not timed.
