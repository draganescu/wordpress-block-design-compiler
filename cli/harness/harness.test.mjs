import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getHarness, validateAgainstSchema } from './index.mjs';
import { BaseHarness } from './base.mjs';

const SCHEMA = { type: 'object', additionalProperties: false, required: ['n'], properties: { n: { type: 'integer' } } };

test('validateAgainstSchema surfaces a compact error string', () => {
    assert.deepEqual(validateAgainstSchema(SCHEMA, { n: 3 }), { valid: true });
    const bad = validateAgainstSchema(SCHEMA, { n: 'x' });
    assert.equal(bad.valid, false);
    assert.match(bad.errors, /must be integer/);
});

test('mock harness returns validated data', async () => {
    const h = getHarness('mock', { responses: { 'ok': { n: 7 } } });
    const r = await h.complete({ id: 'ok', prompt: 'x', schema: SCHEMA });
    assert.equal(r.ok, true);
    assert.deepEqual(r.data, { n: 7 });
});

test('mock harness retries once then fails on schema-invalid data', async () => {
    const h = getHarness('mock', { responses: { 'bad': { n: 'nope' } } });
    const r = await h.complete({ id: 'bad', prompt: 'x', schema: SCHEMA });
    assert.equal(r.ok, false);
    assert.equal(r.attempts, 2);
    assert.match(r.error, /schema/);
});

test('mock harness fails cleanly when no response is registered', async () => {
    const h = getHarness('mock', { responses: {} });
    const r = await h.complete({ id: 'missing', prompt: 'x', schema: SCHEMA });
    assert.equal(r.ok, false);
});

test('mock harness prefix + default responder lookup', async () => {
    const h = getHarness('mock', { responses: { 'repair:': { n: 1 } }, defaultResponder: () => ({ n: 0 }) });
    assert.deepEqual((await h.complete({ id: 'repair:home:2', prompt: 'x', schema: SCHEMA })).data, { n: 1 });
    assert.deepEqual((await h.complete({ id: 'anything', prompt: 'x', schema: SCHEMA })).data, { n: 0 });
});

test('unknown harness name throws', () => {
    assert.throws(() => getHarness('nope'), /Unknown harness/);
});

test('a timeout fails fast without a second attempt', async () => {
    class TimesOut extends BaseHarness {
        async _invoke() { this.n = (this.n || 0) + 1; return { ok: false, timedOut: true, error: 'timed out' }; }
    }
    const h = new TimesOut({});
    const r = await h.complete({ id: 'x', prompt: 'p', schema: SCHEMA });
    assert.equal(r.ok, false);
    assert.equal(r.timedOut, true);
    assert.equal(r.attempts, 1);
    assert.equal(h.n, 1); // exactly one invocation, no retry
});

test('a non-timeout failure does retry once', async () => {
    class FailsTwice extends BaseHarness {
        async _invoke() { this.n = (this.n || 0) + 1; return { ok: false, error: 'spawn glitch' }; }
    }
    const h = new FailsTwice({});
    const r = await h.complete({ id: 'x', prompt: 'p', schema: SCHEMA });
    assert.equal(r.ok, false);
    assert.equal(h.n, 2);
});
