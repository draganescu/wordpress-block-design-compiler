#!/usr/bin/env node
// tools/profile/run-profile.mjs — profiling harness for the html-to-blocks MCP server.
//
// Drives a fixed sequence of real MCP tool calls against tools/profile/fixture/
// with WBDC_PROFILE=deep (and WBDC_PROFILE_NET=1 under --net), then aggregates the
// per-process spans-*.jsonl the profiler emits into a single summary.json, a
// speedscope trace, and a short markdown digest on stdout.
//
// Two drive modes expose the per-call spawn/registration/browser-launch tax:
//   --mode interactive : ONE persistent `node tools/mcp-server.mjs` process,
//                        reused for every tool call (warm: core-block
//                        registration + module load paid once).
//   --mode batch       : a FRESH server process per call, exactly like
//                        artifacts/mcp-call.sh (cold: every call re-pays spawn +
//                        registration + browser launch).
//
// Framing matches artifacts/mcp-call.sh: requests are newline-delimited JSON
// (the server's stdin reader splits on '\n'); responses are Content-Length
// framed JSON-RPC. Profiling output never touches stdout — it lands in the
// fixture's reports/profile/ via WBDC_PROFILE_DIR.
//
// Usage:
//   node tools/profile/run-profile.mjs [--mode interactive|batch] [--net]
//                                      [--fixture <dir>] [--keep] [--timeout <ms>]
//
// Robustness: every step is wrapped — a failing tool call is logged to stderr and
// the run continues, so a partial summary still emits.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { toSpeedscope } from '../lib/profile.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SERVER = path.join(REPO_ROOT, 'tools', 'mcp-server.mjs');

// --- CLI parsing -------------------------------------------------------------

function parseArgs(argv) {
    const opts = { mode: 'interactive', net: false, keep: false, timeout: 120000, fixture: path.join(__dirname, 'fixture') };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--mode') opts.mode = argv[++i];
        else if (arg === '--net') opts.net = true;
        else if (arg === '--keep') opts.keep = true;
        else if (arg === '--fixture') opts.fixture = path.resolve(argv[++i]);
        else if (arg === '--timeout') opts.timeout = Number(argv[++i]) || opts.timeout;
        else if (arg === '--help' || arg === '-h') opts.help = true;
        else logErr(`Ignoring unknown flag: ${arg}`);
    }
    if (opts.mode !== 'interactive' && opts.mode !== 'batch') {
        logErr(`Unknown --mode '${opts.mode}', falling back to interactive.`);
        opts.mode = 'interactive';
    }
    return opts;
}

const USAGE = `run-profile.mjs — drive the html-to-blocks MCP server through a fixed
tool sequence and aggregate the profiler spans.

Usage:
  node tools/profile/run-profile.mjs [options]

Options:
  --mode <interactive|batch>  interactive: one persistent server reused for all
                              calls (default). batch: fresh server per call,
                              like artifacts/mcp-call.sh.
  --net                       set WBDC_PROFILE_NET=1 to capture per-host network.
  --fixture <dir>             workspace to drive (default tools/profile/fixture).
  --timeout <ms>              per-call response timeout (default 120000).
  --keep                      keep the spans-*.jsonl files (default: kept anyway;
                              this only suppresses the pre-run clean of stale ones).
  -h, --help                  print this help.

Outputs (under <fixture>/reports/profile):
  summary.json            total wall, layer split, top tools, top hosts, launches.
  trace.speedscope.json   nested spans for https://www.speedscope.app.
  (a markdown digest is printed to stdout).`;

function logErr(...args) {
    process.stderr.write(`[run-profile] ${args.join(' ')}\n`);
}

