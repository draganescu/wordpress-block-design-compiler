// ClaudeHarness — maps one judgment step to one `claude -p` process.
//
//   claude -p --output-format json --json-schema <inline JSON>
//           --allowedTools ""        (no file tools => single-turn pure function)
//           --no-session-persistence
//           [--append-system-prompt <sys>] [--model <id>]
//   <prompt on stdin>
//
// `--allowedTools ""` denies the model every file/exec tool, so it cannot wander
// off exploring — it must answer from the prompt (which is why judgment prompts
// inline all needed context). `--json-schema` makes the model emit structured
// output natively; the envelope carries it back as `structured_output`.

import { spawn } from 'node:child_process';
import { BaseHarness } from './base.mjs';

export class ClaudeHarness extends BaseHarness {
    constructor(opts = {}) {
        super(opts);
        this.bin = opts.bin || 'claude';
    }

    _invoke({ id, attempt, systemPrompt, prompt, schema, model, effort, timeoutMs, allowedTools, maxTurns }) {
        // Default: no tools at all => a single-turn pure function. A step may
        // opt into a narrow tool list (e.g. Read, so a repair call can LOOK at
        // the mockup/rendered/diff screenshots); cap its turns so it can never
        // wander into an open-ended agent loop.
        const args = [
            '-p',
            '--output-format', 'json',
            '--allowedTools', allowedTools && allowedTools.length ? allowedTools.join(',') : '',
            '--no-session-persistence',
        ];
        if (allowedTools && allowedTools.length) args.push('--max-turns', String(maxTurns || 10));
        if (schema) args.push('--json-schema', JSON.stringify(schema));
        if (systemPrompt) args.push('--append-system-prompt', systemPrompt);
        // Always pin a model: inheriting the account default means judgment
        // calls silently run on whatever flagship the user chats with (a real
        // fable-5 default made author calls outlast their own timeout).
        args.push('--model', model || 'sonnet');
        if (effort) args.push('--effort', effort);

        // Report the exact command (argv + stdin prompt) before running it.
        this.onCommand({ kind: 'claude', id, attempt, argv: args, prompt });

        return new Promise((resolve) => {
            let stdout = '';
            let stderr = '';
            let settled = false;
            const child = spawn(this.bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });

            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                try { child.kill('SIGKILL'); } catch { /* gone */ }
                // timedOut => base harness skips the retry (a re-run just times out again).
                resolve({ ok: false, timedOut: true, error: `claude -p timed out after ${timeoutMs}ms`, raw: stdout });
            }, timeoutMs);
            timer.unref?.();

            child.stdout.on('data', (c) => { stdout += c; });
            child.stderr.on('data', (c) => { stderr += c; });
            child.on('error', (err) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve({ ok: false, error: `Failed to spawn ${this.bin}: ${err.message}`, raw: null });
            });
            child.on('close', (code) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(this._parse({ code, stdout, stderr }));
            });

            child.stdin.write(prompt || '');
            child.stdin.end();
        });
    }

    _parse({ code, stdout, stderr }) {
        let envelope;
        try {
            envelope = JSON.parse(stdout);
        } catch {
            return {
                ok: false,
                error: `claude -p exited ${code} without JSON output. stderr: ${stderr.slice(0, 400)}`,
                raw: stdout.slice(0, 2000),
            };
        }
        const meta = {
            costUsd: envelope.total_cost_usd,
            durationMs: envelope.duration_ms,
            numTurns: envelope.num_turns,
            sessionId: envelope.session_id,
            model: envelope.modelUsage && Object.keys(envelope.modelUsage)[0],
        };
        if (envelope.is_error || envelope.subtype !== 'success') {
            return { ok: false, error: envelope.result || `claude -p reported ${envelope.subtype}`, raw: envelope, meta };
        }
        // Prefer the already-parsed structured_output; fall back to parsing the
        // stringified `result` field.
        let data = envelope.structured_output;
        if (data === undefined) {
            try {
                data = JSON.parse(envelope.result);
            } catch {
                return { ok: false, error: 'claude -p result was not valid JSON.', raw: envelope, meta };
            }
        }
        return { ok: true, data, raw: envelope, meta };
    }
}

export default ClaudeHarness;
