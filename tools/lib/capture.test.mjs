import test from 'node:test';
import assert from 'node:assert/strict';
import { mapLimit, CAPTURE_CONCURRENCY } from './capture.mjs';

test('mapLimit preserves input order regardless of completion order', async () => {
    // Later items resolve sooner; results must still line up with inputs.
    const items = [30, 10, 20, 0, 5];
    const out = await mapLimit(items, 2, (ms) => new Promise((r) => setTimeout(() => r(ms * 2), ms)));
    assert.deepEqual(out, [60, 20, 40, 0, 10]);
});

test('mapLimit never runs more than `limit` tasks at once', async () => {
    let active = 0;
    let peak = 0;
    const items = Array.from({ length: 12 }, (_, i) => i);
    await mapLimit(items, 3, async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active -= 1;
    });
    assert.equal(peak, 3);
});

test('mapLimit handles an empty list and a limit above the item count', async () => {
    assert.deepEqual(await mapLimit([], 4, async (x) => x), []);
    assert.deepEqual(await mapLimit([1, 2], 10, async (x) => x * 10), [10, 20]);
});

test('mapLimit propagates a task error', async () => {
    await assert.rejects(
        mapLimit([1, 2, 3], 2, async (x) => { if (x === 2) throw new Error('boom'); return x; }),
        /boom/,
    );
});

test('CAPTURE_CONCURRENCY is a positive integer', () => {
    assert.ok(Number.isInteger(CAPTURE_CONCURRENCY) && CAPTURE_CONCURRENCY > 0);
});
