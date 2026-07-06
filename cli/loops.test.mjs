import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPlateau, runBoundedLoop } from './loops.mjs';

test('isPlateau needs three points and two small improvements', () => {
    assert.equal(isPlateau([5, 4], 0.3), false); // too few
    assert.equal(isPlateau([5, 4.9, 4.85], 0.3), true); // both improvements < 0.3
    assert.equal(isPlateau([5, 3, 2.5], 0.3), false); // first improvement big
    assert.equal(isPlateau([5, 4.9, 3], 0.3), false); // last improvement big
});

test('runBoundedLoop returns passed on first pass', async () => {
    let builds = 0;
    const r = await runBoundedLoop({
        build: async () => { builds++; return { passed: true, metric: 0.5, report: {} }; },
        repair: async () => true,
    });
    assert.equal(r.status, 'passed');
    assert.equal(r.iters, 1);
    assert.equal(builds, 1);
});

test('runBoundedLoop caps after maxIters without pass', async () => {
    let builds = 0;
    const metrics = [10, 8, 6, 4, 2, 1];
    const r = await runBoundedLoop({
        maxIters: 3,
        build: async () => ({ passed: false, metric: metrics[builds++], report: {} }),
        repair: async () => true,
    });
    assert.equal(r.status, 'capped');
    assert.equal(r.iters, 3);
    assert.equal(builds, 3);
});

test('runBoundedLoop stops on plateau', async () => {
    let builds = 0;
    const metrics = [5, 4.9, 4.85, 4.8];
    const r = await runBoundedLoop({
        maxIters: 6,
        build: async () => ({ passed: false, metric: metrics[builds++], report: {} }),
        repair: async () => true,
    });
    assert.equal(r.status, 'plateau');
});

test('runBoundedLoop reports blocked when repair fails', async () => {
    const r = await runBoundedLoop({
        maxIters: 6,
        build: async () => ({ passed: false, metric: 9, report: {} }),
        repair: async () => false,
    });
    assert.equal(r.status, 'blocked');
    assert.equal(r.iters, 1);
});

test('runBoundedLoop feeds a thrown build error into repair', async () => {
    let repairedWith = null;
    let n = 0;
    const r = await runBoundedLoop({
        maxIters: 3,
        build: async () => { if (n++ === 0) throw new Error('serialize boom'); return { passed: true, metric: 0, report: {} }; },
        repair: async (report) => { repairedWith = report; return true; },
    });
    assert.equal(r.status, 'passed');
    assert.equal(repairedWith.error, 'serialize boom');
});
