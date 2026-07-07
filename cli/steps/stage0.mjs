// Stage 0 — content modeling. Optional: a classify step (or --stage0 on/off)
// decides if the design implies managed content. When it does, the model is
// authored, validated, scaffolded into a plugin, and the html-to-blocks
// stand-ins are hydrated into real core/query loops AFTER the Stage 1 gate.

import { skillContext, HARNESS_PREAMBLE } from '../prompts/skill-context.mjs';
import { readJsonWs, writeJsonWs, writeWs, judgeParams } from './helpers.mjs';

const CLASSIFY_SCHEMA = {
    type: 'object', additionalProperties: false, required: ['needed'],
    properties: { needed: { type: 'boolean' }, reason: { type: 'string' } },
};

const MODEL_SCHEMA = {
    type: 'object', additionalProperties: false, required: ['contentModel'],
    properties: { contentModel: { type: 'object' }, notes: { type: 'string' } },
};

const MODEL_SYS = () => `${HARNESS_PREAMBLE}\n\n${skillContext([
    'skills/content-modeling/SKILL.md',
    'skills/content-modeling/references/modeling-decisions.md',
    'skills/content-modeling/references/plugin-contract.md',
])}`;

function inventorySummary(ctx) {
    return ctx.pages.map((p) => {
        const inv = readJsonWs(ctx.workspaceRoot, `analysis/${p.page}.content-inventory.json`);
        return { page: p.page, sections: (inv?.sections || []).map((s) => s.selector || s.id).slice(0, 40), forms: inv?.forms?.length || 0 };
    });
}

export async function classifyContent(ctx) {
    if (ctx.options.stage0 === 'on') return true;
    if (ctx.options.stage0 === 'off') return false;
    const prompt = [
        'Decide whether this site needs a durable WordPress content model (CPTs/taxonomies/meta/submissions) that the owner manages in wp-admin, versus fixed page copy only.',
        'Say needed:true only for real managed collections (events, directory, catalog, journal, submissions), not for a visual card grid that is just page content.',
        `\nBRIEF:\n${ctx.brief}`,
        `\nPER-PAGE INVENTORY:\n${JSON.stringify(inventorySummary(ctx), null, 0)}`,
    ].join('\n');
    const res = await ctx.harness.complete({ id: 'classify_content', systemPrompt: HARNESS_PREAMBLE, prompt, schema: CLASSIFY_SCHEMA, ...judgeParams(ctx, 'build') });
    if (!res.ok) { ctx.log.warn(`classify_content failed (${res.error}); assuming no content model`); return false; }
    ctx.log.info(`content model ${res.data.needed ? 'needed' : 'not needed'}: ${res.data.reason || ''}`);
    return Boolean(res.data.needed);
}

export async function runContentModel(ctx) {
    ctx.log.step('stage0 · content modeling');
    // List stand-in marks (no model yet) so the model can cover them.
    const audit = await ctx.client.call('audit_standins', { workspaceRoot: ctx.workspaceRoot });

    const prompt = [
        'Author the WordPress content model JSON that backs this site\'s data-driven regions.',
        'The plugin.slug MUST NOT end in "-content" (that collides with the theme\'s page-import plugin); use e.g. "<site>-cpts".',
        'Cover every stand-in postType/taxonomy below. Include 3-6 seed entries for public content CPTs.',
        `\nSTAND-IN MARKS:\n${JSON.stringify(audit.standins || audit, null, 0)}`,
        `\nBRIEF:\n${ctx.brief}`,
        `\nPER-PAGE INVENTORY:\n${JSON.stringify(inventorySummary(ctx), null, 0)}`,
        '\nReturn { contentModel, notes }.',
    ].join('\n');
    const res = await ctx.harness.complete({ id: 'content_model', systemPrompt: MODEL_SYS(), prompt, schema: MODEL_SCHEMA, ...judgeParams(ctx, 'build') });
    if (!res.ok) throw new Error(`content_model failed — ${res.error}`);
    writeJsonWs(ctx.workspaceRoot, 'content-model/content-model.json', res.data.contentModel);
    if (res.data.notes) writeWs(ctx.workspaceRoot, 'content-model/content-model.md', `${res.data.notes}\n`);

    // Validate → bounded fix → scaffold.
    for (let iter = 1; iter <= ctx.options.maxRepair; iter++) {
        const report = await ctx.client.call('validate_content_model', { workspaceRoot: ctx.workspaceRoot });
        if (report.valid) break;
        ctx.log.debug(`content-model validate ${iter}: ${(report.errors || []).length} error(s)`);
        if (iter === ctx.options.maxRepair) { ctx.log.error('content model did not validate'); return { valid: false }; }
        const model = readJsonWs(ctx.workspaceRoot, 'content-model/content-model.json');
        const fix = await ctx.harness.complete({
            id: `content_model_fix:${iter}`, systemPrompt: MODEL_SYS(), ...judgeParams(ctx, 'build'),
            schema: { type: 'object', additionalProperties: false, required: ['contentModel'], properties: { contentModel: { type: 'object' } } },
            prompt: `Fix the content model so validate_content_model has zero errors.\n\nERRORS:\n${JSON.stringify(report.errors, null, 0)}\n\nCURRENT MODEL:\n${JSON.stringify(model)}`,
        });
        if (!fix.ok) { ctx.log.error(`content_model_fix failed: ${fix.error}`); return { valid: false }; }
        writeJsonWs(ctx.workspaceRoot, 'content-model/content-model.json', fix.data.contentModel);
    }

    const scaffolded = await ctx.client.call('scaffold_content_model_plugin', { workspaceRoot: ctx.workspaceRoot });
    ctx.log.ok(`content model plugin scaffolded`);
    return { valid: true, scaffolded };
}

// Runs after the Stage 1 visual gate has passed and the content plugin exists.
export async function runHydration(ctx) {
    const audit = await ctx.client.call('audit_standins', { workspaceRoot: ctx.workspaceRoot });
    if ((audit.errors || []).length) {
        ctx.log.warn(`stand-in audit has ${audit.errors.length} unresolved mark(s); skipping hydration`);
        return { hydrated: false, errors: audit.errors };
    }
    if (!audit.count) { ctx.log.info('no stand-ins to hydrate'); return { hydrated: false, count: 0 }; }
    const res = await ctx.client.call('hydrate_standins', { workspaceRoot: ctx.workspaceRoot });
    ctx.log.ok(`hydrated ${res.swaps?.length || 0} stand-in region(s)`);
    return { hydrated: true, swaps: res.swaps };
}

export const _schemas = { CLASSIFY_SCHEMA, MODEL_SCHEMA };
