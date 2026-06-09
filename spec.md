# Grounding Spec: Prompt to HTML Design to WordPress Blocks

## Purpose

Build a standalone staged compiler that takes a user prompt, creates a beautiful HTML/CSS/JS mockup, then converts that mockup into WordPress block content with a strong bias toward:

- visual fidelity to the generated mockup;
- editable content in the WordPress block editor;
- explicit, inspectable conversion planning;
- thin distribution wrappers for major coding-agent environments.

This is not another hosted orchestration product, and it is not itself an open-ended agent. The durable product is a local, standalone staged engine with agent-specific adapters around it.

## Rationale

Telex and WordPress Studio both proved that AI can generate real WordPress blocks, themes, plugins, previews, and installable packages. They also exposed the central design problem: direct block generation tends to collapse visual ambition. Even when the model is shown sample HTML, screenshots, or inspiration, the final block result often feels less designed than the source.

The reason for this project is to split the problem at the point where current LLMs are strongest:

1. LLMs are good at creating rich HTML/CSS/JS designs from rough prompts.
2. WordPress blocks are good at durable, editable publishing experiences.
3. The weak step is design transfer: preserving the HTML mockup's layout, rhythm, typography, interaction intent, and visual language while producing editable blocks.

This project treats the HTML mockup as the design source of truth. The deterministic pipeline exists to preserve that design through analysis, planning, validation, preview, visual diffing, and targeted repair. The LLM is used where judgment is required: deciding the editor model, composing core blocks, authoring custom blocks, and choosing the right editable controls.

## Prior Work Context

This effort is informed by two previous approaches.

### Telex

Telex proves that AI-generated WordPress themes, blocks, plugins, previews, artifacts, and install flows can work together. Useful lessons:

- Project state as a structured artifact is valuable.
- Live preview is important for trust and iteration.
- WordPress block parsing and serialization should be used as a validator and normalizer, not left to prompt compliance.
- Generated projects need a clear split between presentation, behavior, and content.
- Creative prompts need their design direction carried into the final emitter, not only into early previews.

The downside to avoid: Telex uses complicated server orchestration, persistent infrastructure, queues, storage, Docker sandboxes, and browser-side Playground coordination. This tool should keep the same rigor without inheriting that operational shape.

### WordPress Studio Site Generation

Studio proves that a local agent can drive WordPress generation with tools, prompts, validations, screenshots, and WordPress Playground/Studio integration. Useful lessons:

- Agentic loops are flexible, but quality and speed suffer when every phase requires another agent turn.
- A deterministic, agent-free eval harness is essential for measuring progress.
- Core block composition can be good; the real gap is deciding when custom blocks are needed and generating them consistently.
- Identifier, token, theme, and block validation should be deterministic contracts.
- HTML block usage needs policy and validation. It should be intentional, not a fallback for weak conversion.
- Pixel and editor validation need to be first-class gates.

The downside to avoid: Studio's generator is still shaped as a sequence of tools inside an agent workflow. This tool should expose a direct pipeline that agents can call, inspect, and resume.

## Product Thesis

The tool should separate creative design from WordPress conversion.

1. The design phase should be open, expressive, and guided. It should let the model produce an excellent modern HTML/CSS/JS design without prematurely constraining itself to core WordPress blocks.
2. The conversion phase should be disciplined. It should deeply inspect the HTML, CSS, layout, assets, and interactions before planning a block tree.
3. The output should use the right mix of LLM-authored core block assembly, LLM-authored custom blocks, and rare core/html blocks.
4. Every non-core choice should be justified in a conversion plan.
5. The tool should preview block output without requiring a full WordPress install whenever possible.

The point is not to build a generic deterministic HTML-to-Gutenberg compiler. Existing tools such as `html-to-gutenberg` compile specially annotated HTML templates into Gutenberg block source. This project should do something different: use the LLM to understand an LLM-designed mockup, decide the editor model, author the custom block code, choose RichText/MediaUpload/InnerBlocks/InspectorControls patterns, and assemble core plus custom blocks into a result that preserves both visual design and editor usefulness.

## Non-Goals

