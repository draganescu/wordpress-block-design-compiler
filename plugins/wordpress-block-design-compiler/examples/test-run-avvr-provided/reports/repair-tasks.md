# AVVR Repair Tasks

Last comparison used desktop viewport-only capture because the supplied desktop HTML uses a smooth-scroll container that does not expose full page height to Playwright full-page screenshots. Mobile was captured full-page.

## Current Metrics

- Rendered desktop viewport mismatch: 27.27%.
- Editor desktop viewport mismatch: 26.26%.
- Rendered mobile full-page mismatch: 70.35%.
- Rendered mobile height delta: 1749px.
- Editor mobile full-page mismatch: 80.98%.
- Editor mobile height delta: 2645px.

## Concrete Repairs

1. Desktop hero rhythm:
   - Visible issue: the block render places the hero heading and office image earlier/higher than the supplied mockup, while the source has a separate dark-medium utility strip above the dark rounded hero shell.
   - Target: `wordpress/block-tree.json` hero typography/support values and `wordpress/style.css` `.avvr-topbar`, `.avvr-hero-layout`, `.avvr-hero-copy`, `.avvr-hero-image`.
   - Cause: the source header spans a utility bar plus dark shell; the current core group models it as one dark shell.
   - Fix: split the utility row and brand/nav row into separate core groups, or use support spacing plus CSS to create the top strip without moving the image independently.
   - Verification: desktop viewport mismatch under 10% before fine typography polish.

2. Mobile article section height:
   - Visible issue: the rendered mobile page is about 1749px shorter than the source. The largest compression is the recent-articles stack.
   - Target: `wordpress/block-tree.json` article card composition and `wordpress/style.css` `.avvr-article-card`, `.avvr-tags`, mobile article spacing.
   - Cause: source cards include richer tag/date rows and more vertical rhythm; the current core card composition compresses metadata into one line.
   - Fix: split tags/date into separate editable paragraph/button rows or a small reusable custom card only if core composition cannot preserve both structure and editor parity.
   - Verification: mobile height delta under 500px before detailed visual polish.

3. Editor preview drift:
   - Visible issue: editor screenshots differ more than rendered screenshots, especially mobile.
   - Target: editor harness CSS and generated CSS around `.block-editor-block-list__block`, cover/media-text wrappers, and columns.
   - Cause: core editor wrappers and block-library editor CSS affect spacing around nested blocks.
   - Fix: add editor-scoped normalization for core cover/media-text/columns wrappers while keeping the frontend tree unchanged.
   - Verification: editor desktop mismatch approaches rendered desktop mismatch, then repair mobile.

4. Support usage:
   - Visible issue: the conversion uses core blocks throughout but still relies on a large page stylesheet.
   - Target: `wordpress/block-tree.json`.
   - Cause: first-pass conversion used class-level CSS for most colors/spacing/typography.
   - Fix: move additional repeatable spacing, text color, background color, border, and typography values into core block support attrs where the serializer/editor visibly honor them.
   - Verification: `reports/style-audit.json` shows increased `blocksWithSupportAttrs` without regressing render/editor screenshots.
