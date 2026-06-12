# CSS Transfer Gotchas

Recurring traps when translating mockup CSS + inline styles into WordPress
block markup and preview CSS. Each of these has caused real repair iterations;
check the relevant ones BEFORE the first comparison, not after.

## Margins

**Inline `margin-top` does not remove the default bottom margin.** A mockup
paragraph with `style="margin-top:22px"` still has the stylesheet's
`p { margin: 0 0 1.1em }` bottom margin. Translating it to a class with
`margin: 22px 0 0` silently deletes `1.1em` of rhythm. Write
`margin: 22px 0 1.1em` (or set only `margin-top`) unless the mockup
explicitly zeroes the bottom.

**Margins can be masked by layout context.** A lost bottom margin inside a
multi-column grid is invisible at desktop whenever a sibling column is taller,
and only surfaces at mobile when the columns stack. A drift that appears only
at one viewport is very often a margin that desktop geometry was hiding.

**Last-child margins escape sections.** When a section has zero bottom
padding, its last child's bottom margin collapses out of the section and
becomes inter-section spacing. If you remove that margin, the next section
moves up even though "nothing visible" changed.

## Line boxes and struts

**A bare inline span/anchor sits on the parent's line strut.** Mockups often
end a prose container with a bare `<a>` styled small (`font-size: .74rem`).
That anchor's line box is the PARENT's strut (e.g. 17px × 1.6 = 27.2px), not
the anchor's own line height. When block markup must wrap it in a paragraph,
keep the paragraph at the parent's font-size and style only the inner anchor
(`p.x { margin: 0 } p.x a { font-size: .74rem; ... }`). Do NOT pin a fixed
pixel line-height on the paragraph: baseline alignment between the paragraph's
own strut and the smaller inline box rounds differently and produces 1px
offsets — a 1px global shift below that element can alone cost 2–3% pixel
mismatch on text-heavy pages.

**Inline elements that become grid/flex items are block-ified.** A
`<span>` that is a direct grid or flex child loses inline layout and is sized
by its OWN line-height, not the parent strut. The same class can therefore
need two different line-height treatments depending on context (e.g. a
`step-num` span that is inline inside a div in one section but a grid item in
another).

**display: inline-flex vs flex changes vertical position.** An inline-flex
paragraph participates in inline flow and picks up half-leading from the
anonymous line box around it (~5px at 17px/1.6). If the mockup wraps the same
content in a block-level flex div, use `display: flex`.

## Selectors

**Broad mockup selectors may intentionally reach into components.** Something
like `.article p:first-of-type::first-letter` (a drop cap) can also style the
first paragraph inside an embedded component that was injected into the
article at runtime — and the mockup's rendered output depends on that.
Replicate the reach (`.article > p:first-of-type, .article div
p:first-of-type`) instead of "fixing" it; exclude only structures your block
markup adds that the mockup never had (e.g. the `<p>` inside `core/quote`).

**Class-name collisions across contexts.** Utility-ish mockup classes
(`.brand__name` in the header vs the footer) often have different effective
styles because of scoping rules in the source CSS. Verify which rules actually
hit each instance — do not assume the header treatment applies in the footer.

## Core block markup differences

**`core/quote` wraps the text in a `<p>` the mockup may not have.** A mockup
blockquote with bare text has no `text-wrap: pretty`, no `max-width: 62ch`,
and no paragraph margins. The quote block's inner paragraph inherits all of
your `p` rules and can wrap to a different line count at the same width. Add
`blockquote p { margin: 0; font-size: inherit; line-height: inherit;
text-wrap: wrap; max-width: none; }` scoped to the quote context.

**`core/button` puts the className on the wrapper div.** Visual button rules
must target the actual control (`.wp-block-button.btn .wp-block-button__link`)
and never the wrapper, or borders/padding double up.

## Text rendering

**`text-wrap: pretty` changes line counts.** If the mockup applies it via a
`p` rule, elements that are paragraphs in your markup but NOT paragraphs in
the mockup (or vice versa) will wrap differently at identical widths.

**Form controls do not inherit like text elements.** Inputs default to the UA
font-size (13.33px) unless the mockup sets one — copying "reasonable" explicit
font sizes onto inputs that the mockup left unstyled changes their height.
Buttons get `line-height: normal` from the UA stylesheet; rich-text-editable
buttons in the editor canvas need the same.

**Editor inline styles re-wrap overflowing text.** RichText applies
`white-space: pre-wrap; min-width: 1px` as an *inline style* on every editable
element, and editor styles add `overflow-wrap: break-word`. Any text that is
intentionally wider than its container in the mockup — ghost display words,
oversized numerals, one-line labels that rely on `overflow: hidden` to clip —
stays on one line in the saved frontend but breaks (even mid-word, letter by
letter) in the canvas. The drift is editor-only and usually
viewport-dependent: it appears at the viewport where the text first exceeds
the container.

Fix: pin `white-space: nowrap !important` on those elements. The `!important`
is mandatory — this is an inline style, so no amount of selector specificity
wins without it. It is harmless on the frontend, where the line count was
already one.

Detection fingerprint: an editor-surface height delta that is an exact
multiple of one element's line-height (e.g. +1440px = 3 extra lines of a
480px ghost word), with rendered passing clean.

More generally: a mockup's computed wrapping behavior is part of the geometry
contract. Line count is the most expensive property to drift — every lost or
gained break costs a full line-height. For any element whose layout depends on
where text does or does not wrap, state the wrapping explicitly in transferred
CSS (`white-space`, `overflow-wrap`, `text-wrap`) instead of relying on
defaults — the two comparison surfaces do not share defaults.

## Verification habit

Never reason about these from the stylesheet alone. Use `measure_layout`
(mockup vs rendered, then mockup vs editor) at both viewports after every
repair batch; a drift table pinpoints which of the gotchas above actually
fired. Computed-style probes (font-size, line-height, white-space, margins)
on a single drifted element settle the cause in one step.
