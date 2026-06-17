import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
    isOn,
    isDeep,
    isNet,
    span,
    mark,
    measure,
    record,
    setRunMeta,
    flush,
    toSpeedscope,
} from './profile.mjs';

// Snapshot and restore the env vars the module reads so each test is isolated.
const PROFILE_KEYS = ['WBDC_PROFILE', 'WBDC_PROFILE_NET', 'WBDC_PROFILE_DIR'];
let _savedEnv;

beforeEach(() => {
    _savedEnv = {};
    for (const k of PROFILE_KEYS) _savedEnv[k] = process.env[k];
    for (const k of PROFILE_KEYS) delete process.env[k];
});

afterEach(() => {
    for (const k of PROFILE_KEYS) {
        if (_savedEnv[k] === undefined) delete process.env[k];
        else process.env[k] = _savedEnv[k];
    }
});

// A profiling run always ends by flushing whatever is buffered to a scratch dir,
// keeping per-test buffer state from leaking into the next test or the real
// reports/profile dir. Always async-aware: if fn returns a promise we await it
// before cleaning up, so the cleanup never races an async test body (which would
// flush and recreate the dir after rmSync ran).
async function withScratchDir(fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wbdc-profile-'));
    process.env.WBDC_PROFILE_DIR = dir;
    try {
        return await fn(dir);
    } finally {
        try {
            flush();
        } catch {
            // ignore
        }
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

function readSpansFile(dir) {
    const file = path.join(dir, `spans-${process.pid}.jsonl`);
    const text = fs.readFileSync(file, 'utf8');
    return text
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line));
}

// --- env gates ---------------------------------------------------------------

test('isOn reads the accepted truthy WBDC_PROFILE values', () => {
    for (const v of ['on', 'deep', '1', 'true']) {
        process.env.WBDC_PROFILE = v;
        assert.equal(isOn(), true, `expected isOn() true for ${v}`);
    }
    for (const v of ['off', '0', 'false', 'yes', '']) {
        process.env.WBDC_PROFILE = v;
        assert.equal(isOn(), false, `expected isOn() false for ${v}`);
    }
    delete process.env.WBDC_PROFILE;
    assert.equal(isOn(), false);
});

test('isDeep is true only for the literal "deep"', () => {
    process.env.WBDC_PROFILE = 'deep';
    assert.equal(isDeep(), true);
    for (const v of ['on', '1', 'true', 'off', '']) {
        process.env.WBDC_PROFILE = v;
        assert.equal(isDeep(), false, `expected isDeep() false for ${v}`);
    }
});

test('isNet is true only when WBDC_PROFILE_NET === "1"', () => {
    process.env.WBDC_PROFILE_NET = '1';
    assert.equal(isNet(), true);
    for (const v of ['0', 'true', 'on', '']) {
        process.env.WBDC_PROFILE_NET = v;
        assert.equal(isNet(), false, `expected isNet() false for ${v}`);
    }
    delete process.env.WBDC_PROFILE_NET;
    assert.equal(isNet(), false);
});

// --- span: pass-through no-op when off ---------------------------------------

test('span is a transparent pass-through no-op when profiling is off', async () => {
    await withScratchDir((dir) => {
        // off: returns fn() and records nothing.
        const out = span('should-not-record', () => 21 * 2, { phase: 'x' });
        assert.equal(out, 42);
        // flush() with an empty buffer writes nothing.
        flush();
        assert.equal(fs.existsSync(path.join(dir, `spans-${process.pid}.jsonl`)), false);
    });
});

test('span returns the async result and records nothing when off', async () => {
    await withScratchDir(async (dir) => {
        const out = await span('async-off', async () => {
            return 'value';
        });
        assert.equal(out, 'value');
        flush();
        assert.equal(fs.existsSync(path.join(dir, `spans-${process.pid}.jsonl`)), false);
    });
});

// --- span: timing, nesting depth, return passthrough ------------------------

test('span records a sync result with depth 0 and a non-negative duration', async () => {
    process.env.WBDC_PROFILE = 'on';
    await withScratchDir((dir) => {
        const out = span('sync', () => 7, { tool: 'demo' });
        assert.equal(out, 7);
        flush();
        const rows = readSpansFile(dir);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].label, 'sync');
        assert.equal(rows[0].depth, 0);
        assert.ok(rows[0].durMs >= 0);
        assert.deepEqual(rows[0].meta, { tool: 'demo' });
        assert.equal(rows[0].pid, process.pid);
        assert.ok(Number.isFinite(rows[0].tsEpochMs));
    });
});

test('span awaits an async fn, passes the resolved value, records duration', async () => {
    process.env.WBDC_PROFILE = 'on';
    await withScratchDir(async (dir) => {
        const out = await span('async', async () => {
            await new Promise((r) => setTimeout(r, 5));
            return { ok: true };
        });
        assert.deepEqual(out, { ok: true });
        flush();
        const rows = readSpansFile(dir);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].label, 'async');
        assert.equal(rows[0].depth, 0);
        // The fn slept ~5ms; duration must reflect the await, not return instantly.
        assert.ok(rows[0].durMs >= 4, `durMs was ${rows[0].durMs}`);
    });
});

