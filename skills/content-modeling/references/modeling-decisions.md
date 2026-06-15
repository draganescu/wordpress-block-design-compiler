# Content Modeling Decisions

Use the design and brief to separate content architecture from visual layout.

## Pages

Use pages for stable editorial surfaces: home, about, contact, services overview, shop landing, policy pages, campaign pages. A page can contain query loops and custom blocks, but the page itself is not the collection.

## Core Posts

Use WordPress `post` for journal/news/blog/magazine updates unless the brief needs a domain-specific entry type with different fields, archives, permissions, or templates. Use normal categories/tags for broad editorial grouping.

## Content CPTs

Use a content CPT for a domain noun the owner will manage as records: objects/products, projects, case studies, team members, events, locations, menu items, testimonials, press mentions, services, resources, classes, listings.

Good signals:

- The design shows a filterable grid, directory, catalog, index, roster, timeline, event list, or reusable card.
- The user describes fields such as price, dimensions, role, date, location, condition, client, rating, ingredients, capacity.
- Entries need archives, single pages, query loops, or embedding inside other pages/posts.
- The collection will grow after launch.

Bad signals:

- A one-off values grid, a three-step process, a hero metric strip, or decorative repeated blocks.
- Content that is only meaningful in one page and will not be added to independently.

## Submission CPTs

Use a submission CPT for visitor-submitted data: contact, booking, RSVP, sourcing request, wholesale inquiry, review, newsletter lead, application, estimate request.

Submission CPTs are admin-visible but not public. They need meta/form fields and a custom form block or endpoint-aware UI. The generated content-model plugin registers a public REST route for each submission CPT; the block plan should use that route.

## Taxonomies

Use a taxonomy when editors or visitors need grouping, filtering, archives, or query-loop constraints.

Examples:

- `objet_category`: ceramics, glass, textiles, lighting, wall art, scent
- `event_type`: workshop, market, talk
- `project_category`: residential, cultural, retail
- `region`: Provence, Paris, online

Prefer hierarchical taxonomies for category-like filters and non-hierarchical taxonomies for tags/attributes.

Do not create taxonomies for singleton labels or data that belongs as meta, such as price, dimensions, date, or external URL.

## Meta Fields

Use meta for structured atoms shown separately in cards, filters, labels, sorting, REST, or forms.

Common field choices:

- money/price: `number`
- dimensions, condition, role, address: `string`
- long notes/message/story when explicitly named: `string` with `format: "textarea"`
- dates: `string` with `format: "date"` unless the consuming code needs timestamps
- URLs: `string` with `format: "url"`
- emails: `string` with `format: "email"`
- counts/party size/rating: `integer` or `number`
- toggles: `boolean`

Keep long editorial narratives in `post_content` unless the brief names them as fields or they need to appear independently from body content.

## Seed Content

Seed content is part of the model, not decoration. It proves the admin experience and gives query loops something real to render.

- Content CPTs: usually 3-6 entries.
- Submission CPTs: usually 2-3 fictional submissions.
- Use realistic domain-specific titles, values, and copy.
- Fill every declared meta field at least once.
- Attach taxonomy terms that match the planned filters.
- Avoid real personal data, real brands, or fake content that looks like production records.
