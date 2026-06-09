# Implementation Iterations

This plan turns `spec.md` into small, testable implementation steps. The default rule for every iteration: ship a runnable command, a fixture, and a validation result.

## Strategy

Build the standalone core first. Agent plugins come later as thin wrappers over stable commands and JSON contracts.

The core bet is design transfer. Telex and WordPress Studio start too close to WordPress block output, which limits visual ambition. This project starts with the thing LLMs already do well: a rich HTML/CSS/JS mockup. Every later stage exists to preserve that design through the WordPress transform while making the result editable in the block editor.

The first credible vertical slice should be:

```text
fixture prompt
  -> mockup bundle
  -> analysis JSON
  -> LLM block implementation plan
  -> LLM-authored core/custom block assembly
  -> parse/serialize validation
  -> preview screenshot
```

Only after that should we add richer fidelity loops, packaging, and agent adapters.

Important architectural boundary: this is not a deterministic HTML-to-Gutenberg converter. The compiler should not attempt to reproduce tools that compile annotated HTML templates into Gutenberg block source. The deterministic layers provide facts, constraints, schemas, validation, previews, and reports. The LLM authors the block strategy, custom blocks, RichText/MediaUpload/InspectorControls/InnerBlocks decisions, and final core plus custom block assembly.

## Iteration 0: Project Skeleton

Goal: create the repo as a real TypeScript/Node package with basic commands and tests.

Build:

- `package.json`;
- TypeScript config;
- test runner;
- lint/format commands;
- `src/` layout;
- `fixtures/` layout;
- `bin` CLI entry;
- core type definitions.

Commands:

```bash
wp-block-compiler --help
wp-block-compiler doctor
npm test
```

Acceptance:

- CLI runs locally.
- Tests pass.
- No model provider is required.
- No WordPress dependency is required.

## Iteration 1: Artifact Contract and Fixture Runner

Goal: lock the file contract before building generation.

Build:

- artifact writer;
- artifact reader;
- fixture prompt loader;
- stage event logger;
- summary report writer;
- `run-fixture` command using canned mockup files.

Commands:

```bash
wp-block-compiler run-fixture fixtures/simple-landing --out artifacts/simple-landing
```

Acceptance:

- Creates the artifact directory structure from `spec.md`.
- Copies or materializes mockup fixture files.
- Writes `reports/summary.md`.
- Emits structured progress events.

## Iteration 2: Mockup Generator V1

Goal: generate a responsive HTML/CSS mockup from a prompt, but do not convert it yet.

Build:

- provider interface for model calls;
- prompt template for open design generation;
- output parser for `index.html`, `style.css`, optional `script.js`;
- browser render check;
- screenshot capture at desktop/mobile.

Commands:

```bash
wp-block-compiler design --prompt "A bold homepage for a jazz bar" --out artifacts/jazz/mockup
wp-block-compiler render-check artifacts/jazz/mockup
```

Acceptance:

- Mockup renders nonblank.
- CSS and HTML parse.
- Desktop and mobile screenshots are saved.
- Design prompt does not constrain output to WordPress blocks.

## Iteration 3: Analyzer V1

Goal: turn the mockup into structured facts.

Build:

- DOM parser;
- CSS parser;
- content inventory;
- media inventory;
- section detector;
- computed layout capture through a browser;
- interaction detector for links, buttons, forms, and scripts.

Commands:

```bash
wp-block-compiler analyze artifacts/jazz/mockup --out artifacts/jazz/analysis
```

Acceptance:

- Writes `analysis/dom.json`, `analysis/css.json`, `analysis/layout.json`, and `analysis/interactions.json`.
- Layout data includes key boxes for each major section at desktop/mobile.
- The analyzer does not call a model for basic parsing.

## Iteration 4: LLM Block Implementation Planner V1

Goal: ask the LLM to plan the WordPress editor model before emitting markup or custom block code.

Build:

- block implementation plan schema;
- planner prompt using mockup and analysis artifacts;
- plan validator;
- explicit strategy labels: `core-assembly`, `custom-block`, `core-html`;
- editable-field contract per section;
- editor-control contract covering RichText, MediaUpload, URL controls, InspectorControls, InnerBlocks, template locks, and content-only editing mode;
- mandatory rationale for every custom/html decision.

Commands:

