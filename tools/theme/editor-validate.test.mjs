// tools/theme/editor-validate.test.mjs — PURE: parse-based validation, no network/WordPress/chromium.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMarkupMap } from './editor-validate.mjs';
import { PLUGIN_ROOT } from '../lib/workspace.mjs';

// A serialized core/paragraph exactly as save() produces it: round-trips clean.
const CLEAN_PARAGRAPH = '<!-- wp:paragraph -->\n<p>Hello world</p>\n<!-- /wp:paragraph -->';

// core/heading with level:2 but saved as <h4>: save() recomputes <h2 class="wp-block-heading">,
// which cannot match the stored <h4>, so parse() sets isValid===false and logs
// "Block validation failed". Confirmed against the registered core block library.
const CORRUPT_HEADING = '<!-- wp:heading {"level":2} -->\n<h4>wrong tag</h4>\n<!-- /wp:heading -->';

test('validateMarkupMap reports zero failures for a clean core block', () => {
    const results = validateMarkupMap({ home: CLEAN_PARAGRAPH }, PLUGIN_ROOT);
    const entry = results.get('home');
    assert.equal(entry.failures, 0);
    assert.deepEqual(entry.samples, []);
});

test('validateMarkupMap flags an invalid block as a failure with a sample', () => {
    const results = validateMarkupMap({ broken: CORRUPT_HEADING }, PLUGIN_ROOT);
    const entry = results.get('broken');
    assert.ok(entry.failures >= 1, `expected >=1 failure, got ${entry.failures}`);
    assert.ok(entry.samples.length >= 1, 'expected at least one sample message');
    assert.ok(entry.samples.length <= 3, 'samples capped at 3');
});

test('validateMarkupMap walks innerBlocks and counts nested invalid blocks', () => {
    const nested = '<!-- wp:group -->\n<div class="wp-block-group">' + CORRUPT_HEADING + '</div>\n<!-- /wp:group -->';
    const results = validateMarkupMap({ page: nested }, PLUGIN_ROOT);
    assert.ok(results.get('page').failures >= 1, 'nested invalid heading should be counted');
});

test('validateMarkupMap returns one Map entry per input slug', () => {
    const results = validateMarkupMap({ a: CLEAN_PARAGRAPH, b: CORRUPT_HEADING }, PLUGIN_ROOT);
    assert.equal(results.size, 2);
    assert.equal(results.get('a').failures, 0);
    assert.ok(results.get('b').failures >= 1);
});
