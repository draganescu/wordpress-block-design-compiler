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
  -> Playwright screenshot comparison at desktop/mobile
```

Run it from the repo root:

```bash
npm run poc:transform
```

In an interactive terminal, the command asks for the design prompt to run. Press enter to use the default Kiln & Kind fixture.

Non-interactive prompt options:

```bash
POC_PROMPT="Create a polished landing page for a neighborhood florist..." npm run poc:transform
npm run poc:transform -- --prompt "Create a polished landing page for a neighborhood florist..."
npm run poc:transform -- --prompt-file ./brief.md
```

It writes deterministic output under `poc/transform-poc/output/`.

The command also writes vision artifacts under `poc/transform-poc/output/vision/`:

- `mockup-desktop.png` and `rendered-desktop.png`
- `mockup-mobile.png` and `rendered-mobile.png`
- `diff-desktop.png` and `diff-mobile.png`
- `visual-report.md` and `visual-report.json`
- `llm-vision-brief.md`

Repair pass HTML snapshots are written under `poc/transform-poc/output/rendered/iterations/`, and the best current result is copied to both `rendered/rendered-blocks.html` and `rendered/rendered-blocks.final.html`.

## What This POC Proves

- The HTML mockup can be the source of truth.
- The plan can be core-first while still escalating to custom blocks for a marquee and a structured inquiry form.
- A block tree can mix styled core blocks and custom static blocks.
- `@wordpress/blocks` can serialize registered static blocks into block markup.
- The serialized block output can be rendered into `rendered/rendered-blocks.html` for visual comparison against the original mockup.
- A Playwright-based vision loop can immediately expose desktop/mobile drift, including responsive layout regressions that are hard to catch from markup alone.

## Theme JSON Is Deliberately Omitted

This POC keeps styling as page CSS plus custom-block scoped CSS. That is intentional. `theme.json` should come after several pages have good block styling, so shared palette, spacing, typography, layout, and block variation decisions can be inferred from repeated successful transforms instead of guessed upfront.

## POC Limitation

The script registers a minimal subset of core block save implementations directly with `@wordpress/blocks` instead of loading the full browser-oriented `@wordpress/block-library` package. The production renderer should move this into a browser/jsdom-backed package renderer so it can use fuller WordPress package behavior.

The first POC run exposed a useful transform lesson: custom-block bridge CSS can accidentally override responsive rules from the original mockup because it is appended later. Vision/screenshot comparison now catches this class of drift immediately, especially desktop/mobile layout differences. The inquiry block renders a `wp-block-columns`/`wp-block-column` structure internally so the custom block can keep a purpose-built editor model while leaning on WordPress column semantics for layout.

## Vision Comparison

The vision loop uses Playwright to render both HTML files in desktop and mobile viewports, disables animations/transitions, saves full-page screenshots, and compares the shared cropped area with Pixelmatch.

The intended production split is hybrid:

- PNG diff is the score, regression signal, and trigger.
- LLM vision is the diagnosis and repair planner.

By default, this POC runs one to three repair passes with a deterministic proxy for the LLM vision call. The proxy applies scoped CSS repairs for known wrapper/layout drift, so the POC remains runnable without API credentials.

To use the brokered LLM vision repair step:

```bash
cp .env.example .env.local
# add OPENAI_API_KEY to .env.local
npm run poc:transform:openai
```

Optional settings:

- `OPENAI_VISION_MODEL`: defaults to `gpt-4.1`.
- `OPENAI_BASE_URL`: defaults to `https://api.openai.com/v1`.
- `OPENAI_API_KEY`: read from the process environment, `.env.local`, `.env`, `poc/transform-poc/.env.local`, or `poc/transform-poc/.env`.
- `POC_VISION_REPAIR_PROVIDER=auto`: uses OpenAI when `OPENAI_API_KEY` is present, otherwise the deterministic proxy.
- `POC_VISION_REPAIR_PROVIDER=off`: measures visual drift without applying repairs.
- `POC_PROMPT`: non-interactive design prompt.
- `POC_PROMPT_FILE`: path to a file containing the design prompt.

The OpenAI mode sends the mockup, rendered screenshot, PNG diff, block plan, block tree, and rendered HTML context to the Responses API. It asks for structured JSON containing an observed discrepancy, likely cause, preferred production repair location, and scoped CSS patch for the current POC. The real implementation should use that diagnosis to decide whether the fix belongs in the block tree, core block attributes/supports, custom block source, or narrow bridge CSS.
