# Playground Gate: Verifying the Theme in Real WordPress

`playground_render` is the final gate: the theme, both plugins, and the
imported pages running in an actual WordPress (via `@wp-playground/cli`),
screenshotted and diffed against the mockups. Read this before running it the
first time.

## What the Blueprint Does

The tool writes `reports/playground/blueprint.json` and boots a Playground
server with the theme and plugin directories mounted into
`wp-content`. The blueprint steps:

1. `activatePlugin` for `<slug>-blocks` (when custom blocks exist).
2. `activatePlugin` for `<slug>-content`.
3. `activateTheme` for the theme.
4. `runPHP` calling `<prefix>_import_pages()` — the SAME function the content
   plugin's admin "Import pages" button calls. The gate therefore exercises
   the exact import path a real user gets, including `{{THEME_URI}}`
   resolution and the front-page option wiring.

## How Pages Are Captured

- Logged-out (no admin bar, no logged-in CSS) — a fresh browser context per
  shot.
- At `/?pagename=<slug>` for regular pages and `/` for the front page. The
  query-var form deliberately avoids pretty permalinks, so the gate has no
  rewrite-flush dependency.
- Both sides of every diff go through the SAME capture path html-to-blocks
  uses (`tools/lib/capture.mjs`): the mockup is screenshotted through the
  static file server, the WordPress page through the Playground URL, with the
  same viewports, motion-freeze CSS, and PNG comparison. A mismatch is a real
  visual difference, not a pipeline artifact.

## Expected New Interference

The html-to-blocks previews loaded only your workspace CSS. Real WordPress
adds stylesheets the preview never had, so expect NEW drift on the first run:

- **block-library CSS** — core block defaults (margins on paragraphs/headings,
  button/`navigation` styling, image figure spacing).
- **global-styles preset CSS** — the CSS WordPress generates from your own
  theme.json (preset variables, root padding, element styles) can cascade
  differently than the workspace stylesheet did.
- **layout supports** — `is-layout-constrained`/`is-layout-flow` rules add
  content-width centering and block-gap margins.

### The layout cascade (why full-width sections render narrow)

WordPress constrains every child of a constrained-layout container to
theme.json's `settings.layout.contentSize`, through the rule
`.is-layout-constrained > *:not(.alignwide):not(.alignfull)`. The
html-to-blocks previews never loaded that rule, so a section that filled the
width on workspace CSS alone can render with gutters here — a hero meant to be
edge-to-edge showing ~1248px at a 1280px viewport. `width: 100%` in style.css
cannot beat that selector; the block carries its own width through `align`:

- **Full-bleed band, centered inner content** (hero, banner, CTA): the group
  has `align: full` with `layout` type `constrained`.
- **Full-bleed band, edge-to-edge inner content** (galleries): outer AND inner
  groups have `align: full` with `layout` type `default`.
- **Normal reading content**: no `align` at all.

Confirm the first section's computed width equals the viewport before assuming
a CSS fix — if it does not, the cause is the block's `align`/`layout` (or root
padding / `useRootPaddingAwareAlignments` in theme.json), not a missing rule in
style.css.

Vertical rhythm is owned by the same layer:
`:where(.is-layout-flow) > * + *` adds
`margin-block-start: var(--wp--style--block-gap)` between stacked blocks. Set
section spacing through theme.json `styles.spacing.blockGap` or per-block
spacing attributes, not margins in style.css that fight it.

### Where to fix what

- Token-level or element-level drift (wrong color/size/spacing resolved from a
  preset, heading/link styles) → fix **theme.json**.
- Width or block-gap drift from the layout rules above (a section narrower than
  its mockup, unexpected gaps between stacked blocks) → the block's own
  `align`/`layout` and spacing attributes carry width and gap, or theme.json
  `contentSize`/`blockGap` do. Setting a correct `align: full`/`layout` on a
  block is a block-attribute fix, not a CSS one — `width`/`margin` overrides in
  style.css lose to the cascade. Prefer to set it in the stage-1 block tree and
  re-serialize so the source of truth stays consistent.
