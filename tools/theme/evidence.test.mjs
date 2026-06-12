import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCss, classifyRule, analyzeThemeEvidence } from './evidence.mjs';

const MINI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/mini');

test('parseCss flattens rules and tracks media context', () => {
    const rules = parseCss(`:root{--a:#fff}.x{color:#fff;position:fixed}@media (max-width:600px){.x{color:#000}}`);
    assert.equal(rules.length, 3);
    assert.deepEqual(rules[0], { selector: ':root', media: null, declarations: [['--a', '#fff']] });
    assert.equal(rules[2].media, '(max-width:600px)');
});

test('classifyRule buckets by lift-blocking feature', () => {
    assert.deepEqual(classifyRule({ selector: '.x::before', media: null, declarations: [['content', '"x"']] }), ['pseudo']);
    assert.deepEqual(classifyRule({ selector: '.x', media: '(max-width:600px)', declarations: [['color', 'red']] }), ['media-query']);
    assert.deepEqual(classifyRule({ selector: '.x:hover', media: null, declarations: [['transition', 'all .2s']] }), ['interaction']);
    assert.deepEqual(
        classifyRule({ selector: '.x', media: null, declarations: [['position', 'fixed'], ['mix-blend-mode', 'difference'], ['display', 'grid']] }).sort(),
        ['blend', 'grid', 'position']
    );
    assert.deepEqual(classifyRule({ selector: '.x', media: null, declarations: [['color', 'red']] }), []);
});

test('analyzeThemeEvidence reports pages, tokens, values and buckets', () => {
    const report = analyzeThemeEvidence({ workspaceRoot: MINI, write: false });
    assert.deepEqual(report.pages, ['about', 'home']);
    assert.equal(report.customProperties['--brand'].value, '#112233');
    const brand = report.colors.find((c) => c.value === '#112233');
    assert.ok(brand.count >= 4); // 2x attrs (intro bg, foot bg) + css var def + .badge css
    assert.ok(brand.names.includes('--brand'));
    assert.ok(brand.attrRefs.length >= 2 && brand.cssRefs.length >= 1);
    const pad = report.spacing.find((s) => s.value === 'clamp(10px,2vh,20px)');
    assert.ok(pad.count >= 2);
    assert.ok(report.supportUsage['core/group']['color.background'] >= 2);
    const fixedRule = report.cssRules.find((r) => r.selector === '.topbar');
    assert.deepEqual(fixedRule.buckets, ['position']);
    const plain = report.cssRules.find((r) => r.selector === 'body');
    assert.deepEqual(plain.buckets, []); // liftable — body styles belong in theme.json
});
