# Transform POC

Contained proof of concept for the design-transfer loop.

This is intentionally separate from the production implementation. It is a learning artifact that proves the shape of the transform:

```text
prompt
  -> LLM-style HTML/CSS mockup
  -> deterministic analysis
  -> LLM-style block implementation plan
  -> core/custom block tree
  -> WordPress package serialization/render
  -> rendered HTML output for comparison
```

Run it from the repo root:

```bash
npm run poc:transform
```

It writes deterministic output under `poc/transform-poc/output/`.

## What This POC Proves

- The HTML mockup can be the source of truth.
- The plan can be core-first while still escalating to custom blocks for a marquee and a structured inquiry form.
- A block tree can mix styled core blocks and custom static blocks.
- `@wordpress/blocks` can serialize registered static blocks into block markup.
- The serialized block output can be rendered into `rendered/rendered-blocks.html` for visual comparison against the original mockup.

## Theme JSON Is Deliberately Omitted

This POC keeps styling as page CSS plus custom-block scoped CSS. That is intentional. `theme.json` should come after several pages have good block styling, so shared palette, spacing, typography, layout, and block variation decisions can be inferred from repeated successful transforms instead of guessed upfront.

## POC Limitation

The script registers a minimal subset of core block save implementations directly with `@wordpress/blocks` instead of loading the full browser-oriented `@wordpress/block-library` package. The production renderer should move this into a browser/jsdom-backed package renderer so it can use fuller WordPress package behavior.

The first POC run exposed a useful transform lesson: custom-block bridge CSS can accidentally override responsive rules from the original mockup because it is appended later. Vision/screenshot comparison should catch this class of drift immediately, especially desktop/mobile layout differences. The inquiry block now renders a `wp-block-columns`/`wp-block-column` structure internally so the custom block can keep a purpose-built editor model while leaning on WordPress column semantics for layout.
