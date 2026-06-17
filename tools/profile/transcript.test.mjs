import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    parseTranscript,
    summarizeTranscript,
    toEpochMs,
    parseEventsFromText,
} from './transcript.mjs';

// A small synthetic transcript exercising the required cases:
// - three real tool calls (use+result pairs)
// - a mix of numeric (epoch ms) and ISO-8601 timestamps
// - a fourth, trailing tool_use with NO matching tool_result (unpaired)
//
// Timeline (epoch ms), chosen so every gap is a clean round number:
//   t=1000  use   A (read)        numeric ms
//   t=1200  result A              ISO string  -> tool_wall A = 200
//   t=1500  use   B (serialize)   ISO string  -> think A = 300
//   t=2300  result B              numeric ms  -> tool_wall B = 800
//   t=2600  use   C (screenshot)  numeric ms  -> think B = 300
//   t=3100  result C              ISO string  -> tool_wall C = 500
//   t=3400  use   D (compare)     ISO string  -> think C = 300, D unpaired
const ISO = (ms) => new Date(ms).toISOString();

function syntheticEvents() {
    return [
        { type: 'tool_use', id: 'a', name: 'read', ts: 1000 },
        { type: 'tool_result', tool_use_id: 'a', ts: ISO(1200) },
        { type: 'tool_use', id: 'b', name: 'serialize', ts: ISO(1500) },
        { type: 'tool_result', tool_use_id: 'b', ts: 2300 },
        { type: 'tool_use', id: 'c', name: 'screenshot', ts: 2600 },
        { type: 'tool_result', tool_use_id: 'c', ts: ISO(3100) },
        // Trailing unpaired tool_use: no result follows.
        { type: 'tool_use', id: 'd', name: 'compare', ts: ISO(3400) },
    ];
}

test('parses 3 paired steps + 1 unpaired trailing tool_use', () => {
    const { steps } = parseTranscript(syntheticEvents());
    assert.equal(steps.length, 4);

    assert.deepEqual(steps[0], { tool: 'read', toolWallMs: 200, agentThinkMs: 300 });
    assert.deepEqual(steps[1], { tool: 'serialize', toolWallMs: 800, agentThinkMs: 300 });
    assert.deepEqual(steps[2], { tool: 'screenshot', toolWallMs: 500, agentThinkMs: 300 });

    // Trailing use: no result -> toolWallMs undefined; no next use -> think undefined.
    assert.equal(steps[3].tool, 'compare');
    assert.equal(steps[3].toolWallMs, undefined);
    assert.equal(steps[3].agentThinkMs, undefined);
});

test('totals sum only the well-defined contributions', () => {
    const { totals } = parseTranscript(syntheticEvents());
    assert.equal(totals.toolWallMs, 200 + 800 + 500); // unpaired D contributes 0
    assert.equal(totals.agentThinkMs, 300 + 300 + 300); // C->D gap counts; D has no think
    // wallMs spans the very first to the very last timestamp.
    assert.equal(totals.wallMs, 3400 - 1000);
});

test('byTool rolls up count and wall per tool name', () => {
    const { byTool } = parseTranscript(syntheticEvents());
    assert.deepEqual(byTool.read, { count: 1, toolWallMs: 200 });
    assert.deepEqual(byTool.serialize, { count: 1, toolWallMs: 800 });
    assert.deepEqual(byTool.screenshot, { count: 1, toolWallMs: 500 });
    // The unpaired use still counts, but adds 0 wall.
    assert.deepEqual(byTool.compare, { count: 1, toolWallMs: 0 });
});

test('robust to interleaved / out-of-order results', () => {
    // Same logical timeline, but the events are shuffled and a result arrives
    // before its corresponding use in array order. Results indexed by id make
    // this order-independent.
    const events = [
        { type: 'tool_result', tool_use_id: 'b', ts: 2300 },
        { type: 'tool_use', id: 'a', name: 'read', ts: 1000 },
        { type: 'tool_use', id: 'b', name: 'serialize', ts: ISO(1500) },
        { type: 'tool_result', tool_use_id: 'a', ts: ISO(1200) },
    ];
    const { steps } = parseTranscript(events);
    // Steps follow tool_use order (a then b), not event order.
    assert.equal(steps[0].tool, 'read');
    assert.equal(steps[0].toolWallMs, 200);
    assert.equal(steps[1].tool, 'serialize');
    assert.equal(steps[1].toolWallMs, 800);
    // think between A's result (1200) and B's use (1500).
    assert.equal(steps[0].agentThinkMs, 300);
});

test('repeated tool names aggregate in byTool', () => {
    const events = [
        { type: 'tool_use', id: '1', name: 'screenshot', ts: 0 },
        { type: 'tool_result', tool_use_id: '1', ts: 100 },
        { type: 'tool_use', id: '2', name: 'screenshot', ts: 200 },
        { type: 'tool_result', tool_use_id: '2', ts: 450 },
    ];
    const { byTool, totals } = parseTranscript(events);
    assert.deepEqual(byTool.screenshot, { count: 2, toolWallMs: 100 + 250 });
    assert.equal(totals.toolWallMs, 350);
});

