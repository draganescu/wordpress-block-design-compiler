// MockHarness — a deterministic stand-in for `--dry-run` and tests. It never
// spawns a process; it returns canned structured data keyed by step id, then
// flows through the same base validation as the real harness (so a fixture that
// doesn't match its schema fails loudly in tests, not in production).
//
//   new MockHarness({ responses: { 'plan:index': {...}, 'repair:': (req) => ({...}) } })
//
// Lookup order: exact id, then longest id-prefix, then `defaultResponder(req)`.

import { BaseHarness } from './base.mjs';

export class MockHarness extends BaseHarness {
    constructor(opts = {}) {
        super({ maxConcurrent: opts.maxConcurrent ?? 8, ...opts });
        this.responses = opts.responses || {};
        this.defaultResponder = opts.defaultResponder || null;
        this.log = [];
    }

    async _invoke(req) {
        this.log.push({ id: req.id, prompt: req.prompt });
        const responder = this._lookup(req.id);
        if (responder === undefined) {
            return { ok: false, error: `MockHarness has no response for step "${req.id}".`, raw: null, meta: { costUsd: 0 } };
        }
        const data = typeof responder === 'function' ? await responder(req) : responder;
        return { ok: true, data, raw: { mock: true }, meta: { costUsd: 0, model: 'mock' } };
    }

    _lookup(id) {
        if (id in this.responses) return this.responses[id];
        let best;
        let bestLen = -1;
        for (const key of Object.keys(this.responses)) {
            if (id.startsWith(key) && key.length > bestLen) {
                best = this.responses[key];
                bestLen = key.length;
            }
        }
        if (bestLen >= 0) return best;
        if (this.defaultResponder) return this.defaultResponder;
        return undefined;
    }
}

export default MockHarness;
