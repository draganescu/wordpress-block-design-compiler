import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scaffoldContentModelPlugin, validateContentModel } from './model.mjs';

function workspace() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'content-model-'));
    fs.mkdirSync(path.join(root, 'content-model'), { recursive: true });
    fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
    return root;
}

function writeModel(root, model) {
    fs.writeFileSync(path.join(root, 'content-model/content-model.json'), `${JSON.stringify(model, null, 2)}\n`);
}

test('validateContentModel accepts content and submission CPTs with taxonomies and seed entries', () => {
    const root = workspace();
    writeModel(root, fixtureModel());

    const report = validateContentModel({ workspaceRoot: root });

    assert.equal(report.valid, true);
    assert.equal(report.counts.postTypes, 2);
    assert.equal(report.counts.taxonomies, 1);
    assert.equal(report.counts.metaFields, 5);
    assert.equal(report.counts.seedEntries, 3);
    assert.ok(fs.existsSync(path.join(root, 'reports/content-model-validation.json')));
});

test('validateContentModel rejects invalid WordPress slugs and bad references', () => {
    const root = workspace();
    writeModel(root, {
        plugin: { slug: 'bad content model', name: 'Bad Model' },
        postTypes: [
            { slug: 'this_post_type_slug_is_far_too_long', singular: 'Thing', plural: 'Things' },
        ],
        taxonomies: [
            { slug: 'topic', postTypes: ['missing_type'] },
        ],
    });

    const report = validateContentModel({ workspaceRoot: root });

    assert.equal(report.valid, false);
    assert.ok(report.errors.some((error) => error.includes('plugin.slug')));
    assert.ok(report.errors.some((error) => error.includes('WordPress max is 20')));
    assert.ok(report.errors.some((error) => error.includes('unknown post type')));
});

test('scaffoldContentModelPlugin writes an installable plugin and embedded manifest', () => {
    const root = workspace();
    writeModel(root, fixtureModel());

    const result = scaffoldContentModelPlugin({ workspaceRoot: root });

    assert.ok(fs.existsSync(result.pluginFile));
    assert.ok(fs.existsSync(path.join(result.pluginRoot, 'content-model.json')));
    assert.ok(fs.existsSync(path.join(root, 'content-model/plugin-manifest.json')));
    const php = fs.readFileSync(result.pluginFile, 'utf8');
    assert.match(php, /Plugin Name: Maison Clouet Content Model/);
    assert.match(php, /register_post_type/);
    assert.match(php, /register_taxonomy/);
    assert.match(php, /register_post_meta/);
    assert.match(php, /register_rest_route/);
    assert.match(php, /register_activation_hook/);
    assert.match(php, /add_management_page/);
    assert.match(php, /maison_clouet_content_apply_content_model/);
});

function fixtureModel() {
    return {
        version: 1,
        plugin: {
            slug: 'maison-clouet-content',
            name: 'Maison Clouet Content Model',
            restNamespace: 'maison_clouet',
        },
        postTypes: [
            {
                slug: 'objet',
                kind: 'content',
                singular: 'Objet',
                plural: 'Objets',
                hasArchive: 'objets',
                rewriteSlug: 'objets',
                taxonomies: ['objet_category'],
                meta: [
                    { key: 'price_eur', type: 'number', label: 'Price EUR' },
                    { key: 'dimensions', type: 'string' },
                    { key: 'condition', type: 'string' },
                    { key: 'story', type: 'string', format: 'textarea' },
                ],
                seed: [
                    {
                        slug: 'opaline-glass-vase',
                        title: '1960s opaline glass vase',
                        content: '<!-- wp:paragraph --><p>Found outside Avignon.</p><!-- /wp:paragraph -->',
                        meta: { price_eur: 120, dimensions: '28 cm', condition: 'light wear', story: 'Estate sale outside Avignon.' },
                        terms: { objet_category: ['glass'] },
                    },
                    {
                        slug: 'indigo-linen-napkins',
                        title: 'Stack of indigo linen napkins',
                        content: '<!-- wp:paragraph --><p>Washed linen from Arles.</p><!-- /wp:paragraph -->',
                        meta: { price_eur: 68, dimensions: 'set of 8', condition: 'excellent', story: 'Market table in Arles.' },
                        terms: { objet_category: ['textiles'] },
                    },
                ],
            },
            {
                slug: 'sourcing_request',
                kind: 'submission',
                singular: 'Sourcing Request',
                plural: 'Sourcing Requests',
                meta: [
                    { key: 'email', type: 'string', format: 'email', required: true },
                ],
                formFields: [
                    { key: 'name', type: 'string', required: true },
                    { key: 'email', type: 'string', format: 'email', required: true },
                    { key: 'message', type: 'string', format: 'textarea', required: true },
                ],
                seed: [
                    {
                        slug: 'hotel-lamp-request',
                        title: 'Hotel lamp request',
                        content: 'Looking for two brass bedside lamps.',
                        meta: { email: 'hotel@example.com' },
                    },
                ],
            },
        ],
        taxonomies: [
            {
                slug: 'objet_category',
                singular: 'Object Category',
                plural: 'Object Categories',
                postTypes: ['objet'],
                terms: [
                    { slug: 'glass', name: 'Glass' },
                    { slug: 'textiles', name: 'Textiles' },
                ],
            },
        ],
    };
}
