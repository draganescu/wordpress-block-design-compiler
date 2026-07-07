#!/usr/bin/env node
// Summarize a run's reports/timings.json into a per-phase time profile.
//
//   node tools/profile/timings-summary.mjs <workspace> [<workspace2> ...]
//
// For each phase (site_design, page_design, author, repair, ...) it reports the
// call count, the summed call time, and the merged wall-clock coverage (union
// of the call intervals) — the number that actually moves the run's duration
// when calls overlap. Passing several workspaces prints them side by side.

import fs from 'node:fs';
import path from 'node:path';

function phaseOf(id) {
    return String(id).split(':')[0];
}

function mergedMs(intervals) {
    const sorted = intervals.slice().sort((a, b) => a[0] - b[0]);
    let total = 0;
    let curStart = null;
    let curEnd = null;
    for (const [s, e] of sorted) {
        if (curStart === null) { curStart = s; curEnd = e; continue; }
        if (s <= curEnd) { curEnd = Math.max(curEnd, e); continue; }
        total += curEnd - curStart;
        curStart = s; curEnd = e;
    }
    if (curStart !== null) total += curEnd - curStart;
    return total;
}

function fmt(ms) {
    if (ms === null || ms === undefined) return '-';
    const s = ms / 1000;
    if (s < 90) return `${s.toFixed(0)}s`;
    return `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, '0')}s`;
}

function summarize(workspace) {
    const file = path.join(workspace, 'reports/timings.json');
    if (!fs.existsSync(file)) return null;
    const t = JSON.parse(fs.readFileSync(file, 'utf8'));

    const groups = new Map();
    for (const c of t.harnessCalls || []) {
        const key = phaseOf(c.id);
        const g = groups.get(key) || { calls: 0, fails: 0, sumMs: 0, intervals: [], costUsd: 0 };
        g.calls++;
        if (!c.ok) g.fails++;
        g.sumMs += c.elapsedMs || 0;
        const start = Date.parse(c.startedAt);
        g.intervals.push([start, start + (c.elapsedMs || 0)]);
        g.costUsd += c.costUsd || 0;
        groups.set(key, g);
    }

    const tools = new Map();
    for (const c of t.toolCalls || []) {
        const g = tools.get(c.name) || { calls: 0, sumMs: 0, intervals: [] };
        g.calls++;
        g.sumMs += c.elapsedMs || 0;
        const start = Date.parse(c.startedAt);
        g.intervals.push([start, start + (c.elapsedMs || 0)]);
        tools.set(c.name, g);
    }

    const allIntervals = [...groups.values(), ...tools.values()].flatMap((g) => g.intervals);
    return {
        workspace,
        wallMs: Date.parse(t.wroteAt) - Date.parse(t.startedAt),
        busyMs: mergedMs(allIntervals),
        llmMs: mergedMs([...groups.values()].flatMap((g) => g.intervals)),
        costUsd: [...groups.values()].reduce((a, g) => a + g.costUsd, 0),
        groups, tools,
    };
}

for (const ws of process.argv.slice(2)) {
    const s = summarize(ws);
    if (!s) { console.log(`${ws}: no reports/timings.json`); continue; }
    console.log(`\n=== ${ws} ===`);
    console.log(`wall ${fmt(s.wallMs)} · llm-busy ${fmt(s.llmMs)} · any-busy ${fmt(s.busyMs)} · llm cost $${s.costUsd.toFixed(2)}`);
    console.log(`\n  ${'phase'.padEnd(18)} ${'calls'.padStart(5)} ${'fail'.padStart(4)} ${'sum'.padStart(8)} ${'wall'.padStart(8)} ${'cost'.padStart(8)}`);
    for (const [k, g] of [...s.groups.entries()].sort((a, b) => mergedMs(b[1].intervals) - mergedMs(a[1].intervals))) {
        console.log(`  ${k.padEnd(18)} ${String(g.calls).padStart(5)} ${String(g.fails).padStart(4)} ${fmt(g.sumMs).padStart(8)} ${fmt(mergedMs(g.intervals)).padStart(8)} ${('$' + g.costUsd.toFixed(2)).padStart(8)}`);
    }
    console.log(`\n  ${'tool'.padEnd(28)} ${'calls'.padStart(5)} ${'sum'.padStart(8)} ${'wall'.padStart(8)}`);
    for (const [k, g] of [...s.tools.entries()].sort((a, b) => b[1].sumMs - a[1].sumMs)) {
        console.log(`  ${k.padEnd(28)} ${String(g.calls).padStart(5)} ${fmt(g.sumMs).padStart(8)} ${fmt(mergedMs(g.intervals)).padStart(8)}`);
    }
}
