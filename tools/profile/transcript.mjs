// P3 — Agent-step transcript parser (see docs/profiling-plan.md, P3 section).
//
// A skill run is an agent loop: the model reasons, emits a tool_use, an MCP tool
// executes, a tool_result returns, the model reasons again. To close the loop on
// total wall-clock we attribute time to two buckets, post-hoc, from the session
// transcript:
//
//   tool_wall   = tool_result.ts - tool_use.ts          (time the agent waited)
//   agent_think = next(tool_use).ts - prev(tool_result).ts  (model reasoning gap)
//
// The parser pairs each tool_use with its matching tool_result by id, is robust
// to interleaved events (results arriving out of order, other event kinds mixed
// in), and tolerates missing/extra fields. The final step often has no following
// tool_use (the run ended on a result), so its agentThinkMs is left undefined.
//
// Pure functions only; no IO except summarizeTranscript(path), which reads a
// JSON or JSONL file and delegates to parseTranscript.

import fs from 'node:fs';

// --- timestamp coercion ------------------------------------------------------

// Accept either epoch milliseconds (number or numeric string) or an ISO-8601
// string and normalize to epoch ms. Returns undefined for anything we cannot
// confidently interpret, so a single malformed stamp degrades one step rather
// than poisoning the whole parse.
export function toEpochMs(value) {
    if (value === null || value === undefined) return undefined;

    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : undefined;
    }

    if (value instanceof Date) {
        const ms = value.getTime();
        return Number.isNaN(ms) ? undefined : ms;
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed === '') return undefined;

        // A bare numeric string is epoch ms (possibly fractional); an ISO string
        // is not fully numeric, so this split is unambiguous.
        if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
            const n = Number(trimmed);
            return Number.isFinite(n) ? n : undefined;
        }

        const ms = Date.parse(trimmed);
        return Number.isNaN(ms) ? undefined : ms;
    }

    return undefined;
}

// Pull a timestamp off an event regardless of which common field name it uses.
function eventTs(event) {
    if (!event || typeof event !== 'object') return undefined;
    const candidates = [
        event.ts,
        event.timestamp,
        event.time,
        event.t,
        event.epochMs,
        event.tsEpochMs,
    ];
    for (const c of candidates) {
        const ms = toEpochMs(c);
        if (ms !== undefined) return ms;
    }
    return undefined;
}

// --- event classification ----------------------------------------------------

// Determine whether an event is a tool_use, a tool_result, or neither. We accept
// both an explicit `type` field and the shape some transcripts use where the
// kind lives on a nested `content` block; we also fall back to field presence
// (a tool_use_id strongly implies a result).
function classify(event) {
    if (!event || typeof event !== 'object') return null;

    const raw =
        event.type ||
        event.event ||
        event.kind ||
        (event.content && typeof event.content === 'object' && event.content.type);

    const type = typeof raw === 'string' ? raw.toLowerCase() : '';

    if (type === 'tool_use' || type === 'tooluse') return 'tool_use';
    if (type === 'tool_result' || type === 'toolresult') return 'tool_result';

    // Field-presence fallbacks for transcripts that omit an explicit type.
    if (event.tool_use_id !== undefined || event.toolUseId !== undefined) {
        return 'tool_result';
    }
    return null;
}

// The id that links a tool_use to its tool_result. A tool_use carries its own
// id; a tool_result references it via tool_use_id (snake or camel).
function useId(event) {
    return firstDefined(event.id, event.tool_use_id, event.toolUseId, event.tool_id);
}

function resultId(event) {
    return firstDefined(event.tool_use_id, event.toolUseId, event.id, event.tool_id);
}

function toolName(event) {
    return firstDefined(event.name, event.tool, event.tool_name, event.toolName) ?? 'unknown';
}

function firstDefined(...values) {
    for (const v of values) {
        if (v !== undefined && v !== null) return v;
    }
    return undefined;
}

// --- core parser -------------------------------------------------------------