test('tolerates missing fields, extra fields, and unknown event kinds', () => {
    const events = [
        { type: 'system', note: 'run start', ts: 10 }, // ignored kind
        { type: 'tool_use', id: 'x', name: 'read', ts: 100, extra: { deep: true } },
        { type: 'message', role: 'assistant', ts: 150 }, // ignored kind
        { type: 'tool_result', tool_use_id: 'x', ts: 260, payloadBytes: 42 },
        // A tool_use with no name -> defaults to 'unknown'; no result -> undefined wall.
        { type: 'tool_use', id: 'y', ts: 400 },
    ];
    const { steps, byTool } = parseTranscript(events);
    assert.equal(steps.length, 2);
    assert.equal(steps[0].tool, 'read');
    assert.equal(steps[0].toolWallMs, 160);
    assert.equal(steps[1].tool, 'unknown');
    assert.equal(steps[1].toolWallMs, undefined);
    assert.equal(byTool.unknown.count, 1);
});

test('a tool_use whose result lacks a timestamp yields undefined wall but still pairs', () => {
    const events = [
        { type: 'tool_use', id: 'a', name: 'read', ts: 1000 },
        { type: 'tool_result', tool_use_id: 'a' }, // no ts
        { type: 'tool_use', id: 'b', name: 'serialize', ts: 1500 },
        { type: 'tool_result', tool_use_id: 'b', ts: 1900 },
    ];
    const { steps, totals } = parseTranscript(events);
    assert.equal(steps[0].toolWallMs, undefined);
    // think A->B is undefined because A's result has no ts.
    assert.equal(steps[0].agentThinkMs, undefined);
    assert.equal(steps[1].toolWallMs, 400);
    assert.equal(totals.toolWallMs, 400);
});

test('field-presence fallback: results without explicit type are detected', () => {
    const events = [
        { type: 'tool_use', id: 'a', name: 'read', ts: 0 },
        { tool_use_id: 'a', ts: 120 }, // no type, but tool_use_id implies result
    ];
    const { steps } = parseTranscript(events);
    assert.equal(steps[0].toolWallMs, 120);
});

test('camelCase id/field variants are accepted', () => {
    const events = [
        { type: 'tool_use', id: 'a', toolName: 'read', ts: 0 },
        { type: 'tool_result', toolUseId: 'a', ts: 90 },
    ];
    const { steps } = parseTranscript(events);
    assert.equal(steps[0].tool, 'read');
    assert.equal(steps[0].toolWallMs, 90);
});

test('empty / non-array input is handled gracefully', () => {
    for (const input of [[], null, undefined, {}, 'nope']) {
        const out = parseTranscript(input);
        assert.deepEqual(out.steps, []);
        assert.deepEqual(out.totals, { agentThinkMs: 0, toolWallMs: 0, wallMs: 0 });
        assert.deepEqual(out.byTool, {});
    }
});

// --- toEpochMs unit coverage -------------------------------------------------

test('toEpochMs normalizes numeric, numeric-string, ISO, and Date inputs', () => {
    assert.equal(toEpochMs(1234), 1234);
    assert.equal(toEpochMs('1234'), 1234);
    assert.equal(toEpochMs('1234.5'), 1234.5);
    assert.equal(toEpochMs('1970-01-01T00:00:01.000Z'), 1000);
    assert.equal(toEpochMs(new Date(5000)), 5000);
});

test('toEpochMs returns undefined for unparseable / empty values', () => {
    assert.equal(toEpochMs(undefined), undefined);
    assert.equal(toEpochMs(null), undefined);
    assert.equal(toEpochMs(''), undefined);
    assert.equal(toEpochMs('   '), undefined);
    assert.equal(toEpochMs('not-a-date'), undefined);
    assert.equal(toEpochMs(NaN), undefined);
});

// --- file loading + summarizeTranscript --------------------------------------

test('summarizeTranscript accepts an array directly', () => {
    const out = summarizeTranscript(syntheticEvents());
    assert.equal(out.steps.length, 4);
    assert.equal(out.totals.toolWallMs, 1500);
});

test('summarizeTranscript reads a JSON file', () => {
    const file = path.join(os.tmpdir(), `transcript-${process.pid}-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(syntheticEvents()));
    try {
        const out = summarizeTranscript(file);
        assert.equal(out.steps.length, 4);
        assert.equal(out.totals.agentThinkMs, 900);
    } finally {
        fs.rmSync(file, { force: true });
    }
});

test('summarizeTranscript reads a JSONL file and skips bad lines', () => {
    const file = path.join(os.tmpdir(), `transcript-${process.pid}-${Date.now()}.jsonl`);
    const lines = syntheticEvents().map((e) => JSON.stringify(e));
    // Inject a blank line and a junk line that must be skipped.
    lines.splice(2, 0, '', 'not json at all {');
    fs.writeFileSync(file, lines.join('\n') + '\n');
    try {
        const out = summarizeTranscript(file);
        assert.equal(out.steps.length, 4);
        assert.equal(out.totals.toolWallMs, 1500);
    } finally {
        fs.rmSync(file, { force: true });
    }
});

test('parseEventsFromText unwraps an { events: [...] } envelope', () => {
    const text = JSON.stringify({ events: syntheticEvents(), runId: 'abc' });
    const events = parseEventsFromText(text);
    const out = parseTranscript(events);
    assert.equal(out.steps.length, 4);
});

test('summarizeTranscript rejects unsupported input types', () => {
    assert.throws(() => summarizeTranscript(42), TypeError);
});
