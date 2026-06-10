# Repair Tasks

Mockup: `/plugins/wordpress-block-design-compiler/examples/test-run-maison-clouet/mockup/index.html`
Rendered: `/plugins/wordpress-block-design-compiler/examples/test-run-maison-clouet/rendered/rendered-blocks.html`
Editor: `/plugins/wordpress-block-design-compiler/examples/test-run-maison-clouet/editor/block-editor.html`

## Iteration Summary

- Pass 1: rendered `15.84%` max mismatch, `79px` max height delta. Main failure was rendered mobile width drift from clipping the flatlay overflow plus a footer content-model mismatch.
- Pass 2/final: rendered `13.88%` max mismatch, `59px` max height delta; editor `7.84%` max mismatch, `60px` max height delta.
- Kept: data-only `wordpress/block-tree.json`, WordPress package serialization, no `core/html`, no `htmlLines`, no copied mockup stylesheet.
- Fixed in this run: editor comparison no longer gets constrained by WordPress max-width wrappers; rendered/editor preview inherits generated site background; footer now matches the mockup's three-part content; mobile scroll width now matches the mockup.

## Remaining Concrete Repairs

- [ ] **Visit section vertical rhythm**
  - Surface: rendered and editor, desktop/mobile.
  - Visible issue: the storefront/story area is close but the copy block sits with slightly different vertical rhythm; the page ends `34px` short on desktop and `59-60px` short on mobile.
  - Target: `wordpress/blocks/maison-visit/style.css`, `wordpress/blocks/maison-footer/style.css`, and the root support padding in `wordpress/block-tree.json`.
  - Cause: the transform uses support padding plus scoped block CSS; browser text wrapping in the visit copy changes the downstream cumulative height.
  - Exact fix: tune the visit copy body/max-width and section gap first; only adjust footer padding after rendered and editor move together.
  - Verify: desktop and mobile height deltas are `<= 8px` without adding editor-only padding.

- [ ] **Text rendering offset polish**
  - Surface: rendered/frontend desktop and mobile.
  - Visible issue: most diff pixels are one-to-two-pixel text and ornament offsets across headings, cards, and flatlay shapes, not missing content.
  - Target: heading line-height/font-size declarations in `maison-hero`, `maison-arrivals`, `maison-scent-story`, `maison-journal-row`, and `maison-newsletter`.
  - Cause: root support styles add WordPress classes/inline styles around custom blocks; the saved DOM uses custom class names rather than exact mockup class names, so line boxes are visually close but not identical.
  - Exact fix: compare individual section bounding boxes, then tune one section at a time from top to bottom. Avoid changing shared typography tokens globally unless every section improves.
  - Verify: rendered desktop mismatch drops below `5%` before attempting sub-`1%` fine polish.

- [ ] **Editor canvas residual drift**
  - Surface: editor preview, especially mobile.
  - Visible issue: editor screenshot mostly matches rendered output, but mobile height is `60px` taller than the mockup and `~119px` taller when footer padding is overfit.
  - Target: `tools/mcp-server.mjs` editor comparison CSS and each block `edit()` root output.
  - Cause: WordPress editor wrappers still contribute small vertical differences even after max-width/padding normalization.
  - Exact fix: add comparison-only CSS that removes residual editor wrapper min-height/margins without changing block internals; confirm `edit()` and `save()` tags/classes remain identical.
  - Verify: editor aggregate tracks rendered aggregate within `<= 10px` height delta after each repair.