// parseTranscript(events) -> { steps, totals, byTool }
//
// steps:  one per tool_use, in tool_use order, with toolWallMs (undefined if the
//         result is missing) and agentThinkMs (undefined for the final step or
//         when the bounding timestamps are missing).
// totals: summed agentThinkMs and toolWallMs, plus wallMs spanning the first to
//         the last timestamp seen anywhere in the transcript.
// byTool: per-tool { count, toolWallMs } rollup.
export function parseTranscript(events) {
    const list = Array.isArray(events) ? events : [];

    // First pass: index tool_result events by their referenced tool_use id and
    // collect tool_use events in their original order. Indexing results up front
    // makes the parser order-independent (results may arrive before, after, or
    // interleaved with later uses).
    const resultById = new Map();
    const uses = [];
    let minTs = Infinity;
    let maxTs = -Infinity;

    for (const event of list) {
        const ts = eventTs(event);
        if (ts !== undefined) {
            if (ts < minTs) minTs = ts;
            if (ts > maxTs) maxTs = ts;
        }

        const kind = classify(event);
        if (kind === 'tool_use') {
            uses.push({ event, ts, id: useId(event) });
        } else if (kind === 'tool_result') {
            const id = resultId(event);
            // Keep the first result seen for an id; duplicates are ignored.
            if (id !== undefined && !resultById.has(id)) {
                resultById.set(id, { event, ts });
            }
        }
    }

    // Second pass: build one step per tool_use, pairing by id.
    const steps = [];
    for (const use of uses) {
        const matched = use.id !== undefined ? resultById.get(use.id) : undefined;
        const resultTs = matched ? matched.ts : undefined;

        const toolWallMs =
            use.ts !== undefined && resultTs !== undefined ? resultTs - use.ts : undefined;

        steps.push({
            tool: toolName(use.event),
            id: use.id,
            useTs: use.ts,
            resultTs,
            toolWallMs,
            agentThinkMs: undefined, // filled in below once we know the next use
        });
    }

    // Third pass: agent_think for step i is the gap between its tool_result and
    // the next step's tool_use. The final step has no successor, so it stays
    // undefined — that is the correct "run ended on a result" / unpaired-trailing
    // -use behaviour the plan calls for.
    for (let i = 0; i < steps.length - 1; i += 1) {
        const cur = steps[i];
        const next = steps[i + 1];
        if (cur.resultTs !== undefined && next.useTs !== undefined) {
            cur.agentThinkMs = next.useTs - cur.resultTs;
        }
    }

    // Totals + per-tool rollup. Undefined contributions are simply skipped so a
    // missing result never NaN-poisons the aggregate.
    const totals = { agentThinkMs: 0, toolWallMs: 0, wallMs: 0 };
    const byTool = {};

    for (const step of steps) {
        if (Number.isFinite(step.toolWallMs)) {
            totals.toolWallMs += step.toolWallMs;
        }
        if (Number.isFinite(step.agentThinkMs)) {
            totals.agentThinkMs += step.agentThinkMs;
        }

        const bucket = byTool[step.tool] || (byTool[step.tool] = { count: 0, toolWallMs: 0 });
        bucket.count += 1;
        if (Number.isFinite(step.toolWallMs)) {
            bucket.toolWallMs += step.toolWallMs;
        }
    }

    totals.wallMs = maxTs >= minTs && Number.isFinite(minTs) ? maxTs - minTs : 0;

    // The public step shape is intentionally the three documented fields; the
    // intermediate useTs/resultTs/id are dropped to keep the contract clean.
    const publicSteps = steps.map((s) => ({
        tool: s.tool,
        toolWallMs: s.toolWallMs,
        agentThinkMs: s.agentThinkMs,
    }));

    return { steps: publicSteps, totals, byTool };
}

// --- file loading ------------------------------------------------------------

// Parse a transcript file that is either a JSON array (or an object with an
// `events`/`messages`/`transcript` array) or JSONL (one event per line). We try
// strict JSON first, then fall back to line-by-line so a single bad line in a
// JSONL stream is skipped rather than aborting the whole parse.
export function parseEventsFromText(text) {
    const trimmed = text.trim();
    if (trimmed === '') return [];

    try {
        const parsed = JSON.parse(trimmed);
        return coerceToEventArray(parsed);
    } catch {
        // Not a single JSON document — treat as JSONL.
    }

    const events = [];
    for (const line of trimmed.split(/\r?\n/)) {
        const candidate = line.trim();
        if (candidate === '') continue;
        try {
            events.push(JSON.parse(candidate));
        } catch {
            // Skip unparseable lines (partial flushes, comments, blank framing).
        }
    }
    return events;
}

function coerceToEventArray(parsed) {
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') {
        for (const key of ['events', 'messages', 'transcript', 'entries']) {
            if (Array.isArray(parsed[key])) return parsed[key];
        }
    }
    return [];
}

// summarizeTranscript(input): accept an already-parsed array, or a filesystem
// path to a JSON/JSONL transcript, and return the parseTranscript summary.
export function summarizeTranscript(input) {
    if (Array.isArray(input)) {
        return parseTranscript(input);
    }
    if (typeof input === 'string') {
        const text = fs.readFileSync(input, 'utf8');
        return parseTranscript(parseEventsFromText(text));
    }
    throw new TypeError('summarizeTranscript expects an events array or a file path');
}

// --- CLI ---------------------------------------------------------------------
//
// `node tools/profile/transcript.mjs <path>` prints the JSON summary to stdout.
// This module has no MCP-stdout constraint (it is not the MCP server), so a CLI
// print here is fine.
function isMainModule() {
    if (!process.argv[1]) return false;
    try {
        return import.meta.url === new URL(`file://${process.argv[1]}`).href;
    } catch {
        return false;
    }
}

if (isMainModule()) {
    const pathArg = process.argv[2];
    if (!pathArg) {
        process.stderr.write('usage: node tools/profile/transcript.mjs <transcript.json|.jsonl>\n');
        process.exit(1);
    }
    try {
        const summary = summarizeTranscript(pathArg);
        process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
    } catch (err) {
        process.stderr.write(`transcript: ${err && err.message ? err.message : String(err)}\n`);
        process.exit(1);
    }
}
