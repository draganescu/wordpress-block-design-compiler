# Visual Repair Loop

The comparison tool measures screenshots. The agent decides what to fix.

Loop:

1. Run `serialize_wordpress_blocks`.
2. Run `create_block_editor_preview` when a block tree or page-specific tree needs a refreshed editor instance.
3. Run `compare_html`.
4. When it fails, run `measure_layout` FIRST (see "Measurement-first repair" below), then inspect screenshots/diffs to confirm.
5. Write the page's repair-tasks file.
6. Fix tasks as code changes.
7. Repeat until both rendered and editor thresholds pass on every page.

For multi-file generations, keep editor inspection reusable. Each page tree should have a stable JSON path and a generated editor preview path. Do not hand-code one-off editor shells for each page.

## Measurement-first repair

Pixel diffs localize ("something is red near the footer"); DOM measurements identify ("the footer h4 lost its 14px margin"). The fast loop is:

1. `measure_layout` mockup vs rendered (default selector = sections + footer) at both viewports. Find the first row where `deltaTop` starts accumulating — the divergence lives between that row and the previous one.
2. Re-run with a narrower selector (`".section-x > *"`, then `".component > div > *"`) until the drift names one element.
3. If geometry matches but pixels still differ, probe computed styles on the suspect element (font-size, line-height, letter-spacing, white-space, margins) and compare line rects — a 1px baseline offset or a different line count at equal heights is invisible in geometry tables but obvious in computed styles.
4. Repeat against the editor (`candidateKind: "editor"`); it applies the same comparison CSS the screenshot uses, so what it measures is what the diff sees.

A uniform `deltaTop` on every row below some point is ONE bug at that point, not many. Fix the first divergence and re-measure before touching anything below it.

## Editor canvas environment

The editor preview demotes all WordPress editor CSS into a cascade layer, so unlayered workspace CSS wins at any specificity — the canvas inherits your document rhythm exactly like the frontend does, and no margin/line-height restatement section is needed. What can still legitimately differ, and how to handle it:

- Sticky elements engage their offset inside the editor scroll context at scroll 0 and render displaced in screenshots. Add an editor-scoped override: `.your-bar.block-editor-block-list__block { position: static; }`.
- Disabled form controls in `edit()` must keep frontend colors: `input:disabled { opacity: 1; -webkit-text-fill-color: <frontend color>; }` in the block CSS.
- RichText-editable `<button>` elements keep UA `line-height: normal` like real buttons; do not let an inherited line-height stretch them.
- Editor wrappers (`.block-editor-block-list__block`) ARE the block elements for apiVersion 3 blocks; selectors composed as `tag.block-editor-block-list__block.your-class` are the standard way to write editor-only overrides next to their base rules.
- The cascade-layer demotion does NOT beat editor inline styles. RichText sets `white-space: pre-wrap; min-width: 1px` as inline styles on editable elements, so text the mockup lets overflow on one line can letter-wrap in the canvas; only `!important` author rules win against inline styles (e.g. `white-space: nowrap !important` on oversized display words). Unlayered CSS beats editor *stylesheets*; `!important` beats editor *inline styles*.

Stopping rule:

- Passing thresholds is the only successful end state.
- Do not stop because the result is visually close, structurally close, or because further CSS tweaks feel like overfitting.
- If a repair improves one surface and regresses another, revert that repair and choose another task.
- If repeated concrete repairs cannot reduce the metrics, mark the run blocked and name the blocker. Do not call it done.

Default thresholds:

- `maxMismatchPercent <= 1`
- `maxHeightDelta <= 8`

Completion criteria:

- Each page's comparison report (`reports/comparison.json` for index, `reports/<page>.comparison.json` for other pages) must include `aggregates.rendered` and `aggregates.editor`.
- `aggregates.rendered.maxMismatchPercent` and `aggregates.editor.maxMismatchPercent` must both be at or below `maxMismatchPercent` on every page.
- `aggregates.rendered.maxHeightDelta` and `aggregates.editor.maxHeightDelta` must both be at or below `maxHeightDelta` on every page.
- Do not declare success when the saved frontend passes but the editable editor canvas remains visually divergent, and do not declare a multi-page run done while any page fails.

Task format:

```markdown
- [ ] Priority: high
  Area: header
  Issue: Source has a visible "Book a booth" pill; rendered hides it on desktop after pass 1.
  Cause: Repair CSS hides the third header button group at desktop/mobile breakpoints.
  Fix: Remove the hiding rule, restore `.site-header` three-zone grid/flex layout, and style the third button as the yellow booking pill.
  Verify: Desktop rendered screenshot shows the booking pill; mobile behavior matches source.
```

Repair order:

1. Missing, duplicated, escaped, or wrong content.
2. Semantic failures: fake forms, missing links, wrong buttons, lost labels.
3. Macro layout: section order, hero geometry, major grids, asymmetry.
4. Responsive structure: columns, button rows, wrapping, mobile order.
5. Editor-surface drift: `edit()` wrapper tree, RichText tags/classes, disabled form geometry, editor-only helper markup, and editor-specific CSS.
6. Component scale: marquee, cards, forms, buttons, media objects.
7. Fine polish: spacing, color, typography, shadows, borders.

Surface-specific repair decisions:

- If rendered and editor both fail in the same area, fix the shared block tree, custom block data model, shared CSS, or custom block structure first.
- If rendered passes but editor fails, fix custom block `edit()` output, editor-only classes, or block-owned editor CSS. Do not change `save()` or frontend CSS unless the shared structure is actually wrong.
- If editor passes but rendered fails, fix `save()` output, support attributes, or frontend scoped CSS without adding editor-only differences.
- If core block editor output adds unavoidable editor wrappers, ignore those wrappers only through comparison CSS; do not use that as permission for block-owned markup to diverge.
- If WordPress editor wrappers, RichText intrinsic sizing, placeholders, inserters, selection UI, or block chrome change the layout, normalize the editor preview or add editor-scoped CSS that restores the saved block geometry while keeping fields editable.
- Do not convert a core section to a custom section block solely to improve editor screenshot parity.

Rules:

- Before final response, read `reports/comparison.json`; quote `aggregates.rendered` and `aggregates.editor`.
- If either aggregate exceeds threshold, continue the repair loop or explicitly report blocked.
- Do not accept a lower pixel score if obvious source elements are missing.
- Do not hide a source-visible element to improve the diff.
- If a repair causes regression, revert that repair and choose a different strategy.
- If CSS repairs are fighting prior CSS, replace the repair stylesheet instead of stacking patches.
- Use block-tree changes when the issue is missing content, wrong order, wrong block choice, broken editability, or semantic markup.
- Use CSS when structure and content are correct but visual mapping is off.
- Treat editor-surface diffs as first-class failures when the saved frontend looks right but the block `edit()` output, editable text, wrapper classes, or editor-only CSS drift from the mockup.
- Keep `edit()` and `save()` visually paired. A good repair often extracts a shared render helper or mirrors the same element tree with `RichText` replacing static text.