// --- the scripted tool sequence ----------------------------------------------
//
// Ordering matters: serialize writes rendered/rendered-blocks.html, the preview
// writes editor/block-editor.html, then screenshot/compare can see all surfaces.
// workspaceRoot is filled in at runtime against the chosen fixture.
function buildSequence(workspaceRoot) {
    return [
        {
            tool: 'serialize_wordpress_blocks',
            args: { workspaceRoot },
        },
        {
            tool: 'create_block_editor_preview',
            args: { workspaceRoot },
        },
        {
            tool: 'screenshot_html',
            args: {
                workspaceRoot,
                viewports: [{ name: 'desktop', width: 1280, height: 900, fullPage: true }],
            },
        },
        {
            tool: 'compare_html',
            args: {
                workspaceRoot,
                compareEditor: true,
                viewports: [{ name: 'desktop', width: 1280, height: 900, fullPage: true }],
            },
        },
    ];
}

// --- Content-Length framed MCP transport over stdio --------------------------
//
// A buffering reader for the server's stdout: parses Content-Length headers and
// resolves a waiter when the JSON-RPC response with a matching id arrives.

function makeReader() {
    let buffer = Buffer.alloc(0);
    const waiters = new Map(); // id -> { resolve, reject }

    function feed(chunk) {
        buffer = Buffer.concat([buffer, chunk]);
        for (;;) {
            const headerEnd = indexOfHeaderEnd(buffer);
            if (headerEnd < 0) return;
            const header = buffer.slice(0, headerEnd).toString('utf8');
            const match = /content-length:\s*(\d+)/i.exec(header);
            if (!match) {
                // Not a framed message — drop the malformed header span and retry.
                buffer = buffer.slice(headerEnd);
                continue;
            }
            const length = Number(match[1]);
            const bodyStart = headerEnd;
            if (buffer.length < bodyStart + length) return; // wait for more
            const body = buffer.slice(bodyStart, bodyStart + length).toString('utf8');
            buffer = buffer.slice(bodyStart + length);
            let msg;
            try {
                msg = JSON.parse(body);
            } catch (err) {
                logErr(`Failed to parse response body: ${err.message}`);
                continue;
            }
            if (msg && Object.prototype.hasOwnProperty.call(msg, 'id') && waiters.has(msg.id)) {
                const waiter = waiters.get(msg.id);
                waiters.delete(msg.id);
                waiter.resolve(msg);
            }
        }
    }

    function indexOfHeaderEnd(buf) {
        const crlf = buf.indexOf('\r\n\r\n');
        if (crlf >= 0) return crlf + 4;
        const lf = buf.indexOf('\n\n');
        if (lf >= 0) return lf + 2;
        return -1;
    }

    function waitFor(id, timeoutMs) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                waiters.delete(id);
                reject(new Error(`timeout after ${timeoutMs}ms waiting for response id=${id}`));
            }, timeoutMs);
            waiters.set(id, {
                resolve: (msg) => { clearTimeout(timer); resolve(msg); },
                reject: (err) => { clearTimeout(timer); reject(err); },
            });
        });
    }

    return { feed, waitFor };
}

// Spawn a server process with the profiling env, return { proc, reader, send }.
function spawnServer(env) {
    const proc = spawn('node', [SERVER], {
        cwd: REPO_ROOT,
        env,
        stdio: ['pipe', 'pipe', 'inherit'], // stderr inherits so profiler/log noise is visible
    });
    const reader = makeReader();
    proc.stdout.on('data', (chunk) => reader.feed(chunk));
    proc.on('error', (err) => logErr(`server process error: ${err.message}`));

    // The server reads newline-delimited JSON from stdin (see mcp-server.mjs
    // readStdin: it splits on '\n'). mcp-call.sh frames requests the same way.
    const send = (msg) => proc.stdin.write(JSON.stringify(msg) + '\n');
    return { proc, reader, send };
}

async function initialize(server, timeoutMs) {
    const id = 1;
    server.send({
        jsonrpc: '2.0',
        id,
        method: 'initialize',
        params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'run-profile', version: '1.0' },
        },
    });
    const reply = await server.reader.waitFor(id, timeoutMs);
    server.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    return reply;
}

async function callTool(server, id, tool, args, timeoutMs) {
    server.send({
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: { name: tool, arguments: args },
    });
    return server.reader.waitFor(id, timeoutMs);
}

