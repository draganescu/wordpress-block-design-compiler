# Template Part Inference: Reading reports/template-parts.json

`infer_template_parts` groups every top-level subtree across all pages by two
hashes and reports the evidence. It makes no header/footer assumptions; you
decide what becomes a part, and the Evidence Gate requires every part to cite
its occurrence group.

## Exact vs Structural Hash Semantics

- **Exact hash**: the whole subtree — block names, ALL attributes (values
  included), and inner blocks, recursively. Two subtrees with the same exact
  hash are byte-equivalent designs.
- **Structural hash**: block names, sorted `className` lists, and the sorted
  set of NON-content attribute keys, recursively. Content-carrying attributes
  (`content`, `text`, `caption`, `label`, `alt`, `url`, `href`, `items`,
  `links`, ...) are ignored as values — only their presence as keys counts.

A group's `kind` is `exact` when every occurrence shares one exact hash, and
`structural` when the structure matches but exact values differ. Structural
groups carry a `variance` table.

### Worked example: same nav, different `is-current`

Three pages each open with the same navigation group. On `home` the first link
has `className: "nav-link is-current"`; on `judges` the second link does. The
nav subtrees therefore have three different exact hashes — but wait: the
structural hash sorts `className` lists, and `is-current` moves between
children, so the structural shapes still match per child position only if the
class lists match. In practice the inference reports this as a `structural`
group when the varying bits are content attributes (hrefs, label text), and the
`is-current` class shows up in the variance/occurrence evidence. The point:
"same nav on every page, with a per-page current-link marker" arrives as ONE
group with three occurrences, not three unrelated singletons — and the
variance table tells you exactly which attribute paths differ
(e.g. `1.0:attrs.className`, `1.0:attrs.url`).

## Three Decisions Per Structural Group

For every group in the report, the plan must record one of:

1. **Unify** — emit one shared part from a chosen occurrence. Right when the
   variance is invisible: ordering artifacts, redundant attributes, anchors
   that normalize identically after permalink rewriting. The pages render the
   same; pick the cleanest occurrence as the source.
2. **Variant parts** — emit one part per page, named `<role>-<page>`
   (`nav-home`, `nav-judges`, `footer-home`). Right when the variance is
   visible per-page chrome state: the `is-current` marker, a footer column
   that differs by page. Each page's template references its own variant.
3. **Leave in content** — no part; the subtree ships inside the page's
   imported content payload. Right when the differences are copy in otherwise
   unique sections: the group matched structurally, but it is really per-page
   content that happens to share a layout (e.g. two hero sections with
   different headlines and images, appearing only once each per page).

## Evidence Drives Names and Areas

Use the occurrence evidence — `first`/`last` position flags, `tagName`,
`className`, `blockName` — to choose part names and the `area` value:

- `first: true` on every page + `tagName: "header"` or a nav block → name it
  after its role (`nav`, `site-nav`) and set `area: "header"`.
- `last: true` on every page + `tagName: "footer"` → `area: "footer"`.
- Anything else → `area: "uncategorized"`.

Name parts after what they ARE in this design (role, then page for variants),
not after generic theme vocabulary the evidence does not support.

## Hard Rules

- **Never extract a part from a single-page run.** Parts exist to share chrome
  across pages; with one page there is no repetition evidence, and the
  inference will report only singletons. Single-page runs normally produce
  zero parts.
- **Read the variance tables before deciding — do not eyeball.** The tables
  list exact attribute paths (`<childPath>:attrs.<key>`) with the per-page
  values. "Looks the same to me" is not a decision input; an attr path either
  appears in the table or it does not. Decide unify vs variant from the listed
  paths and whether each one is visible in the rendered page.
