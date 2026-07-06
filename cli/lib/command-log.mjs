// Verbatim command log. Every command the CLI runs — each MCP tool call and each
// `claude -p` invocation (full argv + system prompt + stdin prompt + result) — is
// appended, unabridged, to <workspace>/reports/commands.log so a run is fully
// auditable and reproducible. The terminal gets a concise one-liner; the file gets
// everything.

import fs from 'node:fs';
import path from 'node:path';

function shellQuote(s) {
    const str = String(s);
    if (str === '') return "''";
    return /[^\w@%+=:,./-]/.test(str) ? `'${str.replace(/'/g, `'\\''`)}'` : str;
}

function shellJoin(argv) {
    return argv.map(shellQuote).join(' ');
}

function clip(s, n) {
    const str = String(s ?? '');
    return str.length > n ? `${str.slice(0, n)}…(+${str.length - n})` : str;
}

export class CommandLog {
    constructor(file) {
        this.file = file;
        this.seq = 0;
        this.enabled = Boolean(file);
        if (!this.enabled) return;
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, `# wbdc command log\n# started ${new Date().toISOString()}\n\n`);
    }

    _append(text) {
        if (this.enabled) fs.appendFileSync(this.file, text);
    }

    // Returns a concise one-line summary for the terminal.
    tool(name, args) {
        this.seq += 1;
        const n = this.seq;
        this._append(`=== #${n} [${new Date().toISOString()}] TOOL ${name} ===\n${JSON.stringify(args, null, 2)}\n\n`);
        return `[#${n}] tool ${name} ${clip(JSON.stringify(args), 100)}`;
    }

    claude({ id, attempt, argv, prompt }) {
        this.seq += 1;
        const n = this.seq;
        const cmd = shellJoin(['claude', ...argv]);
        this._append(
            `=== #${n} [${new Date().toISOString()}] CLAUDE ${id}${attempt > 1 ? ` (attempt ${attempt})` : ''} ===\n`
            + `$ ${cmd}\n`
            + `--- stdin prompt (${(prompt || '').length} chars) ---\n${prompt || ''}\n--- end stdin ---\n\n`,
        );
        return `[#${n}] $ claude -p … ${id}${attempt > 1 ? ` (attempt ${attempt})` : ''} (prompt ${(prompt || '').length} chars)`;
    }

    result(id, { ok, error, costUsd, elapsedMs } = {}) {
        this._append(`--- result ${id}: ${ok ? 'ok' : `FAILED: ${error}`}${typeof costUsd === 'number' ? ` · $${costUsd.toFixed(4)}` : ''}${elapsedMs ? ` · ${Math.round(elapsedMs / 1000)}s` : ''} ---\n\n`);
    }
}

export default CommandLog;