function killServer(server) {
    try {
        server.proc.stdin.end();
    } catch {
        // ignore
    }
    try {
        server.proc.kill('SIGKILL');
    } catch {
        // ignore
    }
}

// --- driving -----------------------------------------------------------------

async function runInteractive(sequence, env, timeoutMs) {
    const results = [];
    const server = spawnServer(env);
    try {
        await initialize(server, timeoutMs);
    } catch (err) {
        logErr(`initialize failed (interactive): ${err.message}`);
        killServer(server);
        return results;
    }
    let id = 2;
    for (const step of sequence) {
        const t0 = Date.now();
        try {
            const reply = await callTool(server, id, step.tool, step.args, timeoutMs);
            const ok = !reply.error && !(reply.result && reply.result.isError);
            results.push({ tool: step.tool, ok, wallMs: Date.now() - t0, error: reply.error ? reply.error.message : null });
            if (reply.error) logErr(`${step.tool} returned error: ${reply.error.message}`);
        } catch (err) {
            results.push({ tool: step.tool, ok: false, wallMs: Date.now() - t0, error: err.message });
            logErr(`${step.tool} failed: ${err.message}`);
        }
        id += 1;
    }
    killServer(server);
    // Give the OS a beat to flush any final stdout the server wrote on exit.
    await delay(150);
    return results;
}

async function runBatch(sequence, env, timeoutMs) {
    const results = [];
    for (const step of sequence) {
        const t0 = Date.now();
        const server = spawnServer(env);
        try {
            await initialize(server, timeoutMs);
            const reply = await callTool(server, 2, step.tool, step.args, timeoutMs);
            const ok = !reply.error && !(reply.result && reply.result.isError);
            results.push({ tool: step.tool, ok, wallMs: Date.now() - t0, error: reply.error ? reply.error.message : null });
            if (reply.error) logErr(`${step.tool} returned error: ${reply.error.message}`);
        } catch (err) {
            results.push({ tool: step.tool, ok: false, wallMs: Date.now() - t0, error: err.message });
            logErr(`${step.tool} failed (batch): ${err.message}`);
        } finally {
            killServer(server);
            await delay(100);
        }
    }
    return results;
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- span aggregation --------------------------------------------------------

function readSpans(profileDir) {
    const spans = [];
    let files = [];
    try {
        files = fs.readdirSync(profileDir).filter((f) => /^spans-.*\.jsonl$/.test(f));
    } catch {
        return { spans, files: [] };
    }
    for (const file of files) {
        const full = path.join(profileDir, file);
        let text = '';
        try {
            text = fs.readFileSync(full, 'utf8');
        } catch (err) {
            logErr(`could not read ${file}: ${err.message}`);
            continue;
        }
        for (const line of text.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
                spans.push(JSON.parse(trimmed));
            } catch {
                // skip a partially-written final line
            }
        }
    }
    return { spans, files };
}

// Categorize a span label into a layer bucket for the four-layer split.
// Cross-process boot (the spawn-per-call tax) is derived separately from the
// per-process pid set, not from span labels.
function layerOf(label) {
    if (label.startsWith('tool.')) return 'tool';
    if (label.startsWith('serialize.')) return 'tool-cpu';
    if (label.startsWith('capture.network')) return 'network';
    if (label.startsWith('capture.browser')) return 'subprocess';
    if (label.startsWith('playground.')) {
        if (label.includes('cli.spawn') || label.includes('wait.server') || label.includes('wait.import')) return 'subprocess';
        return 'tool-cpu';
    }
    return 'other';
}

function percentile(sortedAsc, p) {
    if (sortedAsc.length === 0) return 0;
    const rank = (p / 100) * (sortedAsc.length - 1);
    const lo = Math.floor(rank);
    const hi = Math.ceil(rank);
    if (lo === hi) return sortedAsc[lo];
    const frac = rank - lo;
    return sortedAsc[lo] * (1 - frac) + sortedAsc[hi] * frac;
}

function round(n, d = 2) {
    const f = 10 ** d;
    return Math.round((Number(n) || 0) * f) / f;
}

