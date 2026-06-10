# Repair Tasks

Status: blocked/incomplete under the strict skill gate.

Thresholds: `maxMismatchPercent <= 1`, `maxHeightDelta <= 8`.

Current aggregates:

- Rendered frontend: `23.42%` mismatch, `222px` max height delta.
- Editable editor: `21.68%` mismatch, `161px` max height delta.

Block composition guard:

- Keep the current core-first structure. The tree has 76 core blocks and 5 custom block instances.
- Do not replace hero, scent, visit, journal, newsletter wrapper, or footer sections with custom section blocks.
- Fix remaining drift through block support attributes, existing core block classes, custom component internals, editor-scoped CSS, or the editor comparison harness.

## Next Repairs

- [ ] Priority: high
  Surface: rendered frontend and editor preview
  Area: mobile vertical rhythm
  Issue: Mobile rendered height is `222px` shorter than the mockup and drives the worst aggregate.
  Cause: Later sections are compressed after the object grid, especially visit, journal, newsletter, and footer spacing.
  Fix: Compare `visual/mockup-mobile.png` to `visual/rendered-mobile.png`; tune core section padding/min-height and intra-section gaps in `wordpress/block-tree.json` support attrs first, then scoped CSS only where supports cannot express it.
  Verify: Mobile rendered height delta drops below `8px` without changing custom block count.

- [ ] Priority: high
  Surface: rendered frontend
  Area: desktop section scale
  Issue: Desktop saved render is `96px` shorter than the mockup with `11.36%` mismatch.
  Cause: The saved render is visually close but section boundaries and vertical pacing do not land at the same y-positions.
  Fix: Align desktop section starts for arrivals, scent, visit, journal, newsletter, and footer by adjusting core group padding/support spacing. Avoid touching object-card save markup unless card dimensions differ in the diff.
  Verify: Desktop rendered height delta drops below `8px` and mismatch drops before editor-specific fixes.

- [ ] Priority: high
  Surface: editable editor
  Area: editor wrapper parity
  Issue: Editor preview still mismatches at `17.7%` desktop and `21.68%` mobile after root-only padding/min-height harness fixes.
  Cause: Core block editor wrappers, RichText sizing, and empty decorative core group placeholders still differ from saved HTML in some components.
  Fix: Inspect `visual/editor-desktop.png` and `visual/editor-mobile.png`; add editor-scoped CSS only for editor wrapper effects that change layout. Do not change saved markup or convert core sections to custom blocks for editor parity.
  Verify: Editor mismatch moves toward the saved-render mismatch without regressing the rendered frontend.

- [ ] Priority: medium
  Surface: styling contract
  Area: block support usage
  Issue: `reports/style-audit.json` shows 9 of 81 blocks using support attrs (`11.11%`).
  Cause: The run is core-heavy but still keeps much section styling in CSS classes.
  Fix: Move safe block-level spacing, colors, border, dimensions, and layout values from `wordpress/style.css` into `attrs.style`/`attrs.layout` where WordPress supports can represent them exactly.
  Verify: Style audit support usage increases while rendered/editor screenshots do not regress.

Artifacts:

- Mockup desktop/mobile: `visual/mockup-desktop.png`, `visual/mockup-mobile.png`
- Rendered desktop/mobile: `visual/rendered-desktop.png`, `visual/rendered-mobile.png`
- Editor desktop/mobile: `visual/editor-desktop.png`, `visual/editor-mobile.png`
- Diff images: `visual/diff-desktop.png`, `visual/diff-mobile.png`, `visual/diff-editor-desktop.png`, `visual/diff-editor-mobile.png`