- Do not require a hosted backend for the default workflow.
- Do not depend on one agent vendor.
- Do not go straight from prompt to block markup.
- Do not reimplement an attribute/template-based HTML-to-Gutenberg compiler.
- Do not treat `core/html` as the easy answer for fidelity.
- Do not generate classic themes as the primary output.
- Do not require WordPress just to inspect a static block tree preview.

## Distribution Model

The core package must be agent-agnostic. Agent integrations are wrappers.

### Core

The core engine should expose:

- a CLI;
- a programmatic Node API;
- a stable JSON input/output contract;
- optional MCP/tool-server surface for agents that support tools;
- fixture-driven tests and evaluation harnesses.

### Agent Adapters

Adapters should be thin and replaceable:

- Codex plugin;
- Claude Code/Claude Desktop-compatible tool wrapper;
- OpenCode plugin/tool wrapper;
- Pi or other agent wrapper where the tool contract fits;
- plain CLI fallback for agents that can only run shell commands.

Adapters should not contain conversion logic. They should only:

- pass prompt/options/files to the core engine;
- stream progress events;
- expose generated artifacts;
- surface preview links and validation results.

## High-Level Pipeline

### 1. Prompt Intake

Input:

- user prompt;
- optional brand/style references;
- optional existing HTML/CSS/JS;
- optional screenshots or inspiration URLs;
- output target preferences;
- fidelity/editability priorities.

Output:

- normalized design brief;
- constraints;
- generation plan.

The intake stage should preserve user intent but add enough structure for downstream stages: audience, mood, content needs, page type, interaction needs, assets, layout expectations, and WordPress output target.

### 2. HTML/CSS/JS Mockup Generation

The design stage should produce a high-quality responsive mockup bundle:

- `index.html`;
- CSS, preferably extracted into `style.css`;
- JS when needed for interactions;
- asset manifest;
- design notes;
- viewport assumptions.

Design freedom should be broad. The generator can use advanced composition, rich typography, asymmetry, layered sections, scrollable areas, motion, product/media-heavy layouts, and custom interaction patterns.

Guidance should be opinionated about quality but not prematurely WordPress-shaped:

- design the whole page, not just a first fold;
- avoid generic vertical stacks when the prompt calls for stronger identity;
- use concrete content, not vague placeholders;
- make responsive behavior intentional;
- keep JS purposeful and explain what behavior it creates.

### 3. Mockup Analysis

Before planning blocks, the tool must inspect the design.

Analysis should include:

- DOM tree;
- semantic sections;
- text/content inventory;
- media inventory;
- CSS cascade and computed styles;
- layout boxes at target viewports;
- interaction inventory;
- reusable visual patterns;
- accessibility risks;
- unsupported or risky CSS/JS for WordPress;
- likely editable content fields.

This stage should use structured parsers and browser rendering where useful. It should not rely only on model interpretation of raw HTML.

### 4. LLM Block Implementation Plan

The block implementation plan is the central artifact. The tool must plan before emitting block markup or custom block code.

The plan should include:

- normalized design tokens: colors, spacing, typography, radii, shadows, layout primitives;
- target block tree;
- mapping from each mockup section to either core block assembly, custom block implementation, or justified HTML fallback;
- selected implementation strategy for each section;
- core-block attempt notes for each section, including which core blocks and block supports were considered before escalating;
- editability contract for text, images, links, buttons, lists, cards, forms, and repeated items;
- editor UI decisions: RichText fields, MediaUpload fields, URL controls, InspectorControls, InnerBlocks templates, template locks, and content-only editing modes where useful;
- fidelity risks;
- fallback decisions;
- custom block definitions and source-file plan;
- specific reasons for any `core/html` block;
- expected validation checks;
- expected pixel-diff checkpoints.

The plan should be serializable JSON, reviewable by agents, and suitable for deterministic tests.

### 5. LLM Block Strategy

The LLM should choose the least custom implementation that preserves both fidelity and useful editability. Deterministic code should not try to infer every block choice through hard-coded HTML rules; it should provide structured evidence, validate the plan, validate emitted code/markup, and report failures.

The default posture is core-first, but not core-only. The LLM should extensively use and style core blocks before deciding that a custom block is needed. Escalation is justified only when core blocks cannot preserve the layout, visual behavior, or editor model without creating brittle, unmaintainable nesting.