test('nested span() calls record increasing depth for flamegraph nesting', async () => {
    process.env.WBDC_PROFILE = 'deep';
    await withScratchDir((dir) => {
        const out = span('outer', () => {
            const inner = span('inner', () => {
                return span('innermost', () => 'leaf');
            });
            return inner;
        });
        assert.equal(out, 'leaf');
        flush();
        const rows = readSpansFile(dir);
        const byLabel = Object.fromEntries(rows.map((r) => [r.label, r]));
        assert.equal(byLabel.outer.depth, 0);
        assert.equal(byLabel.inner.depth, 1);
        assert.equal(byLabel.innermost.depth, 2);
        // Children complete (and so are recorded) before their parents.
        const order = rows.map((r) => r.label);
        assert.deepEqual(order, ['innermost', 'inner', 'outer']);
    });
});

test('the depth counter resets to 0 after a thrown span and sibling spans stay flat', async () => {
    process.env.WBDC_PROFILE = 'deep';
    await withScratchDir((dir) => {
        assert.throws(() => {
            span('boom', () => {
                throw new Error('kaboom');
            });
        }, /kaboom/);
        // A sibling span after the throw must be back at depth 0, not leaked deeper.
        span('after', () => 1);
        flush();
        const rows = readSpansFile(dir);
        const byLabel = Object.fromEntries(rows.map((r) => [r.label, r]));
        assert.equal(byLabel.boom.depth, 0);
        assert.equal(byLabel.after.depth, 0);
    });
});

test('span unwinds depth when an async fn rejects', async () => {
    process.env.WBDC_PROFILE = 'deep';
    await withScratchDir(async (dir) => {
        await assert.rejects(
            span('async-boom', async () => {
                throw new Error('async-kaboom');
            }),
            /async-kaboom/,
        );
        span('after-async', () => 1);
        flush();
        const rows = readSpansFile(dir);
        const byLabel = Object.fromEntries(rows.map((r) => [r.label, r]));
        assert.equal(byLabel['async-boom'].depth, 0);
        assert.equal(byLabel['after-async'].depth, 0);
    });
});

// --- mark / measure ----------------------------------------------------------

test('mark returns null and measure is a no-op when profiling is off', async () => {
    await withScratchDir((dir) => {
        const token = mark('off-mark');
        assert.equal(token, null);
        measure(token, { ignored: true });
        flush();
        assert.equal(fs.existsSync(path.join(dir, `spans-${process.pid}.jsonl`)), false);
    });
});

test('mark/measure records a span with the captured label and meta', async () => {
    process.env.WBDC_PROFILE = 'on';
    await withScratchDir((dir) => {
        const token = mark('manual');
        assert.ok(token && token.label === 'manual');
        measure(token, { phase: 'manual-measure' });
        flush();
        const rows = readSpansFile(dir);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].label, 'manual');
        assert.equal(rows[0].depth, 0);
        assert.ok(rows[0].durMs >= 0);
        assert.deepEqual(rows[0].meta, { phase: 'manual-measure' });
    });
});

// --- record ------------------------------------------------------------------

test('record stores a precomputed duration event when on, nothing when off', async () => {
    // off
    await withScratchDir((dir) => {
        record('subprocess', 123.5, { kind: 'spawn' });
        flush();
        assert.equal(fs.existsSync(path.join(dir, `spans-${process.pid}.jsonl`)), false);
    });
    // on
    process.env.WBDC_PROFILE = 'on';
    await withScratchDir((dir) => {
        record('subprocess', 123.5, { kind: 'spawn' });
        flush();
        const rows = readSpansFile(dir);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].label, 'subprocess');
        assert.equal(rows[0].durMs, 123.5);
        assert.deepEqual(rows[0].meta, { kind: 'spawn' });
    });
});

// --- flush: JSONL output, run meta, buffer clearing, idempotency -------------

test('flush writes valid JSONL with run meta and clears the buffer', async () => {
    process.env.WBDC_PROFILE = 'on';
    await withScratchDir((dir) => {
        setRunMeta({ tool: 'html-to-blocks', mode: 'batch' });
        setRunMeta({ cold: true }); // shallow-merge, keeps tool + mode
        record('a', 1, { i: 0 });
        record('b', 2, { i: 1 });

        flush();
        const rows = readSpansFile(dir);
        assert.equal(rows.length, 2);
        for (const row of rows) {
            assert.equal(row.pid, process.pid);
            assert.deepEqual(row.run, { tool: 'html-to-blocks', mode: 'batch', cold: true });
            assert.ok(Number.isFinite(row.tsEpochMs));
            assert.ok('label' in row && 'durMs' in row && 'depth' in row);
        }
        assert.deepEqual(rows.map((r) => r.label), ['a', 'b']);

        // Buffer cleared: a second flush with no new spans writes nothing more.
        flush();
        const rowsAfter = readSpansFile(dir);
        assert.equal(rowsAfter.length, 2);

        // New spans after a flush append to the same file.
        record('c', 3);
        flush();
        const rowsAppended = readSpansFile(dir);
        assert.equal(rowsAppended.length, 3);
        assert.equal(rowsAppended[2].label, 'c');
    });
});

