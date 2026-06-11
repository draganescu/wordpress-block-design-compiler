# Core Block Selection

Choosing "core blocks" is not enough. Pick the core block whose saved markup and editor behavior are closest to the source structure. The wrong core block often creates editor drift even when the frontend CSS can be forced to match.

## Selection Rules

Prefer the most specific static core block that expresses the source structure:

- Use `core/cover` for media-backed sections, heroes, promos, and cards where text/buttons sit over an image or video with an overlay. This usually preserves editor parity better than `core/group` plus absolutely positioned `core/image`.
- Use `core/media-text` for a two-part image/text split where the media and copy are peers and should stack on mobile.
- Use `core/columns` and `core/column` for ordinary responsive columns where each column contains editable blocks and WordPress's mobile collapse is desired.
- Use `core/group` for layout wrappers, section shells, stacked editorial bands, constrained containers, and grid children. Do not use it as the default for media overlays, lists, forms, links, or arbitrary HTML.
- Use `core/image` for standalone editable images, image grids, thumbnails, and image fields inside repeated editable compositions.
- Use `core/video` for standalone editable video where the video itself is the content. Use `core/cover` when text overlays the video.
- Use `core/buttons` and `core/button` for link/button groups, even when they need custom visual styling.
- Use `core/list` and `core/list-item` for real ordered/unordered lists. Do not use paragraphs with line breaks for list data.
- Use `core/details` for disclosure content that should remain editable and semantic.
- Use `core/separator` and `core/spacer` sparingly for real editorial dividers or rhythm that should be visible/editable as block content.
- Use `core/navigation` only when its dynamic/static behavior is acceptable in the target preview and editor setup. For static link rows in this compiler, `core/buttons` or a focused custom navigation block may be more predictable.
- Use dynamic core blocks such as query/post blocks only when the final WordPress context will provide the data. They may not produce useful local static preview output.

## Native Props First

After selecting a core block, use its native attributes and support-backed props before writing CSS. CSS should finish the visual translation; it should not replace core-owned controls that WordPress already exposes in the editor.

Check the registered block metadata before assembly. Useful props include:

- `core/group`: `backgroundColor`, `textColor`, `gradient`, `style.background`, `style.color`, `style.spacing`, `style.dimensions`, `style.border`, `style.typography`, `layout`, `align`, `anchor`, `ariaLabel`, and `allowedBlocks`.
- `core/cover`: `url`, `alt`, `backgroundType`, `poster`, `dimRatio`, `overlayColor`, `customOverlayColor`, `gradient`, `customGradient`, `focalPoint`, `minHeight`, `minHeightUnit`, `contentPosition`, `isDark`, spacing, border, typography, and layout props.
- `core/media-text`: `mediaUrl`, `mediaAlt`, `mediaType`, `mediaPosition`, `mediaWidth`, `imageFill`, `focalPoint`, `isStackedOnMobile`, `verticalAlignment`, spacing, color, border, and typography props.
- `core/image`: `url`, `alt`, `caption`, `title`, `width`, `height`, `aspectRatio`, `scale`, `focalPoint`, `sizeSlug`, `linkDestination`, `href`, border, shadow, duotone, and margin props.
- `core/button`: `text`, `url`, `type`, `linkTarget`, `rel`, `backgroundColor`, `textColor`, `gradient`, `borderColor`, width, spacing, border, typography, and shadow props.
- `core/columns` / `core/column`: widths, vertical alignment, stacking behavior, spacing, colors, borders, and typography props.

Examples:

- If a section needs a background color, use `core/group` `backgroundColor` or `style.color.background` before a CSS `background-color` rule.
- If a block needs background image plus overlay content, prefer `core/cover` and set `url`, `dimRatio`, focal point, min height, and nested blocks before using a `core/group` with CSS background image.
- If the source is a leaf/photo band with one CTA over the image, `core/cover` should usually replace `core/group` plus a child `core/image`.
- If the source is a text/image split, use `core/media-text` `isStackedOnMobile`, `mediaPosition`, and `mediaWidth` before writing custom grid CSS.
- If a button needs color, padding, radius, width, or typography, use button support attributes before targeting `.wp-block-button__link` in CSS.

Static preview caveat:

- Some WordPress support props are serialized through the WordPress style engine rather than directly into saved HTML. If a prop is present in the block comment but does not affect `rendered/rendered-blocks.html` or the editor screenshot, do not silently fall back to ad hoc CSS.
- First check whether a more specific core block serializes the visual behavior better. For example, use `core/cover` for media backgrounds with overlay content instead of relying on `core/group` background-image support in this static preview.
- If the chosen prop is still the correct WordPress model, document the preview limitation and add one focused renderer/editor-preview support fix rather than spreading equivalent CSS across page selectors.

## Common Mappings

Hero with background media:

- First choice: `core/cover` with nested heading, paragraph, buttons, and support attributes for min-height, overlay, focal point, and text color.
- Use `core/group` only if the source is not actually media-backed or the media is decorative CSS rather than editable content.
- Use a custom block only if the hero has a typed editing model beyond nested editable content, such as slide sets, live booking state, or complex media controls.

Image overlay card:

- First choice: `core/cover` as the card shell with nested label, heading, paragraph, and button blocks.
- This keeps the editor canvas close to the frontend because the image is a background of the same block that owns the overlay content.
- Avoid `core/group` with an absolutely positioned `core/image` unless `core/cover` cannot represent the required source markup or media behavior.

Image/text split:

- First choice: `core/media-text` when the layout is one media panel plus one content panel.
- Use `core/columns` when both sides contain mixed block content or multiple images.
- Use `core/group` plus CSS grid only for asymmetric editorial compositions that do not fit `media-text` or `columns`.

Responsive column layout:

- First choice: `core/columns` when the source is visually and semantically a set of columns.
- Use the native mobile stacking behavior before writing custom responsive CSS.
- Use `core/group` grid only when the source uses bento/asymmetric tracks, overlaps, or non-column placement.

Repeated cards:

- Use repeated core compositions when each card is simple image/heading/text/button content and one-off editability is enough.
- Use `core/cover` for media-overlay cards.
- Use a custom block when the card is reusable across pages/posts, has structured metadata, inspector controls, repeated item management, or a required semantic save contract.

Forms and search:

- Do not fake forms with paragraphs, buttons, or decorative groups.
- Use an existing form/search core block only if it serializes the needed fields and behavior for the target context.
- Otherwise generate a custom static block that saves real `<form>` markup and has inline editable labels/buttons with behavior in inspector controls.

Navigation:

- For simple static link rows, prefer `core/buttons`/`core/button` or a custom static navigation block when exact saved markup matters.
- Use `core/navigation` when the WordPress navigation entity behavior is desired and local static preview limitations are acceptable.

Decorative-only elements:

- If the element carries no content or editor value, prefer CSS pseudo-elements or background styling on the nearest semantic block.
- Do not create empty custom blocks or empty core groups solely for ornaments unless the ornament needs editor controls.

## Plan Requirement

For every major section, include a short "core block choice" note in `plan/block-plan.md`:

- chosen core block assembly;
- native attributes/support props used before CSS;
- nearby core alternatives rejected;
- why the chosen block improves saved markup and editor parity;
- any CSS/support responsibility left over after choosing the block.
