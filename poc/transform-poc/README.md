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
cp .env.example .env.local
# add OPENAI_API_KEY to .env.local
npm run poc:transform
```

In an interactive terminal, the command asks for the user request to run. Press enter to use the default Kiln & Kind request.

`npm run poc:transform` is the real POC path and uses OpenAI for every LLM-shaped stage:

- prompt -> HTML/CSS mockup
- analysis -> block implementation plan
- plan/mockup -> supported WordPress block tree
- screenshots/diffs -> vision repair proposals

Non-interactive prompt options:

```bash
POC_PROMPT="Create a polished landing page for a neighborhood florist..." npm run poc:transform
npm run poc:transform -- --prompt "Create a polished landing page for a neighborhood florist..."
npm run poc:transform -- --prompt-file ./brief.md
npm run poc:transform -- --prompt-file ./brief.md --max-repair-passes=5
npm run poc:transform -- --prompt-file ./brief.md --max-mismatch-percent=4 --max-height-delta=40
```

The prompt file should contain only the user request. The reusable design-generation behavior lives in `poc/transform-poc/system.design.md`, which is loaded as the OpenAI HTML mockup stage instructions.

It writes output under `poc/transform-poc/output/`.

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

Generated custom blocks are contract-based, not disguised HTML blocks. The plan must define typed editable attributes and a semantic save template for each generated custom block. The assembly step strips opaque generated-block attributes such as `html`, `sourceHtml`, `markup`, `innerHTML`, `editableFields`, and `sourceSelector`, then fills the declared attributes from the parsed content inventory where possible.

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
- The repair actuator can update block composition, block attributes/classes, rendered HTML escape hatches, or scoped CSS depending on the diagnosis.

By default, this POC runs up to three repair passes with OpenAI vision repair. PNG diff remains the deterministic score and trigger. Override the limit with `--max-repair-passes=N` or `POC_VISION_MAX_REPAIR_PASSES=N`; use `0` to capture comparison screenshots without applying repair passes.

The visual acceptance gate is also configurable. A pass is accepted only when both values are within the configured thresholds:

- `POC_VISION_MAX_MISMATCH_PERCENT=8`, or `--max-mismatch-percent=8`: maximum allowed Pixelmatch mismatch percentage, using the shared cropped screenshot area. The report aggregates this as the maximum value across desktop and mobile.
- `POC_VISION_MAX_HEIGHT_DELTA=80`, or `--max-height-delta=80`: maximum allowed absolute full-page height difference in pixels between the source mockup and rendered block HTML. The report aggregates this as the maximum value across desktop and mobile.

Lower values make the loop stricter and can trigger more repair passes. Width delta is reported for diagnosis but is not currently part of the acceptance gate.

To run the older local fixture/debug path without API credentials:

```bash
npm run poc:transform:deterministic -- --default-prompt
```

That deterministic path exists only so committed POC artifacts can be regenerated without spending tokens.

Optional settings:

- `OPENAI_TEXT_MODEL`: defaults to `gpt-4.1`.
- `OPENAI_VISION_MODEL`: defaults to `gpt-4.1`.
- `OPENAI_TIMEOUT_MS`: defaults to `300000` milliseconds for each OpenAI Responses API request.
- `OPENAI_BASE_URL`: defaults to `https://api.openai.com/v1`.
- `OPENAI_API_KEY`: read from the process environment, `.env.local`, `.env`, `poc/transform-poc/.env.local`, or `poc/transform-poc/.env`.
- `POC_LLM_PROVIDER=openai`: uses OpenAI for HTML, plan, assembly, and vision unless a stage override is passed.
- `POC_HTML_PROVIDER=openai`: uses OpenAI for the initial HTML/CSS mockup.
- `POC_PLAN_PROVIDER=openai`: uses OpenAI for the block implementation plan.
- `POC_ASSEMBLY_PROVIDER=openai`: uses OpenAI for the supported block tree.
- `POC_VISION_REPAIR_PROVIDER=auto`: uses OpenAI when `OPENAI_API_KEY` is present, otherwise the deterministic proxy.
- `POC_VISION_REPAIR_PROVIDER=off`: measures visual drift without applying repairs.
- `POC_VISION_MAX_REPAIR_PASSES=3`: maximum vision-informed repair passes. CLI aliases: `--max-repair-passes` or `--vision-repair-passes`.
- `POC_VISION_MAX_MISMATCH_PERCENT=8`: maximum accepted Pixelmatch mismatch percentage across compared viewport screenshots. CLI alias: `--max-mismatch-percent`.
- `POC_VISION_MAX_HEIGHT_DELTA=80`: maximum accepted rendered page-height delta in pixels across compared viewports. CLI alias: `--max-height-delta`.
- `POC_PROMPT`: non-interactive user request.
- `POC_PROMPT_FILE`: path to a file containing only the user request.

The POC sends the user request, design system prompt, generated mockup, deterministic analysis, block plan, block tree, rendered screenshot, PNG diff, and rendered HTML context to the Responses API depending on stage. It asks for structured JSON at each LLM stage. The real implementation should use the same stage boundaries but graduate from this POC's supported block subset to generated custom block source and richer WordPress package rendering.