test('flush creates the WBDC_PROFILE_DIR (mkdir -p) when it does not exist', () => {
    process.env.WBDC_PROFILE = 'on';
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wbdc-profile-'));
    const nested = path.join(base, 'deeply', 'nested', 'dir');
    process.env.WBDC_PROFILE_DIR = nested;
    try {
        record('x', 1);
        flush();
        assert.ok(fs.existsSync(path.join(nested, `spans-${process.pid}.jsonl`)));
        const rows = readSpansFile(nested);
        assert.equal(rows.length, 1);
    } finally {
        flush();
        fs.rmSync(base, { recursive: true, force: true });
    }
});

test('flush on an empty buffer is idempotent and writes no file', async () => {
    process.env.WBDC_PROFILE = 'on';
    await withScratchDir((dir) => {
        flush();
        flush();
        assert.equal(fs.existsSync(path.join(dir, `spans-${process.pid}.jsonl`)), false);
    });
});

// --- toSpeedscope: pure conversion, valid open/close pairs -------------------

test('toSpeedscope returns an empty-but-valid profile for no spans', () => {
    const out = toSpeedscope([]);
    assert.equal(out.$schema, 'https://www.speedscope.app/file-format-schema.json');
    assert.deepEqual(out.shared.frames, []);
    assert.equal(out.profiles.length, 1);
    const p = out.profiles[0];
    assert.equal(p.type, 'evented');
    assert.equal(p.unit, 'milliseconds');
    assert.deepEqual(p.events, []);
});

test('toSpeedscope is pure: it does not mutate its input', () => {
    const spans = [{ label: 'a', durMs: 10, depth: 0, tsEpochMs: 1000 }];
    const snapshot = JSON.parse(JSON.stringify(spans));
    toSpeedscope(spans);
    assert.deepEqual(spans, snapshot);
});

test('toSpeedscope emits one open and one close per span, with deduped frames', () => {
    const spans = [
        { label: 'outer', durMs: 10, depth: 0, tsEpochMs: 1000 },
        { label: 'inner', durMs: 4, depth: 1, tsEpochMs: 1002 },
        { label: 'outer', durMs: 2, depth: 0, tsEpochMs: 1020 }, // repeated label
    ];
    const out = toSpeedscope(spans);

    // Frames deduplicated by label: 'outer' and 'inner' only.
    assert.deepEqual(out.shared.frames.map((f) => f.name), ['outer', 'inner']);

    const events = out.profiles[0].events;
    assert.equal(events.length, spans.length * 2);
    const opens = events.filter((e) => e.type === 'O');
    const closes = events.filter((e) => e.type === 'C');
    assert.equal(opens.length, spans.length);
    assert.equal(closes.length, spans.length);

    // Every frame index referenced is a valid index into shared.frames.
    for (const e of events) {
        assert.ok(e.frame >= 0 && e.frame < out.shared.frames.length);
        assert.ok(Number.isFinite(e.at));
    }
});

test('toSpeedscope events are chronologically non-decreasing and well-nested', () => {
    const spans = [
        { label: 'outer', durMs: 10, depth: 0, tsEpochMs: 1000 }, // [1000, 1010]
        { label: 'inner', durMs: 4, depth: 1, tsEpochMs: 1002 }, //  [1002, 1006]
    ];
    const out = toSpeedscope(spans);
    const events = out.profiles[0].events;

    // Chronological order.
    for (let i = 1; i < events.length; i++) {
        assert.ok(events[i].at >= events[i - 1].at, `event ${i} went backwards in time`);
    }

    // Well-nested: replay with a stack; every close matches the top-of-stack open.
    const stack = [];
    for (const e of events) {
        if (e.type === 'O') {
            stack.push(e.frame);
        } else {
            assert.ok(stack.length > 0, 'close with empty stack');
            assert.equal(stack.pop(), e.frame, 'close did not match the open on top of the stack');
        }
    }
    assert.equal(stack.length, 0, 'unclosed frames remain on the stack');

    // startValue/endValue bound the timeline.
    assert.equal(out.profiles[0].startValue, 1000);
    assert.equal(out.profiles[0].endValue, 1010);
});

test('toSpeedscope round-trips spans recorded by real nested span() calls', async () => {
    process.env.WBDC_PROFILE = 'deep';
    await withScratchDir((dir) => {
        span('A', () => {
            span('B', () => 1);
            span('C', () => 2);
            return 3;
        });
        flush();
        const rows = readSpansFile(dir);
        const out = toSpeedscope(rows);

        const events = out.profiles[0].events;
        assert.equal(events.length, rows.length * 2);

        // Replay for proper nesting.
        const stack = [];
        for (const e of events) {
            if (e.type === 'O') stack.push(e.frame);
            else assert.equal(stack.pop(), e.frame);
        }
        assert.equal(stack.length, 0);
    });
});
