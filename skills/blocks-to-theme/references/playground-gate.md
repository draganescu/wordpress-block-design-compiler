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

### Where to fix what

- Token-level or element-level drift (wrong color/size/spacing resolved from a
  preset, heading/link styles) → fix **theme.json**.
- Structural shims (killing an unwanted core margin, overriding a layout rule
  for a specific class) → fix **theme `style.css`** (with a lift-ledger
  category, usually it is genuinely unliftable).
- **Never the content payload.** Editing imported page markup to absorb
  WordPress's CSS dodges the diff instead of fixing the theme — the next page
  created in the editor would look wrong. Payload edits are only legitimate
  when the payload itself is wrong (bad media path, missed permalink rewrite),
  which the validator should already have caught.

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

After the frontend captures, the gate logs into wp-admin and opens every
imported page in the block editor, collecting `Block validation failed`
console messages. The run fails on ANY such message — the editor recomputes
save() in the browser and catches drift no Node-side round trip can see
(kses `--` escaping in style attributes, content-filter mangling of empty
inline elements, unslashed comment-JSON escapes). The per-page counts land in
`reports/theme-comparison.json` under `editorValidation`.