```bash
wp-block-compiler plan artifacts/jazz --out artifacts/jazz/plan
wp-block-compiler validate-plan artifacts/jazz/plan/block-implementation-plan.json
```

Acceptance:

- Plan validates against schema.
- Every section maps back to a source selector.
- Any `core/html` usage has a specific reason.
- The plan can be reviewed independently of block output.
- The plan tells a later LLM assembly stage what code and block markup to write.

## Iteration 5: LLM Block Assembler V1

Goal: ask the LLM to emit WordPress block markup and any custom block files required by the plan.

Scope:

- core block assembly for simple sections;
- generated custom block source for sections marked `custom-block`;
- no hand-written deterministic HTML-to-block conversion rules beyond validation helpers.

Build:

- assembly prompt using the implementation plan, mockup, and analysis;
- output parser for `wordpress/content.html` and `wordpress/blocks/*`;
- generated `block.json`, `edit.js`, `save.js`, `style.css` when custom blocks are planned;
- validation that planned files were produced;
- block parse/serialize validator using `@wordpress/blocks`;
- HTML block policy validator.

Commands:

```bash
wp-block-compiler assemble artifacts/jazz/plan --out artifacts/jazz/wordpress
wp-block-compiler validate-blocks artifacts/jazz/wordpress/content.html
```

Acceptance:

- Produces `wordpress/content.html`.
- Round-trips through WordPress block parsing and serialization.
- Produces all custom blocks required by the plan.
- Emits no unplanned `core/html` blocks.
- Generated custom block editor code exposes the planned editable fields and controls.

## Iteration 6: Preview Without WordPress V1

Goal: preview generated static block content without a WordPress install.

Build:

- local preview app;
- core block registration;
- block markup parser;
- front-end-like render surface;
- editor-like render surface if feasible in first pass;
- screenshot capture of generated block output.

Commands:

```bash
wp-block-compiler preview artifacts/jazz/wordpress --out artifacts/jazz/preview
```

Acceptance:

- Preview opens from static files or a local dev server.
- Generated block output renders nonblank.
- Preview screenshot is saved.
- Parser failures are visible in `reports/validation.json`.

## Iteration 7: Visual Diff Harness

Goal: compare mockup output against block preview output.

Build:

- screenshot normalizer;
- desktop/mobile pixel diff;
- section-level crop diff;
- threshold config;
- visual report.

Commands:

```bash
wp-block-compiler diff artifacts/jazz --out artifacts/jazz/reports
```

Acceptance:

- Writes `reports/visual-diff.json`.
- Reports total and section-level differences.
- Flags unacceptable drift without blocking inspection of artifacts.

## Iteration 8: HTML Block Policy Gate

Goal: make raw HTML use explicit and testable.

Build:

- `core/html` scanner;
- allowed-vs-actual comparison against conversion plan;
- reason quality checks;
- validation report entries.

Commands:

```bash
wp-block-compiler validate-html-policy artifacts/jazz
```

Acceptance:

- Fails when `core/html` appears without a plan entry.
- Fails when normal editable content is dumped into HTML.
- Passes when a small, justified raw fragment is present.

## Iteration 9: Custom Block Quality V1

Goal: improve LLM-generated custom blocks until they feel hand-authored rather than mechanically derived.

Build:

- richer block-authoring prompt examples;
- generated `README.md` per custom block explaining fields and editor behavior;
- checks for planned RichText/MediaUpload/InspectorControls/InnerBlocks usage;
- custom block registration in preview;
- compile/build checks for generated block files.

Commands:

```bash
wp-block-compiler improve-custom-blocks artifacts/jazz --out artifacts/jazz/wordpress/blocks
wp-block-compiler assemble artifacts/jazz/plan --out artifacts/jazz/wordpress
wp-block-compiler preview artifacts/jazz/wordpress --out artifacts/jazz/preview
```

Acceptance:

- Generated custom blocks register in preview.
- Custom blocks round-trip through parser/serializer.
- Editable fields map to block attributes or inner blocks.
- Editor controls match the implementation plan.

## Iteration 10: Editor Editability Score

Goal: measure whether the result is useful in the editor, not just visually close.

Build:

- editability report;
- text/image/button field coverage;
- raw HTML penalty;
- custom block attribute coverage;
- repeated content coverage.

Commands:

```bash
wp-block-compiler score-editability artifacts/jazz --out artifacts/jazz/reports
```

