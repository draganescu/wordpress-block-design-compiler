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

test('runBoundedLoop keep-best restores the best iteration when repairs regress', async () => {
    let state = 'v1';
    let restoredTo = null;
    const metricOf = { v1: 5, v2: 12 };
    const r = await runBoundedLoop({
        maxIters: 2,
        build: async () => ({ passed: false, metric: metricOf[state], report: { state } }),
        repair: async () => { state = 'v2'; return true; },
        snapshot: async () => state,
        restore: async (s) => { restoredTo = s; state = s; },
    });
    assert.equal(r.status, 'capped');
    assert.equal(r.restored, true);
    assert.equal(restoredTo, 'v1');
    assert.equal(r.metric, 5, 'reports the rebuilt (restored) metric, not the regressed one');
});

test('runBoundedLoop keep-best leaves an improving run untouched', async () => {
    let state = 'v1';
    let restored = false;
    const metricOf = { v1: 12, v2: 5 };
    const r = await runBoundedLoop({
        maxIters: 2,
        build: async () => ({ passed: false, metric: metricOf[state], report: {} }),
        repair: async () => { state = 'v2'; return true; },
        snapshot: async () => state,
        restore: async () => { restored = true; },
    });
    assert.equal(r.status, 'capped');
    assert.equal(r.metric, 5);
    assert.equal(restored, false);
});

test('runBoundedLoop restores best when the final build throws', async () => {
    let builds = 0;
    let state = 'good';
    const r = await runBoundedLoop({
        maxIters: 2,
        build: async () => {
            builds++;
            if (state === 'broken') throw new Error('serialize boom');
            return { passed: false, metric: 7, report: {} };
        },
        repair: async () => { state = 'broken'; return true; },
        snapshot: async () => state,
        restore: async (s) => { state = s; },
    });
    assert.equal(state, 'good', 'broken artifacts never survive as the final state');
    assert.equal(r.restored, true);
    assert.equal(r.metric, 7);
});

test('runBoundedLoop ends as skipped when shouldRepair declines', async () => {
    let repairs = 0;
    const r = await runBoundedLoop({
        maxIters: 6,
        build: async () => ({ passed: false, metric: 50, report: {} }),
        repair: async () => { repairs++; return true; },
        shouldRepair: (result) => result.metric <= 20,
    });
    assert.equal(r.status, 'skipped');
    assert.equal(r.iters, 1);
    assert.equal(repairs, 0);
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
