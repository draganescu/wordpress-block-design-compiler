# Night Market Observatory Generation Summary

Prompt:

> Build an avant-garde homepage for a travelling Night Market Observatory, where street-food stalls, telescopes, and celestial events move through cities. It should feel like an editorial star map fused with a market directory, not a generic event landing page. Use high-contrast nighttime typography, luminous food-stall wayfinding, orbital map motifs, a real RSVP/newsletter form, and a responsive asymmetric layout.

Serializer mode:

- `mockup/style.css` is excluded from the rendered WordPress preview.
- Rendered preview CSS sources are `wordpress/style.css` and `wordpress/blocks/*/style.css`.
- The initial WordPress CSS is intentionally empty so the first comparison measures the missing CSS transfer instead of sharing source styles.

Initial comparison:

- Max mismatch: `88.45%`
- Max height delta: `3382px`
- Desktop mismatch: `88.45%`
- Desktop height delta: `2896px`
- Mobile mismatch: `85.54%`
- Mobile height delta: `3382px`

Repair iterations:

- `0`

Initial task summary:

- Recreate macro page styling in `wordpress/style.css`.
- Restore section vertical scale, layout grids, mobile breakpoints, colors, typography, and component sizing.
- Keep block composition and custom block save markup data-only; do not reintroduce `mockup/style.css` into rendered preview.
