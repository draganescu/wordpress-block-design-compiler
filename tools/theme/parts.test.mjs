import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inferTemplateParts, structuralHash, exactHash } from './parts.mjs';
const MINI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/mini');

test('hashes: content changes break exact but not structural equality', () => {
    const a = { blockName: 'core/paragraph', attrs: { className: 'x', content: 'one' }, innerBlocks: [] };
    const b = { blockName: 'core/paragraph', attrs: { className: 'x', content: 'two' }, innerBlocks: [] };
    assert.notEqual(exactHash(a), exactHash(b));
    assert.equal(structuralHash(a), structuralHash(b));
    const c = { ...b, attrs: { className: 'y', content: 'two' } };
    assert.notEqual(structuralHash(b), structuralHash(c));
});

test('inferTemplateParts groups chrome across the mini fixture', () => {
    const report = inferTemplateParts({ workspaceRoot: MINI, write: false });
    const foot = report.groups.find((g) => g.occurrences.every((o) => o.tagName === 'footer'));
    assert.equal(foot.kind, 'exact');
    assert.deepEqual(foot.occurrences.map((o) => o.page).sort(), ['about', 'home']);
    assert.ok(foot.occurrences.every((o) => o.last));
    const top = report.groups.find((g) => g.occurrences.every((o) => o.tagName === 'header'));
    assert.equal(top.kind, 'structural');
    assert.ok(top.occurrences.every((o) => o.first));
    assert.equal(top.variance.length, 1);
    assert.equal(top.variance[0].path, '0:attrs.content'); // child 0's content differs
    assert.deepEqual(Object.keys(top.variance[0].values).sort(), ['about', 'home']);
    // page-unique sections are reported but not candidates
    assert.ok(report.singletons.some((s) => s.className === 'intro'));
});
