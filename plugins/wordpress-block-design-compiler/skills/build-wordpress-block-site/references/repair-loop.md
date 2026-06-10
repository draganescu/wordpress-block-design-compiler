# Visual Repair Loop

The comparison tool measures screenshots. The agent decides what to fix.

Loop:

1. Run `serialize_wordpress_blocks`.
2. Run `compare_html`.
3. Inspect mockup screenshot, rendered screenshot, editor screenshot, and diff for each viewport.
4. Write `reports/repair-tasks.md`.
5. Fix tasks as code changes.
6. Repeat until thresholds pass.

Default thresholds:

- `maxMismatchPercent <= 1`
- `maxHeightDelta <= 8`

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
5. Component scale: marquee, cards, forms, buttons, media objects.
6. Fine polish: spacing, color, typography, shadows, borders.

Rules:

- Do not accept a lower pixel score if obvious source elements are missing.
- Do not hide a source-visible element to improve the diff.
- If a repair causes regression, revert that repair and choose a different strategy.
- If CSS repairs are fighting prior CSS, replace the repair stylesheet instead of stacking patches.
- Use block-tree changes when the issue is missing content, wrong order, wrong block choice, broken editability, or semantic markup.
- Use CSS when structure and content are correct but visual mapping is off.
- Treat editor-surface diffs as first-class failures when the saved frontend looks right but the block `edit()` output, editable text, wrapper classes, or editor-only CSS drift from the mockup.
