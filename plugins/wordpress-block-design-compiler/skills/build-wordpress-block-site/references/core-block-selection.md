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
- nearby core alternatives rejected;
- why the chosen block improves saved markup and editor parity;
- any CSS/support responsibility left over after choosing the block.