function aggregate(spans, meta) {
    // Top tools: derived from `tool.<name>` spans (one per tool call).
    const toolDurations = new Map(); // tool -> [durMs...]
    // Layer totals: sum durMs by layer. Tool-level spans (tool.*) are the
    // agent-observed wall; sub-phases (serialize.*, capture.*, playground.*)
    // partition that wall, so we keep them in separate sub-buckets and report
    // tool-wall and sub-phase splits side by side without double counting.
    const layerTotals = { tool: 0, 'tool-cpu': 0, subprocess: 0, network: 0, other: 0 };
    const hostTotals = new Map(); // host -> { count, bytes, totalMs }
    const pids = new Set();
    let launchCount = 0;
    let launchTotalMs = 0;
    let netRequestCount = 0;
    let slowestRequest = null;

    for (const span of spans) {
        if (span.pid != null) pids.add(span.pid);
        const label = String(span.label || '');
        const dur = Number(span.durMs) || 0;
        const layer = layerOf(label);
        layerTotals[layer] = (layerTotals[layer] || 0) + dur;

        if (label.startsWith('tool.')) {
            const tool = label.slice('tool.'.length);
            if (!toolDurations.has(tool)) toolDurations.set(tool, []);
            toolDurations.get(tool).push(dur);
        }

        // Browser launch counter: prefer the running aggregate when present.
        if (label === 'capture.browser.launchCount' && span.meta) {
            launchCount = Math.max(launchCount, Number(span.meta.count) || 0);
            launchTotalMs = Math.max(launchTotalMs, Number(span.meta.totalMs) || 0);
        } else if (label === 'capture.browser.launch') {
            // Fallback if only per-launch spans exist.
            if (launchCount === 0) launchTotalMs += dur;
        }

        // Network per-host aggregation (P1; only when WBDC_PROFILE_NET=1 ran).
        if (label === 'capture.network' && span.meta && span.meta.hosts) {
            netRequestCount += Number(span.meta.requestCount) || 0;
            for (const [host, bucket] of Object.entries(span.meta.hosts)) {
                const cur = hostTotals.get(host) || { count: 0, bytes: 0, totalMs: 0 };
                cur.count += Number(bucket.count) || 0;
                cur.bytes += Number(bucket.bytes) || 0;
                cur.totalMs += Number(bucket.totalMs) || 0;
                hostTotals.set(host, cur);
            }
            const s = span.meta.slowest;
            if (s && (!slowestRequest || (Number(s.durMs) || 0) > (slowestRequest.durMs || 0))) {
                slowestRequest = { url: s.url, host: s.host, durMs: Number(s.durMs) || 0, bytes: Number(s.bytes) || 0, fromCache: !!s.fromCache };
            }
        }
    }

    // capture.browser.launch spans give a direct count even without the aggregate.
    const launchSpans = spans.filter((s) => s.label === 'capture.browser.launch');
    if (launchCount === 0 && launchSpans.length > 0) {
        launchCount = launchSpans.length;
        launchTotalMs = launchSpans.reduce((sum, s) => sum + (Number(s.durMs) || 0), 0);
    }

    // Top tools by total wall, with p50/p95.
    const topTools = [...toolDurations.entries()]
        .map(([tool, durs]) => {
            const sorted = [...durs].sort((a, b) => a - b);
            const total = durs.reduce((sum, d) => sum + d, 0);
            return {
                tool,
                calls: durs.length,
                totalMs: round(total),
                p50Ms: round(percentile(sorted, 50)),
                p95Ms: round(percentile(sorted, 95)),
                maxMs: round(sorted[sorted.length - 1] || 0),
            };
        })
        .sort((a, b) => b.totalMs - a.totalMs);

    // Top hosts by total transfer time, then bytes.
    const topHosts = [...hostTotals.entries()]
        .map(([host, b]) => ({ host, count: b.count, bytes: b.bytes, totalMs: round(b.totalMs) }))
        .sort((a, b) => b.totalMs - a.totalMs || b.bytes - a.bytes);

    // Total tool wall (sum of tool.* spans) is the closest in-process proxy for
    // the wall the agent observes across the sequence.
    const toolWallMs = round(layerTotals.tool);

    // Derive the tool-CPU vs subprocess+network split *within* tool wall from the
    // sub-phase spans we have. Anything unattributed is "other/IO".
    const subPhaseMs = round(layerTotals['tool-cpu'] + layerTotals.subprocess + layerTotals.network);
    const cpuMs = round(layerTotals['tool-cpu']);
    const subprocessNetMs = round(layerTotals.subprocess + layerTotals.network);
    const unattributedMs = round(Math.max(0, toolWallMs - subPhaseMs));

    return {
        meta,
        totals: {
            // Wall clock measured by the harness around the whole drive sequence.
            wallMs: round(meta.driveWallMs),
            // Sum of per-tool spans (in-process handler wall).
            toolWallMs,
            // Layer split derivable from span labels.
            split: {
                toolCpuMs: cpuMs,
                subprocessNetMs,
                networkMs: round(layerTotals.network),
                subprocessMs: round(layerTotals.subprocess),
                unattributedIoMs: unattributedMs,
            },
        },
        topTools,
        topHosts,
        network: meta.net ? { requestCount: netRequestCount, slowest: slowestRequest } : null,
        launches: { browserLaunchCount: launchCount, browserLaunchTotalMs: round(launchTotalMs) },
        process: {
            // In batch mode each call is a fresh pid; the count surfaces the
            // spawn/registration tax paid per call vs the single persistent pid.
            serverProcessCount: pids.size,
            pids: [...pids],
        },
        spanCount: spans.length,
    };
}

