// Shared base for harness implementations: the schema-validated,
// retry-once envelope every harness gets for free. Subclasses implement
// `_invoke({ systemPrompt, prompt, schema, model, timeoutMs })` returning
// `{ ok, data, raw, error, meta }` for a SINGLE model call; the base wraps it
// with local re-validation and one corrective retry.

import { Semaphore } from '../lib/semaphore.mjs';
import { validateAgainstSchema } from './validate.mjs';

export class BaseHarness {
    constructor({ maxConcurrent = 3, model, timeoutMs = 300000, onEvent, onCommand } = {}) {
        this.semaphore = new Semaphore(maxConcurrent);
        this.model = model;
        this.timeoutMs = timeoutMs;
        this.onEvent = onEvent || (() => {});
        // Verbatim command sink — the concrete harness reports the exact command
        // it is about to run (argv + prompt) so the run is fully auditable.
        this.onCommand = onCommand || (() => {});
        this.calls = 0;
        this.costUsd = 0;
        // Per-call timing/outcome records (written to reports/timings.json by the
        // pipeline) so every run leaves an objective time profile behind.
        this.callLog = [];
    }

    // One logical judgment step. Enforces the schema locally (belt-and-suspenders
    // over the harness's native structured output) and retries exactly once with
    // the validation error appended, so a single malformed reply never wedges the
    // pipeline into an open-ended loop.
    async complete({ id, systemPrompt, prompt, schema, model, effort, timeoutMs, allowedTools, maxTurns } = {}) {
        return this.semaphore.run(async () => {
            const useModel = model || this.model;
            const useTimeout = timeoutMs || this.timeoutMs;
            let attempt = 0;
            let lastError = null;
            let lastRaw = null;
            let effectivePrompt = prompt;

            while (attempt < 2) {
                attempt++;
                this.calls++;
                const started = Date.now();
                this.onEvent({ type: 'call:start', id, attempt });
                // Heartbeat: a judgment call can run for minutes (a big author or
                // custom-block generation). Emit progress every 20s so the run
                // never looks hung.
                const beat = setInterval(
                    () => this.onEvent({ type: 'call:progress', id, attempt, elapsedMs: Date.now() - started }),
                    20000,
                );
                beat.unref?.();
                let res;
                try {
                    res = await this._invoke({
                        id, attempt, systemPrompt, prompt: effectivePrompt, schema,
                        model: useModel, effort, timeoutMs: useTimeout, allowedTools, maxTurns,
                    });
                } finally {
                    clearInterval(beat);
                }
                res.meta = { ...(res.meta || {}), elapsedMs: Date.now() - started };
                lastRaw = res.raw;
                if (typeof res.meta?.costUsd === 'number') this.costUsd += res.meta.costUsd;
                this.callLog.push({
                    id, attempt,
                    startedAt: new Date(started).toISOString(),
                    elapsedMs: res.meta.elapsedMs,
                    ok: Boolean(res.ok),
                    timedOut: Boolean(res.timedOut),
                    error: res.ok ? undefined : String(res.error || '').slice(0, 300),
                    costUsd: res.meta?.costUsd,
                    apiDurationMs: res.meta?.durationMs,
                    model: res.meta?.model,
                });

                if (!res.ok) {
                    lastError = res.error || 'harness invocation failed';
                    this.onEvent({ type: 'call:error', id, attempt, error: lastError, elapsedMs: res.meta.elapsedMs });
                    // A timeout won't succeed on a re-run with the same prompt — it
                    // just burns another full timeout. Fail fast instead of retrying.
                    if (res.timedOut) return { ok: false, error: lastError, raw: res.raw, attempts: attempt, timedOut: true };
                    // Other transport/exec failure — retry with the same prompt.
                    effectivePrompt = prompt;
                    continue;
                }

                const check = validateAgainstSchema(schema, res.data);
                if (check.valid) {
                    this.onEvent({ type: 'call:ok', id, attempt, meta: res.meta, elapsedMs: res.meta.elapsedMs });
                    return { ok: true, data: res.data, meta: res.meta, attempts: attempt };
                }

                lastError = `Output did not match the required schema: ${check.errors}`;
                this.onEvent({ type: 'call:invalid', id, attempt, error: check.errors });
                // Corrective retry: tell the model exactly what was wrong.
                effectivePrompt = `${prompt}\n\n---\nYour previous response was rejected: ${check.errors}\nReturn ONLY valid JSON matching the schema.`;
            }

            return { ok: false, error: lastError, raw: lastRaw, attempts: attempt };
        });
    }
}

export default BaseHarness;