Decision ladder:

1. **Styled core block assembly.** Try core blocks plus block supports, custom classes, theme/style tokens, CSS, layout wrappers, groups, columns, covers, media blocks, buttons, and locked patterns.
2. **Core assembly with light custom CSS.** Use core blocks as the editable structure while CSS recreates visual treatments that are not directly represented by block attributes.
3. **Custom static block.** Use when the section needs a purpose-built editor model, repeated structured fields, custom controls, front-end behavior, or layout fidelity that core blocks would make fragile.
4. **Core HTML block.** Use only for a small, justified fragment or temporary fallback.

#### Core Blocks

Use core blocks when they can represent the design with acceptable fidelity, especially for normal publishing content:

- group;
- columns;
- cover;
- image;
- media-text;
- heading;
- paragraph;
- list;
- buttons/button;
- separator;
- spacer;
- query where appropriate;
- navigation when appropriate.

Core blocks are preferred when the LLM can assemble them into cleanly editable content and block support styles can express the design without brittle nesting.

The LLM should consider core blocks even for heavily styled sections. Examples:

- a visually complex hero can often be a `core/group` or `core/cover` with headings, paragraphs, buttons, images, CSS classes, and spacing/color/typography support;
- a product grid can often be `core/group` plus columns or a repeated group pattern before becoming a custom product-card block;
- editorial callouts, stats, cards, and feature rows should start as groups, columns, headings, paragraphs, images, and buttons;
- decorative shapes, background layers, and unusual frames can often be CSS on a core group if the content inside remains normal and editable.

#### Custom Static Blocks

Ask the LLM to generate custom static blocks when core blocks are insufficient but the result should still be editor-editable.

Use custom static blocks for:

- complex cards or repeated visual units;
- asymmetric composite sections;
- marquees or carousels where the structure should be editable;
- forms or submission-oriented UI;
- data-bound or reusable domain-specific components;
- interactive sections whose HTML and attributes need a stable save function;
- precise layout patterns that core nesting would make brittle.

Custom block escalation examples:

- **Marquee:** use a custom block when the marquee has editable repeated items, speed/direction controls, pause behavior, or duplicated track markup. Use core blocks plus CSS only when it is a static decorative text row with simple editable text.
- **Carousel/slideshow:** use a custom block when slides, timing, controls, or media fields need a coherent editor UI. Avoid dumping it into HTML.
- **Forms:** use a custom block when the mockup implies a real structured form, submission endpoint, validation state, or reusable fields. Use core buttons/paragraphs only for a fake visual CTA; use an embed/plugin block only when targeting an existing form provider.
- **Unusual visual object:** use core group/image/CSS if the unusual element is decorative around normal content. Use a custom block when the element itself has editable structured parts or front-end behavior.
- **Repeated card systems:** use core patterns/inner blocks for simple cards; use a custom block when cards need structured attributes, constrained editing, or consistent repeated controls.

Static block expectations:

- `block.json`;
- editor component with meaningful controls chosen by the LLM;
- save implementation that emits deterministic markup;
- attributes for user-editable content;
- appropriate use of `RichText`, `MediaUpload`, `URLInput`, `InspectorControls`, `InnerBlocks`, and block supports;
- front-end script only when behavior requires it;
- styles isolated enough to avoid theme collisions;
- no server render requirement for the default path.

#### Core HTML Blocks

Use `core/html` only with a specific written reason in the conversion plan.

Acceptable reasons include:

- a small decorative or structural fragment cannot be expressed by core/custom static blocks within the current output target;
- a third-party embed requires raw HTML;
- a one-off visual flourish is not meaningfully editable and custom block overhead is unjustified;
- the user explicitly prioritizes pixel fidelity over editor editability for that fragment;
- temporary fallback while the plan flags a custom block opportunity.

Unacceptable reasons:

- the LLM failed to model normal headings, paragraphs, images, buttons, or sections as editable content;
- raw HTML is used for an entire page section without analysis;
- raw HTML is used to avoid building a custom block that the plan says is needed.

### 6. Block Emission

Outputs should include:

