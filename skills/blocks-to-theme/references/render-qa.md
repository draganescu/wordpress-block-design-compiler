# Render QA — defects, not taste

The render QA gate is the one step that looks at the shipped site the way a
first-time visitor would. Every other gate checks a proxy (serializes,
validates, sections present, parity with a mockup the user never sees); this
one looks at the real WordPress render and asks a single question: **does
anything on this page read as broken?**

## What counts as a defect

Something a visitor would call broken **without knowing the design intent**:

- Unreadable text: too little contrast against its background, clipped,
  overlapped by another element, or cut off mid-line.
- Elements overlapping, clipped by a container, or floating detached from any
  layout (an orphaned button or stray label).
- Layout overflow: content wider than the viewport (horizontal scroll),
  an image or block escaping its container.
- Navigation rendered wrong: menu items wrapped onto multiple lines, or
  stacked vertically where the layout is clearly a horizontal bar.
- Empty boxes where content obviously belongs (a card with a blank
  placeholder rectangle among cards that have images).
- A section collapsed to nothing or rendering as a blank band.

## What does NOT count

- Color, typography, spacing, or density choices — even ones you would have
  made differently.
- Content wording or tone.
- Any difference from a mockup or design file. The generated design is a
  guide; parity with it is not the product.

Rule of thumb: if you need the design to explain why it is wrong, it is
taste — skip it. If a stranger would wince without any context, it is a
defect — report it, one plain sentence each, with where it sits and which
viewport shows it. An intact page returns an empty list; finding nothing is a
valid and common outcome, not a failure to look hard enough.

## Fix discipline

- Make the smallest change that removes the named defects. Never restyle
  anything that already reads correct.
- CSS first: return `appendCss` with only the new rules (it is appended to
  the theme stylesheet, so later rules win). Reach for markup edits ONLY when
  CSS cannot express the fix — removing a stray element, correcting a
  navigation attribute.
- Markup edits must stay canonical block markup: real core blocks and real
  attributes only, keep the content text verbatim, and only touch the files
  the harness lists as editable.
- One round of fixes per iteration. The harness re-renders and re-judges;
  do not anticipate future iterations.