// --- markdown digest ---------------------------------------------------------

function renderDigest(summary, results, files) {
    const lines = [];
    const m = summary.meta;
    lines.push(`# Profiling run — mode=${m.mode}${m.net ? ' +net' : ''}`);
    lines.push('');
    lines.push(`- drive wall: **${round(summary.totals.wallMs)} ms** across ${results.length} tool calls`);
    lines.push(`- tool wall (sum of handler spans): **${summary.totals.toolWallMs} ms**`);
    const s = summary.totals.split;
    lines.push(`- split: tool-CPU ${s.toolCpuMs} ms · subprocess+net ${s.subprocessNetMs} ms (net ${s.networkMs} ms) · unattributed/IO ${s.unattributedIoMs} ms`);
    lines.push(`- browser launches: **${summary.launches.browserLaunchCount}** (${summary.launches.browserLaunchTotalMs} ms total)`);
    lines.push(`- server processes spawned: **${summary.process.serverProcessCount}** · spans recorded: ${summary.spanCount}`);
    lines.push('');

    lines.push('## Tool results');
    for (const r of results) {
        const status = r.ok ? 'ok' : 'FAIL';
        lines.push(`- ${r.tool}: ${status} (${r.wallMs} ms${r.error ? ` — ${r.error}` : ''})`);
    }
    lines.push('');

    if (summary.topTools.length) {
        lines.push('## Top tools by total wall');
        lines.push('| tool | calls | total ms | p50 | p95 |');
        lines.push('|---|---|---|---|---|');
        for (const t of summary.topTools) {
            lines.push(`| ${t.tool} | ${t.calls} | ${t.totalMs} | ${t.p50Ms} | ${t.p95Ms} |`);
        }
        lines.push('');
    }

    if (summary.topHosts.length) {
        lines.push('## Top network hosts');
        lines.push('| host | reqs | bytes | total ms |');
        lines.push('|---|---|---|---|');
        for (const h of summary.topHosts.slice(0, 10)) {
            lines.push(`| ${h.host} | ${h.count} | ${h.bytes} | ${h.totalMs} |`);
        }
        if (summary.network && summary.network.slowest) {
            const sw = summary.network.slowest;
            lines.push('');
            lines.push(`Slowest request: ${sw.host} ${round(sw.durMs)} ms (${sw.bytes} bytes${sw.fromCache ? ', cached' : ''})`);
        }
        lines.push('');
    } else if (m.net) {
        lines.push('## Top network hosts');
        lines.push('_No per-host network spans recorded (capture handlers may not be wired to the instrumented launch/network helpers)._');
        lines.push('');
    }

    lines.push(`Artifacts: ${path.join(m.profileDir, 'summary.json')}`);
    lines.push(`           ${path.join(m.profileDir, 'trace.speedscope.json')}`);
    lines.push(`Spans read: ${files.length} file(s).`);
    return lines.join('\n');
}

