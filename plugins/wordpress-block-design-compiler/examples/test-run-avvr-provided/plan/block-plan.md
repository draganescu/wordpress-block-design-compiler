# AVVR Provided Markup Block Plan

Source: `/Users/andreidraganescu/Sites/avvr/avvr.nl/index.html`

Goal: convert the imported AVVR homepage into editable WordPress block content while preserving the visible hierarchy: dark rounded hero, large image, USP stack, light media/text sections, dark expertise directory, image-backed about card, article rail, and dark footer.

## Core-First Audit

### Shell, Navigation, Hero

- Core block choice: `core/group` as `main`, nested `core/group` as dark hero shell, `core/group` as header/nav row, `core/buttons` for nav links, `core/heading`, `core/paragraph`, and `core/buttons` for hero copy.
- Native/support props first: `tagName`, `anchor`, `className`, `style.color.background`, `style.color.text`, `style.spacing.padding`, `style.dimensions.minHeight`, `layout`.
- Alternatives rejected: `core/navigation` would introduce navigation entity behavior and local preview drift; static `core/buttons` better matches this standalone import. A custom hero block is unnecessary because all visible content is inline editable core text/buttons.
- CSS responsibility: AVVR logo typography, desktop/mobile nav hiding, diagonal line ornament, pill button arrow shape, and rounded section shell.

### Hero Image

- Core block choice: `core/cover` for the wide rounded office image with a scroll CTA over the image.
- Native/support props first: `url`, `alt`, `dimRatio`, `minHeight`, `minHeightUnit`, `contentPosition`, `isDark`, spacing.
- Alternatives rejected: `core/image` cannot host the overlay CTA; `core/group` plus CSS background would hide media editability and has worse editor parity.
- CSS responsibility: max-width, border-radius, image position, and mobile aspect.

### USP Trio

- Core block choice: `core/columns` with three `core/column` items, each using `core/paragraph` for the icon glyph, `core/heading`, and `core/paragraph`.
- Native/support props first: columns `style.spacing.blockGap`, group padding, column text content remains inline editable.
- Alternatives rejected: custom card block is unnecessary; repeated cards have simple editable fields.
- CSS responsibility: small icon boxes and mobile stacking.

### Vastgoed / Ondernemingen Splits

- Core block choice: two `core/media-text` blocks.
- Native/support props first: `mediaUrl`, `mediaAlt`, `mediaType`, `mediaWidth`, `isStackedOnMobile`, `verticalAlignment`, `style.spacing.padding`.
- Alternatives rejected: `core/columns` is less specific for a one-image/one-copy split; custom split blocks are not required.
- CSS responsibility: rounded light shell, illustration sizing, button row styling.

### Expertise Directory

- Core block choice: `core/group` dark shell, heading/count row, nested `core/columns` with one `core/group` per expertise family, and `core/list`/`core/list-item` for linked expertise names.
- Native/support props first: group background/text color, padding, heading/list content, class names for the directory variants.
- Alternatives rejected: a custom directory block would be useful if this were backed by live taxonomy data, but the provided static homepage only needs editable static content. `core/list` preserves list semantics.
- CSS responsibility: three-column directory grid, pill count, row dividers, arrow ornaments using pseudo-elements.

### About Cover

- Core block choice: `core/cover` for the image-backed "Over ons" section.
- Native/support props first: image URL, overlay dim ratio, content position, min height, nested heading/paragraph/buttons.
- Alternatives rejected: `core/group` background-image support did not serialize visibly in this preview harness; `core/cover` is the correct specific core block.
- CSS responsibility: centered overlay card geometry and rounded top transition.

### Recent Articles

- Core block choice: `core/group` light section, `core/columns` of article card compositions using `core/image`, `core/paragraph`, `core/heading`, and `core/buttons`.
- Native/support props first: images as editable `core/image`, text as inline editable, links as `core/button`.
- Alternatives rejected: query/post blocks require a live WordPress data context; custom article card blocks are unnecessary for this static import.
- CSS responsibility: responsive horizontal desktop grid, compact mobile card stack, tag/date typography.

### Footer

- Core block choice: `core/group` as footer, `core/columns` for sitemap/contact blocks, `core/buttons` for links.
- Native/support props first: `tagName: footer`, background/text color, padding, button URLs.
- Alternatives rejected: custom footer block is not needed.
- CSS responsibility: footer logo text, column rhythm, low-contrast metadata.

## Custom Blocks

None for this run. The visible homepage can be represented with core static blocks while keeping all text, images, and buttons editable. The hidden search modal in the source would require a real form/custom block if included as visible page content, but it is outside the homepage render target.

## CSS Scope

`wordpress/style.css` defines AVVR design tokens, fonts, shell geometry, ornaments, button shapes, responsive grids, and editor-preview parity. It does not import `mockup/style.css` and does not rely on source HTML classes beyond the generated block classes.
