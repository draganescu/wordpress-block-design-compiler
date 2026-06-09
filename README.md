# WordPress Block Design Compiler

A staged toolchain for turning a user prompt into a polished HTML/CSS/JS design, then transforming that design into WordPress block markup.

## Why This Exists

Prior attempts in Telex and WordPress Studio generate WordPress blocks directly. Even with sample HTML and screenshots, the final block result often loses too much visual quality. LLMs are already strong at creating expressive HTML/CSS/JS mockups from weak prompts; the hard problem is transferring that design into WordPress blocks without flattening the layout, losing the visual language, or making the result uneditable.

This project breaks the problem apart:

1. Let the LLM design freely in HTML/CSS/JS first.
2. Analyze the mockup deterministically.
3. Ask the LLM to plan and author the WordPress block implementation.
4. Validate, preview, diff, and repair until the block result preserves the design and remains editor-friendly.

The block strategy is core-first, not core-only. The LLM should extensively style and assemble core blocks before escalating to custom blocks. Custom blocks are for sections where core blocks plus CSS cannot preserve the design or editor model cleanly, such as editable marquees, carousels, structured forms, unusual interactive elements, or repeated card systems that need constrained controls.

The validation loop should render the generated static blocks through WordPress packages into a new HTML artifact, then compare that rendered output against the original mockup and feed any validation or visual drift back into targeted LLM repairs.

## Goal

Build a pipeline that can:

1. Accept a natural-language design prompt.
2. Generate a high-quality responsive HTML/CSS/JS concept.
3. Parse and normalize the generated markup.
4. Convert the design into valid WordPress block structure.
5. Return reusable block markup that can be pasted into, imported into, or programmatically inserted by WordPress.

## Current Commands

```bash
npm test
npm run doctor
npm run run-fixture
npm run analyze-fixture
```

The current vertical slice is fixture-driven. It copies a known mockup into an artifact directory, then analyzes the mockup into DOM, CSS, content, section, and interaction JSON files.

## Early Architecture

- `prompt -> design`: generate the HTML/CSS/JS prototype.
- `design -> normalized DOM`: clean, validate, and prepare the design tree.
- `normalized DOM -> blocks`: map elements and styles into WordPress core blocks or custom block wrappers.
- `blocks -> output`: produce block markup, assets, and metadata.

## Notes

This repo starts as a workspace for the compiler core. The implementation choices are still open, but likely areas to evaluate are:

- Node.js for DOM parsing and transformation.
- WordPress-compatible block validation and serialization for emitted output.
- A validation layer for unsafe scripts, unsupported CSS, and block fidelity.
- Optional browser rendering for screenshot-based design QA.
