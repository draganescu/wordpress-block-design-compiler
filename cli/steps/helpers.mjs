// Small filesystem + prompt helpers shared by the stage step modules.

import fs from 'node:fs';
import path from 'node:path';

export function readWs(ws, rel) {
    const file = path.join(ws, rel);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

export function readJsonWs(ws, rel) {
    const text = readWs(ws, rel);
    if (!text) return null;
    try { return JSON.parse(text); } catch { return null; }
}

export function writeWs(ws, rel, text) {
    const file = path.join(ws, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return file;
}

export function writeJsonWs(ws, rel, obj) {
    return writeWs(ws, rel, `${JSON.stringify(obj, null, 2)}\n`);
}

export function exists(ws, rel) {
    return fs.existsSync(path.join(ws, rel));
}

// Model/effort routing for a judgment call, by role: 'design' (mockup/site
// aesthetics), 'build' (plan/author/theme plan), 'repair' (fix loops).
// Falls back to the single --model override so old option objects keep working.
export function judgeParams(ctx, role) {
    const roles = ctx.judge || {};
    const p = roles[role] || {};
    const out = {};
    const model = p.model || ctx.options?.model;
    if (model) out.model = model;
    if (p.effort) out.effort = p.effort;
    return out;
}

// Inline large source safely: cap the size so a pathological mockup can't blow
// the context, and flag when we trimmed so the model knows it's partial.
export function clip(text, max = 120000) {
    if (!text) return '';
    if (text.length <= max) return text;
    return `${text.slice(0, max)}\n<!-- …truncated ${text.length - max} chars… -->`;
}

// Render a plain-language block plan markdown from the structured plan, so the
// workspace keeps the human-readable plan/*.md the skills expect without a second
// LLM call.
export function planToMarkdown(plan, page) {
    const lines = [`# Block plan — ${page}`, ''];
    if (plan.notes) lines.push(plan.notes, '');
    lines.push('## Sections', '');
    for (const s of plan.sections || []) {
        lines.push(`### ${s.name} (${s.strategy})`);
        if (s.mockupSelector) lines.push(`- selector: \`${s.mockupSelector}\``);
        if (s.coreBlocks?.length) lines.push(`- blocks: ${s.coreBlocks.join(', ')}`);
        if (s.reason) lines.push(`- reason: ${s.reason}`);
        if (s.styling) lines.push(`- styling: ${s.styling}`);
        lines.push('');
    }
    if (plan.customBlocks?.length) {
        lines.push('## Custom blocks', '');
        for (const b of plan.customBlocks) {
            lines.push(`### ${b.name}${b.form ? ' (form)' : ''}`);
            if (b.reason) lines.push(`- reason: ${b.reason}`);
            if (b.attributes?.length) lines.push(`- attributes: ${b.attributes.map((a) => `${a.name}:${a.type}`).join(', ')}`);
            lines.push('');
        }
    }
    return `${lines.join('\n')}\n`;
}

// Normalize a model-authored block tree to the { version, contract, blocks }
// envelope the serializer expects, accepting either a bare array or the envelope.
export function normalizeTree(blockTree) {
    let tree;
    if (Array.isArray(blockTree)) tree = { version: 2, contract: 'data-only', blocks: blockTree };
    else if (blockTree && Array.isArray(blockTree.blocks)) tree = { version: 2, contract: 'data-only', ...blockTree };
    else throw new Error('author step returned a block tree without a blocks array');
    hardenBlocks(tree.blocks);
    return tree;
}

// Deterministic attribute guarantees the editor canvas depends on. A
// core/navigation without attrs.layout makes the editor's getOrientation read
// `layout.orientation` of undefined, throwing repeatedly and collapsing the
// whole canvas render (observed: editor screenshots reduced to background
// bands). Guarantee it in code — never trust each authored tree to remember.
function hardenBlocks(blocks) {
    for (const b of blocks || []) {
        if (!b || typeof b !== 'object') continue;
        if (b.blockName === 'core/navigation') {
            b.attrs = b.attrs || {};
            if (!b.attrs.layout || typeof b.attrs.layout !== 'object') {
                b.attrs.layout = { type: 'flex', orientation: 'horizontal' };
            }
        }
        hardenBlocks(b.innerBlocks);
    }
}
