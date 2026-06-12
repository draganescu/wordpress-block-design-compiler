# Fonts and Media: Bundling Every Remote Asset Into the Theme

An installable theme depends on zero remote URLs. Fonts are downloaded and
declared in theme.json; media is copied into the theme and referenced through
placeholders. `validate_block_theme` enforces zero remote URLs in the theme
files and the content payloads — this is not optional polish.

## Font Fetch Flow (`fetch_theme_fonts`)

1. The tool finds the Google Fonts `@import url(https://fonts.googleapis.com/css2?...)`
   in the mockup CSS (`mockup/style.css`, falling back to
   `wordpress/style.css`). If the import URL is unusual, pass `importUrl`
   explicitly.
2. It requests that css2 URL with a modern Chrome desktop User-Agent so Google
   serves `woff2` sources (the default UA gets legacy formats).
3. It parses the returned `@font-face` blocks and downloads each face's woff2
   file into `theme/<slug>/assets/fonts/`, named
   `<family-slug>-<weight>-<style>-<n>.woff2` (e.g.
   `space-grotesk-700-normal-0.woff2`; `n` disambiguates unicode-range
   subsets of the same face).
4. It returns `fontFamilies` entries — name, slug, fontFamily, and `fontFace`
   arrays whose `src` values are `file:./assets/fonts/<file>` — ready for
   theme.json.

Pass the returned `fontFamilies` to `scaffold_block_theme` as the
`fontFamilies` argument; the scaffold lands them in
`settings.typography.fontFamilies[].fontFace`. Do not hand-write fontFace
entries; the validator checks every `src` exists on disk.

## Offline Means Blocked

If the css2 fetch or any woff2 download fails, the tool throws and the run is
BLOCKED. Never work around it by shipping the remote `@import` in theme CSS:
that makes the theme depend on Google at every page load and fails the
remote-URL validation. Report the run blocked with the fetch error instead.

## Media Inventory and the Placeholder Scheme

1. **Inventory**: collect every image/media reference from the block trees
   (image `url`/`href` attributes — the evidence and tree scans surface them)
   AND from a CSS `url()` scan of the workspace stylesheets (backgrounds,
   masks). The plan's media map lists each source path with its destination,
   e.g. `"mockup/assets/hero.jpg" → "assets/media/hero.jpg"`.
2. **Copy**: `scaffold_block_theme` copies each mapped file into the theme at
   its destination path (convention: `assets/media/` inside the theme).
3. **Content payloads** use `{{THEME_URI}}` placeholders
   (`{{THEME_URI}}/assets/media/hero.jpg`); the content plugin resolves them
   to `get_stylesheet_directory_uri()` at import time, so the payload works
   wherever the site is hosted.
4. **Theme CSS** cannot use the placeholder (nothing resolves it in a static
   stylesheet), so the scaffold rewrites CSS media references to RELATIVE
   paths (`../assets/...`-style, relative to the stylesheet location).
5. **Templates and parts** likewise get relative references — the scaffold
   strips the placeholder for files living inside the theme.

## The Validator Enforces Zero Remote URLs

`validate_block_theme` fails on any `http(s)://` URL in `style.css`,
`theme.json` (schema/license URLs excepted), or any content payload (payloads
must use `{{THEME_URI}}`), and on any internal `*.html` link that survived
permalink rewriting. If validation reports a remote URL, the fix is to bundle
the asset and map it — never to allowlist the URL.