// --- main --------------------------------------------------------------------

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
        process.stdout.write(USAGE + '\n');
        return 0;
    }

    const workspaceRoot = opts.fixture;
    if (!fs.existsSync(path.join(workspaceRoot, 'wordpress', 'block-tree.json'))) {
        logErr(`Fixture missing wordpress/block-tree.json under ${workspaceRoot}`);
        return 1;
    }

    const profileDir = path.join(workspaceRoot, 'reports', 'profile');
    fs.mkdirSync(profileDir, { recursive: true });

    // Clean stale spans so the aggregate reflects only this run.
    for (const f of safeReadDir(profileDir)) {
        if (/^spans-.*\.jsonl$/.test(f)) {
            try { fs.unlinkSync(path.join(profileDir, f)); } catch { /* ignore */ }
        }
    }

    const env = {
        ...process.env,
        WBDC_PROFILE: 'deep',
        WBDC_PROFILE_DIR: profileDir,
    };
    if (opts.net) env.WBDC_PROFILE_NET = '1';

    const sequence = buildSequence(workspaceRoot);

    logErr(`mode=${opts.mode} net=${opts.net} fixture=${workspaceRoot}`);
    logErr(`driving ${sequence.length} tool calls…`);

    const driveStart = Date.now();
    let results = [];
    try {
        results = opts.mode === 'batch'
            ? await runBatch(sequence, env, opts.timeout)
            : await runInteractive(sequence, env, opts.timeout);
    } catch (err) {
        logErr(`drive sequence crashed: ${err.message}`);
    }
    const driveWallMs = Date.now() - driveStart;

    // Aggregate whatever spans landed (robust to partial runs).
    const { spans, files } = readSpans(profileDir);
    const meta = {
        mode: opts.mode,
        net: opts.net,
        fixture: workspaceRoot,
        profileDir,
        driveWallMs,
        ranAt: new Date().toISOString(),
        node: process.version,
    };
    let summary;
    try {
        summary = aggregate(spans, meta);
    } catch (err) {
        logErr(`aggregation failed: ${err.message}`);
        summary = { meta, error: err.message, topTools: [], topHosts: [], totals: { wallMs: round(driveWallMs), toolWallMs: 0, split: {} }, launches: {}, process: {}, spanCount: spans.length };
    }
    summary.toolResults = results;

    // Write summary.json.
    try {
        fs.writeFileSync(path.join(profileDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
    } catch (err) {
        logErr(`failed to write summary.json: ${err.message}`);
    }

    // Write speedscope trace.
    try {
        // Order spans by start time so the evented profile nests correctly.
        const ordered = [...spans].sort((a, b) => (a.tsEpochMs || 0) - (b.tsEpochMs || 0));
        const scope = toSpeedscope(ordered);
        fs.writeFileSync(path.join(profileDir, 'trace.speedscope.json'), JSON.stringify(scope) + '\n');
    } catch (err) {
        logErr(`failed to write trace.speedscope.json: ${err.message}`);
    }

    // Markdown digest to stdout.
    try {
        process.stdout.write(renderDigest(summary, results, files) + '\n');
    } catch (err) {
        logErr(`failed to render digest: ${err.message}`);
    }

    const anyFail = results.some((r) => !r.ok);
    return anyFail ? 2 : 0;
}

function safeReadDir(dir) {
    try {
        return fs.readdirSync(dir);
    } catch {
        return [];
    }
}

main()
    .then((code) => { process.exitCode = code; })
    .catch((err) => {
        logErr(`fatal: ${err && err.stack ? err.stack : err}`);
        process.exitCode = 1;
    });
