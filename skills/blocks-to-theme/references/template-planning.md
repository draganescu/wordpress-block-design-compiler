# Template Planning: The Standing Set and Justified Additions

Which template files the theme ships and why each exists. Templates are the
chrome skeleton; the actual page copy is imported as posts/pages by the
content plugin.

## The Standing Set

Every generated theme ships exactly these by default:

- `templates/index.html` — the fallback template, built from the inferred
  chrome (parts) plus `post-content`.
- `templates/archive.html`, `templates/single.html`, `templates/404.html` —
  generic defaults. They need NO evidence: the mockups have no archive,
  single-post, or 404 designs, so these are composed from the inferred chrome
  plus plain core blocks (query loop, post title/date/content, not-found
  message) styled entirely by global styles.

The scaffold builds the defaults automatically: it takes the `part` entries
from your `index` template, splits them into top chrome and bottom chrome, and
wraps each default body with them. They inherit index's chrome and the theme's
global styles — you do not design them.

## When `page-{slug}` Is Justified

Only when that page needs a DIFFERENT chrome variant set than index, and the
difference is cited from `reports/template-parts.json`. Example: nav and
footer were extracted as per-page variant parts (`nav-home` vs `nav-judges`),
so `page-judges` exists to reference `nav-judges`/`footer-judges` while
`index` references the home variants. If every page shares identical chrome,
`index.html` alone serves them all and no `page-{slug}` template is allowed.

## When `front-page` Is Justified

Only when the front page's chrome differs from the template that would
otherwise serve it — same citation requirement. Note the content plugin
already sets `show_on_front`/`page_on_front` from the manifest's `front`
flag, and a `page-{slug}` template assigned via the page's `template` field
also applies to the front page; prefer those before adding `front-page.html`.

## Templates Contain Chrome + post-content Only

A template is: template-part references (chrome) plus
`<!-- wp:post-content /-->` (and, in the generic defaults, the plain core
blocks listed above). Page copy — heroes, sections, lists, everything the
mockup designed — lives in the imported pages, where it is editable content.
Never bake a page's sections into its template: that duplicates content into
an uneditable location and breaks the import/remove plugin's ownership of the
copy.

## Generic Defaults Are Not Pixel-Gated

`archive.html`, `single.html`, and `404.html` have no mockup, so
`playground_render` does not screenshot-compare them — there is nothing to
compare against. They are covered by `validate_block_theme` only (parse,
known blocks, contentful check, part refs resolve). Do not spend repair
cycles styling them beyond what global styles already provide.
