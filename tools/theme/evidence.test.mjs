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

test('parseCss exits media context across whitespace and consecutive blocks', () => {
    const rules = parseCss('@media (max-width:600px) {\n  .a { color: red; }\n}\n@media (min-width:900px) {\n  .b { color: blue; }\n}\n.c { color: green; }');
    assert.deepEqual(rules.map((r) => [r.selector, r.media]), [
        ['.a', '(max-width:600px)'],
        ['.b', '(min-width:900px)'],
        ['.c', null],
    ]);
    assert.deepEqual(rules[2].declarations, [['color', 'green']]);

    const spaced = parseCss('@media x{.a{color:red} }.c{color:green}');
    assert.deepEqual(spaced.map((r) => [r.selector, r.media]), [['.a', 'x'], ['.c', null]]);
});

test('parseCss skips blockless at-statements without swallowing the next rule', () => {
    const rules = parseCss('@import url("https://fonts.googleapis.com/css2?family=Inter");\n.a{color:red}\n.b{color:blue}');
    assert.deepEqual(rules.map((r) => r.selector), ['.a', '.b']);

    const layered = parseCss('@charset "utf-8";\n@layer reset, base;\n:root{--a:#fff}');
    assert.deepEqual(layered, [{ selector: ':root', media: null, declarations: [['--a', '#fff']] }]);
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
