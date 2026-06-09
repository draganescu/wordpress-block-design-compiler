# WordPress Block Design Compiler

A staged toolchain for turning a user prompt into a polished HTML/CSS/JS design, then transforming that design into WordPress block markup.

## Goal

Build a pipeline that can:

1. Accept a natural-language design prompt.
2. Generate a high-quality responsive HTML/CSS/JS concept.
3. Parse and normalize the generated markup.
4. Convert the design into valid WordPress block structure.
5. Return reusable block markup that can be pasted into, imported into, or programmatically inserted by WordPress.

## Early Architecture

- `prompt -> design`: generate the HTML/CSS/JS prototype.
- `design -> normalized DOM`: clean, validate, and prepare the design tree.
- `normalized DOM -> blocks`: map elements and styles into WordPress core blocks or custom block wrappers.
- `blocks -> output`: produce block markup, assets, and metadata.

## Notes

This repo starts as a workspace for the compiler core. The implementation choices are still open, but likely areas to evaluate are:

- Node.js for DOM parsing and transformation.
- A block serializer for WordPress-compatible comment delimiters.
- A validation layer for unsafe scripts, unsupported CSS, and block fidelity.
- Optional browser rendering for screenshot-based design QA.