- WordPress block markup;
- LLM-generated custom static block source, if needed;
- block registration metadata;
- CSS/assets;
- a conversion report;
- preview bundle;
- validation report.

The emitted block markup should use WordPress-compatible block delimiters and should round-trip through WordPress block parsing/serialization. The deterministic layer may serialize and normalize known structures, but it should not be the primary intelligence that converts arbitrary HTML into blocks.

### 7. Preview Without WordPress

The default preview should not require WordPress.

Because the planned custom blocks are static, the tool should be able to instantiate a local block-editor preview environment:

- load `@wordpress/blocks`, `@wordpress/block-library`, and `@wordpress/block-editor`;
- register core blocks;
- register generated custom static blocks;
- parse generated block markup;
- serialize it again to verify round-trip stability;
- render the parsed static blocks through WordPress packages into deterministic HTML;
- write that rendered output as `preview/rendered-blocks.html`;
- render an editor-like canvas;
- render a front-end-like preview using generated save output and styles.

This will not replace final WordPress validation forever, but it should give fast feedback:

- whether blocks parse;
- whether custom blocks register;
- whether content is editable in an editor shell;
- whether the rendered output is visually close to the original mockup;
- whether the block tree is inspectable.

Later, optional WordPress validation can run through Playground, Studio, wp-env, or a real WordPress site.

The rendered block HTML is a required comparison artifact. Visual diffs should compare the original LLM-designed mockup against the WordPress-package-rendered static block output, not against raw `content.html` text or a hand-built approximation. Repair prompts should receive the original mockup, rendered block HTML, validation errors, and visual diff report so the LLM can adjust the plan, custom blocks, or assembly.

## Fidelity Model

The tool should optimize for two scores together.

### Visual Fidelity

Compare the original HTML mockup against the rendered block output:

- rendered block HTML generated by WordPress packages;
- desktop viewport;
- tablet viewport;
- mobile viewport;
- full-page screenshots;
- section-level crops;
- pixel diff with thresholds;
- layout box diff for key elements;
- typography/color/token diffs.

### Editor Fidelity

Measure whether the result remains useful in the editor:

- meaningful block tree;
- text editable as text;
- images editable as images;
- buttons editable as buttons or block attributes;
- repeated content editable as repeated block attributes or inner blocks;
- custom blocks expose useful controls;
- raw HTML is limited and justified.

A conversion that is pixel-perfect but uneditable should be considered incomplete unless the user explicitly asked for fidelity over editability.

## Validation Gates

Validation should be deterministic wherever possible.

Required gates:

- HTML parses;
- CSS parses;
- generated block markup contains balanced block delimiters;
- WordPress block parse/serialize round-trip succeeds;
- WordPress package render produces `preview/rendered-blocks.html`;
- custom block names and attributes are valid;
- no unplanned `core/html` blocks;
- no unsafe scripts or event handlers in emitted block content;
- no unresolved asset references;
- no token references to undeclared tokens;
- preview renders nonblank at target viewports;
- visual diff is within configured threshold or the report explains the misses.

Useful gates from prior work:

- parse and reserialize with `@wordpress/blocks`;
- register core blocks before validation;
- validate HTML block policy before editor validation;
- track custom blocks planned vs generated;
- keep deterministic eval cases separate from live agent runs.

## Artifact Contract

The tool should produce an artifact directory like:

```text
artifact/
  input/
    prompt.md
    brief.json
  mockup/
    index.html
    style.css
    script.js
    assets.json
  analysis/
    dom.json
    css.json
    layout.json
    interactions.json
  plan/
    conversion-plan.json
    rationale.md
  wordpress/
    content.html
    blocks/
      example-section/
        block.json
        edit.js
        save.js
        style.css
    assets/
  preview/
    index.html
    editor.html
  reports/
    validation.json
    visual-diff.json
    summary.md
```

The exact layout can change, but every major stage should leave inspectable files.

## Suggested Core Commands

```bash
wp-block-compiler design --prompt "..." --out artifact/mockup
wp-block-compiler analyze artifact/mockup --out artifact/analysis
wp-block-compiler plan artifact/mockup artifact/analysis --out artifact/plan
wp-block-compiler assemble artifact/plan --out artifact/wordpress
wp-block-compiler preview artifact/wordpress --out artifact/preview
wp-block-compiler validate artifact --out artifact/reports
wp-block-compiler run --prompt "..." --out artifact
```

