# Content Model Plugin Contract

The canonical model lives at:

```text
content-model/content-model.json
```

The generated plugin lives at:

```text
content-model/plugin/<plugin-slug>/
```

Run `validate_content_model` before `scaffold_content_model_plugin`.

## Shape

```json
{
  "version": 1,
  "plugin": {
    "slug": "site-content",
    "name": "Site Content Model",
    "description": "Registers the site's content model.",
    "restNamespace": "site_content"
  },
  "postTypes": [
    {
      "slug": "objet",
      "kind": "content",
      "singular": "Objet",
      "plural": "Objets",
      "hasArchive": "objets",
      "rewriteSlug": "objets",
      "restBase": "objets",
      "taxonomies": ["objet_category"],
      "meta": [
        { "key": "price_eur", "type": "number", "label": "Price EUR" },
        { "key": "dimensions", "type": "string" },
        { "key": "story", "type": "string", "format": "textarea" }
      ],
      "seed": [
        {
          "slug": "opaline-glass-vase",
          "title": "1960s opaline glass vase",
          "content": "<!-- wp:paragraph --><p>Found near Avignon.</p><!-- /wp:paragraph -->",
          "meta": { "price_eur": 120, "dimensions": "28 cm", "story": "Estate sale outside Avignon." },
          "terms": { "objet_category": ["glass"] }
        }
      ]
    }
  ],
  "taxonomies": [
    {
      "slug": "objet_category",
      "singular": "Object Category",
      "plural": "Object Categories",
      "postTypes": ["objet"],
      "hierarchical": true,
      "terms": [
        { "slug": "glass", "name": "Glass" }
      ]
    }
  ]
}
```

## Post Types

`slug` is the actual WordPress post type key. It must be lowercase and at most 20 characters.

`kind` is:

- `content`: public records shown on the site
- `submission`: private/admin records created by forms or requests

Useful optional keys: `menuName`, `menuIcon`, `supports`, `public`, `showUi`, `showInRest`, `restBase`, `hasArchive`, `rewriteSlug`, `formFields`.

For `submission`, use `formFields` for the public REST route schema when it differs from stored `meta`.

## Fields

Meta/form fields support:

- `key`
- `label`
- `type`: `string`, `boolean`, `integer`, `number`, `array`, `object`
- `format`: `email`, `url`, `textarea`, `date`
- `required`
- `single`
- `description`

The generated plugin registers meta with `show_in_rest` and sanitizes by type/format.

## Generated Plugin Behavior

The generated plugin:

- loads `content-model.json`
- registers CPTs, taxonomies, and post meta on `init`
- registers public REST submit routes for `kind: "submission"` CPTs
- seeds taxonomy terms and entries on activation
- flushes rewrite rules on activation/deactivation
- adds a Tools screen to apply the model again or remove generated seed posts

It does not generate visual blocks. The html-to-blocks skill must still create any query-loop card layouts, object-card blocks, or form blocks that use the model.
