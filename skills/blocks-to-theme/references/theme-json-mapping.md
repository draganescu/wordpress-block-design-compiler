# Theme.json Mapping: Lifting Style Evidence Into the Theme

How to turn `reports/theme-evidence.json` into a token map, theme.json
settings/styles, and a small residual `style.css`. The scaffold applies your
decisions mechanically; this document is the decision procedure.

## The Lifting Ladder

For every recurring style fact in the evidence report, try each rung in order
and stop at the first that fits. The lower the rung, the more editable and
inspectable the result; `style.css` is the last resort.

1. **Presets** (`settings.color.palette`, `settings.typography.fontSizes`,
   `settings.spacing.spacingSizes`, `settings.custom`): recurring colors,
   font sizes, spacing values, and custom properties become named tokens.
2. **Root styles** (`styles.color`, `styles.typography`, `styles.spacing`):
   the page's base background/text/font — whatever the mockup set on
   `body`/`:root`.
3. **Element styles** (`styles.elements.heading`, `.link`, `.button`, ...):
   rules whose selectors target plain elements site-wide (`h1, h2`, `a`,
   buttons).
4. **Block styles** (`styles.blocks["core/..."]`): rules that consistently
   target one block type (e.g. every `core/separator` shares a color/width).
5. **Block style variations**: a named alternative look applied to some
   instances of a block type but not others.
6. **Per-block CSS** (`styles.blocks["core/..."].css`): a scoped escape hatch
   for one block type when no structured property exists for the rule.
7. **Theme `style.css`**: everything that genuinely cannot lift — and ONLY
   rules carrying one of the six reason categories below.

## The Six Reason Categories (Lift-First Gate)

A rule may remain in `style.css` (or in any `styles.blocks[...].css`) only if
the plan's lift ledger tags it with at least one of:

- `media-query` — the rule lives inside `@media` (theme.json has no responsive
  conditions).
- `pseudo` — `::before`/`::after`/pseudo-element content and decoration.
- `position` — `position: fixed | absolute | sticky` layering.
- `blend` — `mix-blend-mode`, `filter`, `backdrop-filter`.
- `grid` — `display: grid` and `grid-*` properties (no block support models
  arbitrary grids).
- `interaction` — `:hover`/`:focus`/`:active`/`:checked` states, transitions,
  animations, `@keyframes`.
- `selector` — the rule targets an arbitrary class composition
  (`.hero__copy`, `.tier li`) that theme.json structurally cannot address:
  global styles only reach the root, elements, and registered block types.
  This category is judged, not tool-assigned: it never applies to rules on
  `body`, bare element selectors, or `.wp-block-*` roots — those always lift
  to root styles, `styles.elements`, or `styles.blocks`.

The first six are exactly the buckets `analyze_theme_evidence` assigns to each
rule in `cssRules[].buckets`. A rule the report shows with an empty `buckets`
array is either liftable (lift it) or a `selector` case (justify it in the
ledger). Do not solve fidelity by dumping the workspace stylesheet into the
theme.

## Editor-Runtime Constraints On Attribute Values

- Raw `var(--…)` references must NOT appear in style attribute values
  (spacing, color, etc.). The browser-side save escapes `--` inside `style`
  attributes as `u002du002d` (kses protection), so such markup can never
  validate in the editor. Tokens used in attr values must become presets
  (`var:preset|spacing|<slug>`), which are exempt. Raw `var()` is fine in CSS
  files — only attribute values are affected.
- Block attributes containing `&`, `<`, `>`, `"` or `--` are escaped as
  `\uXXXX` sequences in the serialized comment JSON. Anything that inserts
  that markup through PHP must `wp_slash()` it first — `wp_insert_post`
  unslashes input and silently corrupts the escapes (the generated content
  plugin does this; custom import paths must too).

## The Two Mechanical Rewrites

You declare the token map; `scaffold_block_theme` performs the rewrites. Know
what they do so you can predict the output:

1. **Preset refs in block trees.** Any tree attribute value that exactly
   matches a token-map entry is replaced by the preset reference. Example:
   with `"#0b0b0b" → "ink"` in `tokenMap.colors`, a block carrying
   `"style":{"color":{"background":"#0B0B0B"}}` becomes
   `"backgroundColor":"ink"` (the raw style entry is removed). Font sizes
   become `"fontSize":"<slug>"`; spacing values become
   `"var:preset|spacing|<slug>"`.
2. **Custom-property renames in CSS.** With `"--pad" → "pad"` in
   `tokenMap.custom`, every `var(--pad)` in the residual CSS becomes
   `var(--wp--custom--pad)`, and the `--pad: ...;` definition is dropped from
   `:root` — WordPress now emits the variable from
   `settings.custom.pad`.

## Preset Naming Rules

- Name presets after the source custom properties. The evidence report lists,
  for each color, the custom properties whose value equals it (`names`):
  `--bone` → slug `bone`, `--ink-soft` → slug `ink-soft`. A value with no
  custom-property name gets a descriptive slug you choose; never `color-1`.
- Only EXACT value matches rewrite (comparison is trimmed, lowercased). Never
  map "close" values: if the mockup uses both `#0b0b0b` and `#0c0c0c`, they
  are two tokens or one of them stays raw — silently merging them changes the
  design.
- `clamp()` values are preserved verbatim in presets. A fluid font size like
  `clamp(2rem, 5vw, 4rem)` goes into `settings.typography.fontSizes[].size`
  exactly as written; do not flatten it to a static value.

## settings.custom Naming Warning

WordPress camelCases `settings.custom` keys when emitting CSS variables:
`settings.custom.lineStrong` emits `--wp--custom--line-strong`, but
`settings.custom["line-strong"]` ALSO emits `--wp--custom--line-strong` —
and round-tripping mixed conventions produces surprises. Use lowercase
single-word names (`pad`, `ease`, `line`) wherever possible; when a source
property is multi-word (`--line-strong`), pick one convention, verify the
emitted variable name in the rendered page, and make sure `tokenMap.custom`
maps to the slug whose emitted form matches what the rewritten CSS references.

## What Must NOT Lift

Media queries, pseudo-elements, `position: fixed/absolute/sticky`, blend/filter
effects, grid layouts, and interaction states have no theme.json
representation. Do not approximate them with structured properties; keep them
in `style.css` with their ledger category.

## styles.css In theme.json Is Not Used

theme.json technically accepts a top-level `styles.css` string. This pipeline
does not use it: residual CSS goes in the theme's `style.css` FILE, where it
is inspectable, diffable, and enqueued by `functions.php` for both frontend
and editor. Per-block `styles.blocks[...].css` remains available for scoped
cases (rung 6 of the ladder).
