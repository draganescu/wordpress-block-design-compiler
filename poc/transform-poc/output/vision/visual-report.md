# Vision Comparison Report

## Summary

Final pass: 3

| Pass | Viewport | Size | Pixel mismatch | Width / height delta | Diff |
| ---: | --- | ---: | ---: | ---: | --- |
| 0 | desktop | 1440x1200 | 43.43% | 0px / 1033px | `vision/pass-0/diff-desktop.png` |
| 0 | mobile | 390x1200 | 34.61% | 0px / 333px | `vision/pass-0/diff-mobile.png` |
| 1 | desktop | 1440x1200 | 30.4% | 0px / 211px | `vision/pass-1/diff-desktop.png` |
| 1 | mobile | 390x1200 | 35.42% | 0px / 273px | `vision/pass-1/diff-mobile.png` |
| 2 | desktop | 1440x1200 | 26.84% | 0px / 178px | `vision/pass-2/diff-desktop.png` |
| 2 | mobile | 390x1200 | 35.42% | 0px / 204px | `vision/pass-2/diff-mobile.png` |
| 3 | desktop | 1440x1200 | 26.84% | 0px / 178px | `vision/pass-3/diff-desktop.png` |
| 3 | mobile | 390x1200 | 35.42% | 0px / 204px | `vision/pass-3/diff-mobile.png` |

## Repairs

- after pass 0, apply `core-layout-selector-bridges`: The diff shows large structural drift. The block tree uses core wrappers, so selectors from the mockup no longer map cleanly to the rendered block DOM. Real action: Ask the LLM to revise the block plan with explicit core wrapper mapping before adding new custom blocks.
- after pass 1, apply `core-block-spacing-reset`: The first structural repair still leaves block-library wrapper spacing that changes the page height and rhythm. Real action: Ask the LLM to preserve the source spacing model through block supports, spacing attributes, or scoped CSS on the smallest affected wrapper.
- after pass 2, apply `semantic-form-width-lock`: The remaining drift is concentrated around the custom form panel width and block wrapper behavior. Real action: Ask the LLM whether the custom inquiry block should expose a form width control or use a core column width attribute.

## Final Screenshots

- `desktop`: mockup `vision/mockup-desktop.png`, rendered `vision/rendered-desktop.png`, diff `vision/diff-desktop.png`
- `mobile`: mockup `vision/mockup-mobile.png`, rendered `vision/rendered-mobile.png`, diff `vision/diff-mobile.png`

## Observations

- `desktop` (high): Rendered page height still diverges from the mockup. The transform planner should re-check layout primitives, responsive behavior, and spacing before choosing or styling blocks.
- `mobile` (high): Rendered page height still diverges from the mockup. The transform planner should re-check layout primitives, responsive behavior, and spacing before choosing or styling blocks.

## Comparator Notes

- PNG diff is the score and regression gate.
- LLM vision should be the diagnosis and repair planner.
- Full-page screenshots are captured with Playwright.
- Animations and transitions are disabled before capture to reduce noisy marquee diffs.
- Pixelmatch compares the shared cropped area and reports page-size deltas separately.
- This POC uses a deterministic repair proxy for up to 3 repair passes.
