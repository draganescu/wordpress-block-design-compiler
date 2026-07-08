// Skill grounding — the per-step system prompts are the ACTUAL skill text, not a
// paraphrase. Each judgment step loads the relevant SKILL.md / references so the
// hard-won rules (core-first gate, lift-first gate, repair-loop stopping rules,
// harness-artifact stop list) apply to the `claude -p` call exactly as they did
// when an agent read them. Reuse, don't re-derive.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const cache = new Map();

function read(rel) {
    if (cache.has(rel)) return cache.get(rel);
    const file = path.join(ROOT, rel);
    const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    cache.set(rel, text);
    return text;
}

// Concatenate a set of skill files into one grounding block, each fenced with its
// path so the model can tell the sources apart.
export function skillContext(relPaths) {
    return relPaths
        .map((rel) => {
            const text = read(rel);
            return text ? `===== ${rel} =====\n${text.trim()}` : '';
        })
        .filter(Boolean)
        .join('\n\n');
}

// Hard serializer rules. Violating ANY of these makes a block tree (or a template
// tree) fail to serialize — and the serializer throws on the FIRST violation, so
// one invalid attribute stalls the whole repair loop. Stating them up front is the
// cheapest way to stop the models re-emitting nav tagNames / invented attributes.
export const SERIALIZER_CONSTRAINTS = [
    'SERIALIZER CONSTRAINTS — a tree that breaks ANY of these fails to build; obey them exactly:',
    '- Use ONLY real core blocks registered by @wordpress/block-library, or a workspace custom block. Never invent block names (no core/link, core/icon, etc.).',
    '- Use ONLY attributes present in a block\'s WordPress metadata. Do NOT invent attributes. If unsure an attribute exists (e.g. textAlign, iconName), express it with className + CSS or a style.* support instead.',
    '- core/group tagName MUST be one of: div, main, section, article, aside, header, footer. NEVER nav, ul, ol, li, p, span, or any inline tag. A nav menu is core/navigation (it renders a <nav>); a list is core/list; a search box is core/search.',
    '- NEVER include raw-markup fields: htmlLines, innerHTML, innerContent, html, markup, sourceHtml, innerHtml. Markup is generated from attrs only.',
    '- Every block item is { blockName, attrs, innerBlocks }.',
    '- className MUST carry the source element\'s FULL class list verbatim (e.g. "btn btn-cta", never just "btn-cta") — stylesheets key on the exact combination, and a dropped base class unstyles the element.',
].join('\n');

// The shared operating rules that apply to EVERY judgment call in this CLI: you
// are a single deterministic step, not an agent; return only the required JSON.
export const HARNESS_PREAMBLE = [
    'You are one deterministic step in a fixed pipeline, not an interactive agent.',
    'You have no tools and cannot read files — every fact you need is inlined in the prompt.',
    'Do exactly the one job described. Do not plan follow-up work or ask questions.',
    'Respond with ONLY the JSON the schema requires — no prose, no markdown fences.',
].join(' ');

// Variant for the repair steps that may LOOK at comparison screenshots: same
// single-step discipline, but Read is allowed for the image paths given in the
// prompt (and nothing else).
export const HARNESS_PREAMBLE_VISION = [
    'You are one deterministic step in a fixed pipeline, not an interactive agent.',
    'Your ONLY tool is Read, and ONLY for the screenshot paths listed in the prompt — look at them before deciding your fix; do not explore other files.',
    'Do exactly the one job described. Do not plan follow-up work or ask questions.',
    'End by responding with ONLY the JSON the schema requires — no prose, no markdown fences.',
].join(' ');

export { ROOT };
export default skillContext;