Agents can call `run` for the full path, or call individual stages when they need to inspect and revise.

## Data Contracts

### Conversion Plan Sketch

```json
{
  "version": 1,
  "source": {
    "mockupPath": "mockup/index.html",
    "viewports": ["desktop", "tablet", "mobile"]
  },
  "tokens": {
    "colors": [],
    "typography": [],
    "spacing": []
  },
  "sections": [
    {
      "id": "hero",
      "sourceSelector": "main > section.hero",
      "strategy": "core-blocks",
      "blocks": [],
      "editableFields": [],
      "fidelityRisks": [],
      "htmlBlockReason": null
    }
  ],
  "customBlocks": [],
  "htmlBlocks": [],
  "validationPlan": []
}
```

### Progress Events

Adapters should stream structured events:

- `stage_started`;
- `stage_completed`;
- `file_written`;
- `plan_ready`;
- `validation_result`;
- `preview_ready`;
- `error`.

## Implementation Principles

- Keep the core deterministic where possible.
- Use model calls for creative generation, editor-model decisions, custom block authoring, and block assembly. Use parsers and validators for facts and enforcement.
- Make every fallback visible.
- Prefer structured JSON contracts between stages.
- Keep agent wrappers thin.
- Build evals before optimizing prompts.
- Keep the HTML mockup as the visual source of truth.
- Keep WordPress editor editability as a first-class constraint.

## Initial Build Slices

### Slice 1: Repo and Contracts

- Package skeleton.
- CLI skeleton.
- Artifact directory contract.
- Type definitions for brief, analysis, conversion plan, block output, validation report.

### Slice 2: Mockup Generator

- Prompt-to-HTML generation.
- Output static mockup bundle.
- Browser screenshot capture.
- Basic responsive checks.

### Slice 3: Analyzer

- Parse HTML and CSS.
- Compute DOM/content/style/layout summaries.
- Capture viewport layout data.
- Emit analysis JSON.

### Slice 4: LLM Planner

- Generate block implementation plan from mockup and analysis.
- Require explicit custom-block and HTML-block rationales.
- Add plan validation.

### Slice 5: LLM Block Assembly

- Ask the LLM to emit core block markup.
- Ask the LLM to emit custom static block source.
- Serialize block tree.
- Round-trip validate with WordPress block parser.

### Slice 6: Preview

- Standalone block-editor preview app.
- Register core and generated static blocks.
- Render static blocks through WordPress packages into comparison HTML.
- Render editor and front-end-like previews.
- Screenshot and compare against mockup.

### Slice 7: Agent Plugin Wrappers

- Codex plugin wrapper.
- Claude/OpenCode-compatible wrapper.
- Plain CLI fallback documentation.
- Shared tool schema and progress event contract.

### Slice 8: Eval Harness

- Deterministic prompt fixtures.
- Expected block strategy assertions.
- HTML block policy assertions.
- Visual diff thresholds.
- Editor editability score.
- Summary reports.

## Open Questions

- Should the first implementation emit a WordPress plugin containing generated static blocks, or should custom blocks be emitted as source-only until a later packaging slice?
- What is the minimum useful editor UI for generated static blocks: attribute sidebar controls, inline RichText fields, inner blocks, or all three?
- How strict should pixel diff thresholds be for the first usable version?
- Should JS interactions be converted into custom block view scripts by default, or should only explicitly requested interactions survive conversion?
- Which agent adapter should be first: Codex plugin, Claude/OpenCode wrapper, or plain MCP server?

## Working Definition of Done

A first credible version can:

1. Take a prompt.
2. Generate a polished responsive HTML/CSS mockup.
3. Analyze the mockup into structured artifacts.
4. Produce a reviewable conversion plan.
5. Emit WordPress block markup plus any needed custom static blocks.
6. Justify every `core/html` block.
7. Preview the result without a full WordPress install.
8. Validate parse/serialize behavior.
9. Report visual and editor fidelity.
10. Run from at least one agent through a thin wrapper and from the CLI directly.
