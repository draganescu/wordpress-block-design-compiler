// McpToolClient — drives the existing deterministic engine (tools/mcp-server.mjs)
// as a subprocess over its newline-delimited JSON-RPC stdio protocol. The CLI
// never changes the engine; it just calls the same tools the agent used to call.
//
// One server process per run. `call(name, args)` sends a tools/call request and
// resolves with the parsed tool result (the JSON the handler returned, unwrapped
// from the MCP text-content envelope). Errors surface as thrown Error objects.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, '..', 'tools', 'mcp-server.mjs');

export class McpToolClient {
    constructor({ serverPath = SERVER, cwd = path.join(HERE, '..'), env = process.env, onLog, onCommand } = {}) {
        this.serverPath = serverPath;
        this.cwd = cwd;
        this.env = env;
        this.onLog = onLog || (() => {});
        this.onCommand = onCommand || (() => {});
        this.proc = null;
        this.buffer = Buffer.alloc(0);
        this.nextId = 1;
        this.pending = new Map();
        this.ready = null;
        this.closed = false;
        // Per-tool-call timing records, mirrored into reports/timings.json.
        this.callLog = [];
    }

    async start() {
        if (this.proc) return this;
        this.proc = spawn(process.execPath, [this.serverPath], {
            cwd: this.cwd,
            env: this.env,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        this.proc.stdout.on('data', (chunk) => this._onData(chunk));
        // The engine logs (block-validation diffs, playground boot) go to stderr.
        this.proc.stderr.on('data', (chunk) => this.onLog(chunk.toString('utf8')));
        this.proc.on('exit', (code) => this._onExit(code));
        this.proc.on('error', (err) => this._rejectAll(err));

        // MCP handshake — the server answers `initialize` before any tools/call.
        await this._request('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'wbdc-cli', version: '0.1.0' },
        });
        return this;
    }

    async call(name, args = {}) {
        if (this.closed) throw new Error(`Tool client is closed; cannot call ${name}.`);
        this.onCommand({ kind: 'tool', name, args });
        const started = Date.now();
        const entry = { name, startedAt: new Date(started).toISOString(), elapsedMs: null, ok: null };
        this.callLog.push(entry);
        let result;
        try {
            result = await this._request('tools/call', { name, arguments: args });
            entry.ok = true;
        } catch (err) {
            entry.ok = false;
            entry.error = String(err?.message || err).slice(0, 300);
            throw err;
        } finally {
            entry.elapsedMs = Date.now() - started;
        }
        // Handlers return arbitrary JSON, wrapped by the server as
        // { content: [{ type: 'text', text: '<json>' }] }. Unwrap it.
        const text = result?.content?.[0]?.text;
        if (typeof text !== 'string') return result;
        try {
            return JSON.parse(text);
        } catch {
            return text;
        }
    }

    _request(method, params) {
        return new Promise((resolve, reject) => {
            const id = this.nextId++;
            this.pending.set(id, { resolve, reject, method });
            const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });
            this.proc.stdin.write(`${payload}\n`);
        });
    }

    _onData(chunk) {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        while (true) {
            const newline = this.buffer.indexOf('\n');
            if (newline < 0) break;
            const line = this.buffer.slice(0, newline).toString('utf8').trim();
            this.buffer = this.buffer.slice(newline + 1);
            if (!line) continue;
            let message;
            try {
                message = JSON.parse(line);
            } catch {
                // Non-JSON line on stdout — treat as a log, not a protocol frame.
                this.onLog(line);
                continue;
            }
            this._dispatch(message);
        }
    }

    _dispatch(message) {
        if (message == null || !Object.prototype.hasOwnProperty.call(message, 'id')) return;
        const entry = this.pending.get(message.id);
        if (!entry) return;
        this.pending.delete(message.id);
        if (message.error) {
            const err = new Error(message.error.message || `Tool error (${entry.method})`);
            err.code = message.error.code;
            err.data = message.error.data;
            entry.reject(err);
        } else {
            entry.resolve(message.result);
        }
    }

    _onExit(code) {
        this.closed = true;
        if (this.pending.size) {
            this._rejectAll(new Error(`MCP server exited (code ${code}) with ${this.pending.size} pending request(s).`));
        }
    }

    _rejectAll(err) {
        for (const { reject } of this.pending.values()) reject(err);
        this.pending.clear();
    }

    async close() {
        if (!this.proc || this.closed) {
            this.closed = true;
            return;
        }
        this.closed = true;
        // SIGTERM lets the server's graceful shutdown tear down warm Playground
        // servers before it exits.
        await new Promise((resolve) => {
            const done = () => resolve();
            this.proc.once('exit', done);
            this.proc.kill('SIGTERM');
            setTimeout(() => {
                try { this.proc.kill('SIGKILL'); } catch { /* already gone */ }
                resolve();
            }, 5000).unref();
        });
    }
}

export default McpToolClient;
