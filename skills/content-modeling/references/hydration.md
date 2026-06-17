# Hydrating Stand-ins Against the Content Model

html-to-blocks builds data-driven regions (object grids, post indexes, comment
threads) as static core-block stand-ins so the visual gate can style them, and
marks each one in `attrs.metadata.standin`. This stage swaps those marks for the
real dynamic core blocks, now that a content model and seed entries exist.

## The two marks you consume

A repeating container carries:

```json
{ "for": "core/query", "postType": "objet", "taxonomy": "objet_cat",
  "query": { "perPage": 4, "orderBy": "date", "order": "desc" } }
```

Its first child is the item template. Each field inside that template carries:

```json
{ "for": "core/post-title" }
```

(or `core/post-featured-image`, `core/post-terms`, `core/post-excerpt`,
`core/post-date`). A comment thread carries `{ "for": "core/comments" }`.

## Sequence

1. `audit_standins` → `reports/standins.json`. It lists every mark and, when the
   model exists, validates each `postType`/`taxonomy` against it. A query
   stand-in for a post type the model does not register is an error: either the
   model is missing that CPT, or the block plan marked the wrong type. Fix the
   model (add the CPT/taxonomy + seeds) or the mark before hydrating — do not
   hydrate around a mismatch.
2. Confirm the model registers, for every query stand-in: the post type, any
   taxonomy the mark filters on, and 3-6 seed entries so the loop renders real
   content in the playground gate. Submission stand-ins (forms) are not queries
   and are not hydrated here — they stay custom form blocks wired to the REST
   route.
3. Run `hydrate_standins` ONLY after the html-to-blocks visual gate has passed.
   Hydration replaces static cards with `core/query`, which does not render in
   the static preview — so it must happen after that gate, not before. It writes
   the hydrated trees in place and backs up the originals under
   `wordpress/standin-backup/` and `reports/standins-hydration.json`.

## What hydration preserves, and why it matters

The swap keeps each block's `className`, `style`, `align`, and `layout`. The
stand-in card's classes (`.obj-card__title`, `.obj-card__media`, the grid
container class) are what the workspace CSS — and therefore the theme CSS that
blocks-to-theme lifts — targets. Because the hydrated `core/post-title` /
`core/post-template` keep those classes, the same CSS styles the live query loop.
If you rename or drop those classes, the theme loses the styling.

## Field coverage

`hydrate_standins` maps the standard post fields. Block-bound meta (price,
dimensions) has no one-to-one core block; leave those as the stand-in's static
core block (a `core/paragraph` with the class), and wire `core/post-meta` block
bindings in the theme/template stage if the design needs the live value. Note
in `content-model.md` any meta field a card shows that is not yet bound.

## After hydration

The page trees now contain real query loops and comments. They are evaluated by
blocks-to-theme's playground gate against the seeded site, where WordPress
renders them with the imported entries — not by the html-to-blocks static gate,
which is already satisfied by the pre-hydration stand-ins.