Acceptance:

- Reports editable vs locked content.
- Flags sections that are pixel-close but not meaningfully editable.
- Gives agents concrete repair targets.

## Iteration 11: Repair Loop V1

Goal: allow one inspectable refinement pass without creating an unbounded agent loop.

Build:

- planner repair prompt;
- diff-aware plan update;
- conversion rerun from revised plan;
- cap of one repair pass by default;
- before/after reports.

Commands:

```bash
wp-block-compiler repair artifacts/jazz --out artifacts/jazz-repaired
```

Acceptance:

- Repair consumes validation and visual-diff reports.
- Writes a new implementation plan and regenerated block output, not silent edits.
- Keeps old and new artifacts available for comparison.

## Iteration 12: WordPress Package Output

Goal: package the result for actual WordPress use.

Build:

- generated plugin wrapper for custom static blocks;
- optional theme/content export mode;
- zip packaging;
- install notes;
- WordPress Playground/Studio validation hook as optional command.

Commands:

```bash
wp-block-compiler package artifacts/jazz --out artifacts/jazz/package
wp-block-compiler validate-wordpress artifacts/jazz/package
```

Acceptance:

- Produces a plugin zip when custom blocks exist.
- Produces pasteable/importable block markup.
- Optional WordPress validation can run when a local WordPress target exists.

## Iteration 13: MCP and CLI Tool Server

Goal: expose the stable core to agents through a tool protocol.

Build:

- MCP server or equivalent tool server;
- schema for `run`, `design`, `plan`, `assemble`, `preview`, `validate`;
- progress event stream;
- artifact path returns.

Commands:

```bash
wp-block-compiler serve-tools
```

Acceptance:

- A generic agent can call the tool server.
- Tool responses do not contain huge inline artifacts by default.
- Artifacts are returned as paths and summaries.

## Iteration 14: Agent Adapters

Goal: wrap the core for specific agents.

Order:

1. Codex plugin.
2. Claude/OpenCode-compatible wrapper.
3. Other wrappers after the contract survives real use.

Build:

- adapter manifests;
- install docs;
- minimal prompt/tool guidance;
- adapter smoke tests.

Acceptance:

- Each adapter delegates to the same core commands.
- No conversion logic lives in adapters.
- Adapter docs explain prerequisites and artifact paths.

## Iteration 15: Eval Matrix

Goal: prevent regressions and compare design/conversion quality over time.

Build:

- fixture prompts;
- expected strategy assertions;
- visual thresholds;
- editability thresholds;
- HTML policy assertions;
- planned-vs-generated custom block checks;
- summary scorecard.

Fixture categories:

- simple brochure landing page;
- image-heavy product page;
- editorial/magazine page;
- restaurant with reservation form;
- portfolio with carousel/slideshow;
- dense SaaS/product page;
- highly stylized creative page.

Commands:

```bash
wp-block-compiler eval fixtures/eval --out artifacts/eval-runs/latest
```

Acceptance:

- Runs without agent interaction.
- Produces a scorecard.
- Makes regressions visible before prompt or converter changes ship.

## Preferred First Vertical Slice

The fastest useful path is iterations 0 through 6, but with narrow scope:

1. Hardcoded fixture mockup.
2. Analyzer V1.
3. Planner V1.
4. LLM block assembler for a simple landing page.
5. Parse/serialize validation.
6. Static preview screenshot.

This proves the architecture before spending time on packaging or agent distribution.

## Early Decisions To Make

- Package manager: npm, pnpm, or bun.
- Runtime baseline: Node version.
- Test runner: Vitest is the likely default.
- Browser automation: Playwright is the likely default.
- CSS parser: pick a structured parser early.
- Block validation: use `@wordpress/blocks` and `@wordpress/block-library`.
- Preview app: Vite is the likely simplest first host.
- Model provider abstraction: define the interface before choosing defaults.

## Risks To Watch

- Block editor preview outside WordPress may diverge from final WordPress rendering.
- Pixel-perfect conversion can fight editor editability.
- Generated CSS can leak globally if custom block styles are not scoped.
- Model-generated plans can overuse custom blocks unless the schema and policy are strict.
- A deterministic converter can creep back into scope; keep conversion intelligence in the LLM and enforcement in validators.
- Raw HTML can creep back in without a hard policy gate.
- Agent adapters can tempt us to put logic outside the core package.
