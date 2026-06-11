# The Damai Provided Markup Block Plan

Source: `/Users/andreidraganescu/Sites/thedamai/thedamai.codebydennis.com/index.html`

## Import Path

This run uses supplied markup instead of generated mockup HTML. The workspace was created with `create_workspace`, then `import_provided_markup` copied the provided site export into `mockup/` and bundled the local stylesheets into `mockup/style.css`.

The original HTML/CSS remains the visual source of truth. The WordPress output does not import `mockup/style.css`; it recreates the page as a data-only block tree plus generated WordPress preview CSS.

## Block Strategy

- Core blocks are the default: `core/group`, `core/heading`, `core/paragraph`, `core/buttons`, `core/button`, `core/image`, and `core/separator`.
- No custom blocks are used in this first pass. The homepage sections can be represented as editable core block compositions.
- The villa selector is represented as a static editorial rail using core groups, headings, and images. A future real swiper/carousel would justify a focused custom block.
- Package cards are editable core groups with image, label, heading, copy, and button blocks. They do not become custom cards until there is a reusable package CPT/query requirement.
- The footer is core group composition with navigation buttons, address text, review/social metadata, and a book CTA over the copied leaf image.

## Section Mapping

1. Header/navigation: `core/group` header with brand, primary links, and booking action.
2. Hero: `core/group` section with centered eyebrow, h1, and CTA over a media-toned stage that references the supplied hero video as a visual background in CSS.
3. Intro: `core/group` section with three supplied home images arranged around the headline and body copy.
4. Welcome note: centered copy section.
5. Villas: dark section with villa title stack and supplied villa thumbnails.
6. Restaurant split: image plus editable text/buttons.
7. Spa split: flipped image/text split.
8. Packages intro and cards: editable heading, copy, and three core-composed package cards.
9. Footer: core-composed footer link columns, contact details, review/social/copyright row, and final booking image band.

## Styling Responsibility

Block support attributes carry section-level color, spacing, typography, border, dimensions, layout, and anchor decisions where core blocks expose them. `wordpress/style.css` handles:

- font-face declarations for the supplied ABC Whyte and Kaftan Serif assets;
- global body/editor resets and token definitions;
- responsive grid behavior and media-card aspect ratios;
- pseudo-elements for small ornaments, separators, overlays, and background media treatment;
- editor preview normalization so the block editor canvas resembles the frontend render.

## Custom Block Decision Log

No custom blocks in this pass.

- The source has interactive sliders/dropdowns, but this supplied-markup conversion is a static homepage block rendering. Core groups plus image/text blocks preserve editability and keep the tree inspectable.
- If the Damai conversion proceeds to production behavior, the villa slider should become a typed custom block with inspector controls for slides, links, media, autoplay, and responsive behavior.
- If package data becomes dynamic, package cards should become a query/CPT-backed block or pattern rather than static custom markup.
