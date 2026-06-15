---
name: content-modeling
description: Use when a WordPress site design needs durable content architecture: deciding posts vs pages vs custom post types, taxonomies, structured post meta, submission CPTs, seed entries, and an installable plugin that applies the model. Run after an HTML/mockup analysis exists, before or alongside html-to-blocks/block-theme work, especially for shop/catalog/object grids, journals, events, teams, locations, forms, bookings, leads, directories, or any repeated content the site owner should manage in wp-admin.
---

# Content Modeling

Use this skill to turn a design/site brief into an explicit WordPress content model before the block and theme work hard-codes content into pages.

The agent owns the modeling judgment. The tools only validate the model and generate the installable plugin.

## Required Workflow

1. Read the user brief, mockup/design files, `analysis/content-inventory.json`, and any existing `plan/block-plan.md`.
2. Read `references/modeling-decisions.md` before deciding what becomes pages, posts, CPTs, taxonomies, or static block content.
3. Write `content-model/content-model.md` with the reasoning:
   - candidate collections detected in the design
   - decision for each: static page blocks, core `post`, content CPT, submission CPT, taxonomy, or meta
   - where each model appears in the design (shop grid, journal index, contact form, directory, etc.)
   - how html-to-blocks should render it (static seed blocks for preview, `core/query`, custom card block, form block, archive/single templates later)
4. Write `content-model/content-model.json` using `references/plugin-contract.md`.
5. Run `validate_content_model`. Fix every `errors[]`; read warnings and either fix them or explain why they are acceptable in `content-model/content-model.md`.
6. Run `scaffold_content_model_plugin`. This writes an installable WordPress plugin under `content-model/plugin/<plugin-slug>/`.
7. Feed the model back into later stages:
   - html-to-blocks: repeated dynamic lists should be represented as query-ready structures, not hard-coded forever.
   - blocks-to-theme: content CPTs need archive/single template plans; submission CPTs need paired form blocks and REST endpoints.

## Gates

Do not create a CPT just because the mockup has a visual card grid. Create a CPT only when the site owner needs to add, edit, filter, archive, or reuse entries outside one page.

Public content CPTs require:

- `kind: "content"`
- 3-6 realistic seed entries, unless the user explicitly wants an empty model
- REST exposure
- a planned archive/listing surface
- a planned single/detail surface or an explicit reason entries have no singles

Submission CPTs require:

- `kind: "submission"`
- structured `meta` and/or `formFields`
- 2-3 realistic seed submissions
- a paired frontend form/search/booking/custom block in the block plan
- no public archive/single display

Taxonomies require a real user-facing or editorial reason: filtering, grouping, navigation, archive pages, admin organization, or query loops. Do not model one-off labels as taxonomies.

Meta fields require a reason: filtering, sorting, card labels, schema-like data, REST exposure, or form storage. Long editorial prose normally belongs in `post_content`; use meta for long text only when the user explicitly asked for a named field or the design needs that field separately.

## Completion

A content-modeling run is complete only when:

- `reports/content-model-validation.json` has `valid: true`
- `content-model/content-model.json` is the canonical model
- `content-model/content-model.md` explains each modeling decision
- `scaffold_content_model_plugin` has produced a plugin folder

Final response should name the plugin folder, post types, taxonomies, seed count, and validation status.
