# Maison Clouet Block Plan

## Site Scope

This run renders the homepage through the block compiler and includes implementation artifacts for the wider WordPress site:

- Home block assembly: header, hero flatlay, newest arrivals, scent narrative, shop/location story, journal teasers, newsletter, footer.
- `objet` CPT plugin artifact in `wordpress/plugin/maison-clouet-objets.php` with REST support, taxonomy, meta fields, and seeded objects.
- Reusable `wbdc/maison-object-card` static block for shop grids and journal embeds.
- Page architecture notes for Shop, Scent, The Shop, Journal, and Contact.

## Visual Direction

Maison Clouet should feel like a confident Provence dinner-party RSVP crossed with a market ledger: cream paper, ink blue, tomato-red shadows, occasional butter-yellow tags, no purple gradients, no beige skincare minimalism. Headings use Georgia as a system serif stand-in with high contrast and intentionally oversized lowercase rhythm; body copy uses a humanist/grotesk system sans; prices and labels use monospace.

## Section Mapping

- Header: custom `wbdc/maison-header`. Reason: brand/tagline/nav has semantic header/nav markup and a mobile grid nav that core Navigation cannot serialize locally with enough predictability.
- Hero: custom `wbdc/maison-hero`. Reason: asymmetric editorial title plus generated flatlay image-like composition with multiple decorative objects and caption.
- Newest arrivals: custom `wbdc/maison-arrivals`. Reason: homepage pulls `objet` data and needs category filters plus a query-like curated object grid. The reusable `wbdc/maison-object-card` block shares the same visual card contract for shop and journal embeds.
- Scent: custom `wbdc/maison-scent-story`. Reason: separate made-to-order narrative with a strong full-width band and scent notes.
- The Shop: custom `wbdc/maison-visit`. Reason: location/photo/hours layout with semantic address and definition-list metadata.
- Journal: custom `wbdc/maison-journal-row`. Reason: magazine-column teaser layout, weekly editorial posts.
- Newsletter/contact: custom `wbdc/maison-newsletter`. Reason: semantic form with labels, disabled controls in editor, submit button, and Friday-list copy.
- Footer: custom `wbdc/maison-footer`. Reason: semantic footer/contact details repeated across pages.

## Editor Parity

Every custom block mirrors `edit()` and `save()` structure:

- Same root tags, class names, child order, repeated wrappers, and object-card geometry.
- Visible copy uses `RichText` on the actual visual element.
- Forms render real fields in both edit and save; edit disables controls to prevent submission without changing geometry.
- Editor-specific helper UI is excluded from canvas; settings belong in InspectorControls in a future production iteration.

## Styling Responsibilities

- Block support/style attrs: root spacing, colors, and page-level section padding where practical.
- Block CSS: internal grid templates, flatlay composition, object-card visuals, form controls, responsive nav and mobile stacking.
- Page CSS: tokens, base document background, typography defaults, shared section rhythm.

## Wider WordPress Site

- Shop page: query `objet` posts with category filter controls for ceramics, glass, textiles, lighting, wall art, scent. Render each item with `wbdc/maison-object-card`.
- Scent page: narrative page for made-to-order candles and room sprays; uses scent category objects plus scent story blocks.
- The Shop page: story, L'isle-sur-la-Sorgue context, photos, hours, map/find-us instructions.
- Journal page: standard posts styled as magazine columns; object-card block can be embedded in posts.
- Contact page: press/wholesale/sourcing request form, email, Instagram link.

## Custom Blocks

- `wbdc/maison-header`: brand, tagline, nav links.
- `wbdc/maison-hero`: eyebrow, title, intro, flatlay labels.
- `wbdc/maison-object-card`: photo variant, category, title, price, story, dimensions, condition.
- `wbdc/maison-arrivals`: heading, filters, object array rendered as cards.
- `wbdc/maison-scent-story`: scent narrative.
- `wbdc/maison-visit`: storefront illustration, address, hours, find-us copy.
- `wbdc/maison-journal-row`: magazine teasers.
- `wbdc/maison-newsletter`: semantic signup form.
- `wbdc/maison-footer`: address, hours, Instagram, newsletter reminder.

No `core/html` is used in the homepage assembly.