- Structural shims (killing an unwanted core margin, overriding a layout rule
  for a specific class) → fix **theme `style.css`** (with a lift-ledger
  category, usually it is genuinely unliftable).
- **Never the content payload to absorb WordPress's CSS.** Editing imported
  page markup so it soaks up a core stylesheet dodges the diff instead of
  fixing the theme — the next page created in the editor would look wrong. This
  is different from setting a block's own `align`/`layout`/spacing attribute
  (the width fix above): that expresses real design intent and is best done in
  the stage-1 tree. Free-form payload edits are otherwise only legitimate when
  the payload itself is wrong (bad media path, missed permalink rewrite), which
  the validator should already have caught.

## Operational Notes

- The first run downloads the WordPress build — it needs network and takes
  noticeably longer. Subsequent runs use the cache. Use a generous timeout.
- On failure the error includes the tail of the Playground logs; read it
  before assuming a visual problem (plugin activation and import errors
  surface there).

## Reading the Report and the Stopping Rule

`reports/theme-comparison.json` contains per-page `results` (per viewport:
`mismatchPercent`, `heightDelta`, screenshot/diff paths under
`reports/playground/`), per-page `aggregate` + `passed`, and run-level
`aggregates` + `passed`. Thresholds are the standard ones:
`maxMismatchPercent <= 1`, `maxHeightDelta <= 8`.

The repair loop's stopping rule is the same as html-to-blocks: passing
thresholds is the ONLY successful end state. Inspect the `-diff-*.png` images
even for passing pages (numbers can hide localized but meaningful drift), fix
the worst page first, re-run `validate_block_theme` after any re-scaffold,
then re-run `playground_render`. Do not stop at "close" or "structurally
right"; if the thresholds cannot be met, report the run blocked with the
metrics and the blocking cause.

## Editor Validation Pass

After the frontend captures, the gate runs block validation **headlessly** — it
no longer boots the wp-admin block editor per page (that was ~66s/page and
dominated the stage). Instead it reads each page's stored `post_content` back
from the already-booted WordPress (the gate mu-plugin's `dump` endpoint) and
runs the same `@wordpress/blocks` `parse()` the editor runs, in Node. A block
whose `isValid === false` is a validation failure. Because the content is read
*after* WordPress stored it, this still catches the drift a plain Node round
trip cannot (kses `--` escaping in style attributes, content-filter mangling of
empty inline elements, unslashed comment-JSON escapes). The run fails on ANY
failure; per-page counts land in `reports/theme-comparison.json` under
`editorValidation`. A page missing from the dump (failed import, or a
WordPress-sanitized `post_name` that no longer matches the manifest slug) is
itself a failure, not a silent pass.

Two fidelity notes:

- Custom blocks are validated against the **mounted** copy
  (`theme-plugin/<slug>-blocks/blocks`), the same one Playground renders, using
  the `createBlockEditorShim` `save()` approximation. Core blocks validate
  against real `save()`; custom-block fidelity is bounded by that shim (the same
  dependency stage-1 serialization already carries). If you suspect a shim/real
  divergence on a custom block, spot-check that one page in a real editor.
- The headless validator uses the npm `@wordpress/*` packages; the WordPress
  version Playground boots is pinned (`--wp`) so the two stay aligned.

## Warm Server and Incremental Re-Checks

The gate keeps **one** WordPress warm across a repair loop instead of
cold-booting every call. The first `playground_render` boots it; subsequent
calls reuse it and do only the cheapest re-check the change warrants: a
theme.json/style.css edit flushes the global-styles cache and re-screenshots; a
content/block-tree edit reimports and re-validates; a plugin-code edit (blocks
plugin or content-model plugin) forces a cold reboot. So the second and later
iterations of a repair loop are seconds, not minutes. The warm server is reaped
after idle and on server shutdown; call `playground_stop` (workspaceRoot + slug)
to release it explicitly.
