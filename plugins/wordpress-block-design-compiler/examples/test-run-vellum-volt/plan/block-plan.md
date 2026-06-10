# Block Plan

Prompt: Create a homepage for Vellum & Volt, an independent letterpress studio that sells custom invitations and runs weekend print workshops.

## Strategy

Use core blocks for the page structure, text, navigation, cards, ordered process list, and buttons. Preserve the mockup classes so the rendered preview can use scoped CSS to match the source closely.

Use one custom static block for the press consult form. The form should not be a `core/html` blob because it needs editable labels, placeholders, button text, action/method settings, and semantic saved `<form>` markup.

## Sections

- Header: core Group plus Navigation-style link markup. Style with `.site-header`, `.brand`, `.site-nav`, and `.header-cta`.
- Hero: core Group with Heading, Paragraph, Buttons, and a styled decorative Group/Figure. Use CSS for the proof card geometry.
- Services: core Group containing three repeated card Groups. The asymmetric height and dark variant are CSS classes, not custom block attributes.
- Invitation families: core Group/card assembly. Use classes for the large asymmetrical suite card and two smaller cards.
- Workshops: core Group with two article-style cards. Dates remain text/time markup in saved content.
- Process: core Group with an ordered List. CSS handles four-column desktop and stacked mobile layout.
- Booking: mixed section. Copy/headline are core blocks; form is `wbdc/press-consult-form`.
- Footer: core Group/Paragraph content.

## Custom Blocks

### `wbdc/press-consult-form`

Reason: a real booking/contact form needs semantic saved fields, action/method attributes, inline editable labels and button text, and settings that belong outside the canvas. Core blocks cannot produce a coherent, reusable form model here without falling back to raw HTML.

Editable model:

- Field labels and button text: inline `RichText`.
- Action and method: `InspectorControls`.
- Field names, types, placeholders, and required flags: structured attributes, with inspector controls in a later version.
- Save output: real `<form>` with labels, inputs, textarea, and submit button.

## CSS Responsibilities

- Global page CSS: palette, type scale, responsive grids, proof-card visual system, section rhythm.
- Core block classes: layout and visual parity for header, hero, cards, workshops, process, footer.
- Custom block CSS: form grid, input sizing, labels, submit button, editor-safe disabled fields.

## HTML Block Usage

No `core/html` usage in this run. Everything is expressible as core block saved markup plus one custom static form block.
