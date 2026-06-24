// tools/theme/editor-validate.mjs — headless block-validation gate: parse stored post_content in Node instead of booting the editor per page.
import path from 'node:path';
import { ensureBlocksRegistered, loadWordPressBlocks } from '../lib/wp-serialize.mjs';

// PURE: { [slug]: post_content } -> Map<slug, { failures, samples }>.
// Runs the same validator the block editor runs (@wordpress/blocks parse,
// which recomputes save() and sets block.isValid), fed the same post-storage
// content WordPress hands the editor. A block with isValid===false is a
// validation failure, whether or not parse logged anything.
//
// blocksDir MUST point at the custom blocks Playground actually mounts and
// renders (theme-plugin/<slug>-blocks/blocks). The default fallback
// (wordpress/blocks) is the stage-1 source copy; if it drifts from or is absent
// next to the shipped copy, an unregistered block parses as a freeform/missing
// block that is NOT isValid===false, so a real custom-block break would slip
// through. The save() used here is the createBlockEditorShim approximation, so
// custom-block fidelity is bounded by that shim (same dependency stage-1
// serialization already carries) — core blocks validate against real save().
export function validateMarkupMap(markupBySlug, workspaceRoot, { blocksDir } = {}) {
    ensureBlocksRegistered(workspaceRoot, { blocksDir });
    const { parse } = loadWordPressBlocks();
    const results = new Map();
    for (const [slug, content] of Object.entries(markupBySlug || {})) {
        results.set(slug, validateContent(parse, String(content ?? '')));
    }
    return results;
}

function validateContent(parse, content) {
    // parse() writes "Block validation failed" to console.warn/error as a side
    // effect; capture both so failure messages become samples, then restore.
    const captured = [];
    const originalWarn = console.warn;
    const originalError = console.error;
    console.warn = (...args) => captured.push(formatLog(args));
    console.error = (...args) => captured.push(formatLog(args));
    let blocks;
    try {
        blocks = parse(content);
    } finally {
        console.warn = originalWarn;
        console.error = originalError;
    }
    const invalidNames = [];
    const failures = countInvalid(blocks, invalidNames);
    // Prefer the captured validator messages; fall back to invalid block names
    // when isValid is false but nothing was logged (so samples is never empty
    // while failures > 0).
    const samples = (captured.length ? captured : invalidNames).slice(0, 3);
    return { failures, samples };
}

function countInvalid(blocks, invalidNames) {
    let count = 0;
    for (const block of blocks || []) {
        if (block && block.isValid === false) {
            count += 1;
            invalidNames.push(block.name || 'unknown');
        }
        if (block && Array.isArray(block.innerBlocks) && block.innerBlocks.length) {
            count += countInvalid(block.innerBlocks, invalidNames);
        }
    }
    return count;
}

function formatLog(args) {
    return args.map((arg) => (typeof arg === 'string' ? arg : String(arg))).join(' ').slice(0, 300);
}

// Fetch every generated page's RAW post_content from the warm WordPress via the
// gate mu-plugin's dump endpoint, then validate headlessly. Throws on any
// transport failure so a broken gate can never read as zero failures.
export async function validateStoredContent({ base, gateToken, workspaceRoot, slug }) {
    const url = base + '/?wbdc_gate=dump&token=' + gateToken;
    let response;
    try {
        response = await fetch(url);
    } catch (error) {
        throw new Error(`editor-validate dump fetch failed (${url}): ${error.message}`);
    }
    if (!response.ok) {
        throw new Error(`editor-validate dump returned ${response.status} ${response.statusText} (${url})`);
    }
    const markupBySlug = await response.json();
    // Register the SAME custom blocks Playground mounts, so a shipped custom
    // block's drift is caught rather than parsed as an unregistered no-op.
    const blocksDir = slug ? path.join(workspaceRoot, 'theme-plugin', `${slug}-blocks`, 'blocks') : undefined;
    return validateMarkupMap(markupBySlug, workspaceRoot, { blocksDir });
}
