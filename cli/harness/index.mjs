// Harness abstraction — the seam that turns an LLM into a pure function:
// structured input -> structured JSON output, one call, no agentic loop.
//
//   harness.complete({ id, systemPrompt, prompt, schema, model?, timeoutMs? })
//     -> { ok: true,  data, meta }        // data validated against `schema`
//     -> { ok: false, error, raw, meta }
//
// The pipeline only knows this interface. Swapping `claude` for a future
// harness (codex, gemini, a local server) is a new class registered below —
// nothing in the step/loop/pipeline code changes.

import { ClaudeHarness } from './claude.mjs';
import { MockHarness } from './mock.mjs';
import { validateAgainstSchema } from './validate.mjs';

const REGISTRY = {
    claude: ClaudeHarness,
    mock: MockHarness,
};

export function getHarness(name = 'claude', opts = {}) {
    const Cls = REGISTRY[name];
    if (!Cls) {
        throw new Error(`Unknown harness "${name}". Available: ${Object.keys(REGISTRY).join(', ')}.`);
    }
    return new Cls(opts);
}

export { ClaudeHarness, MockHarness, validateAgainstSchema };
