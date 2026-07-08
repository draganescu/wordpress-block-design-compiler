// The suggestion-mode section-coverage gate: every mockup section heading must
// appear in the authored tree's text. Pure functions, no LLM/tools.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missingHeadings, normText, collectTreeText } from './stage1.mjs';

test('missingHeadings matches transferred headings through markup and entities', () => {
    const sections = [
        { heading: 'Gear & Kits — for Berlin' },
        { heading: "Calm nights, loud mornings" },
        { heading: 'Dropped Section That Never Made It' },
    ];
    const tree = {
        blocks: [
            { blockName: 'core/heading', attrs: { content: 'Gear &amp; Kits — for <em>Berlin</em>' }, innerBlocks: [] },
            {
                blockName: 'core/group', attrs: {},
                innerBlocks: [{ blockName: 'core/heading', attrs: { content: 'CALM   NIGHTS, loud mornings' }, innerBlocks: [] }],
            },
        ],
    };
    assert.deepEqual(missingHeadings(sections, tree), ['Dropped Section That Never Made It']);
});

test('missingHeadings never gates on short, empty, or absent headings', () => {
    const sections = [{ heading: '' }, { heading: 'Hi' }, {}, { heading: '   ' }];
    assert.deepEqual(missingHeadings(sections, { blocks: [] }), []);
});

test('collectTreeText walks nested attrs and normText flattens markup', () => {
    const text = collectTreeText([
        { blockName: 'core/paragraph', attrs: { content: 'One' }, innerBlocks: [
            { blockName: 'core/button', attrs: { text: 'Two' }, innerBlocks: [] },
        ] },
    ]).join(' ');
    assert.equal(normText(text), 'one two');
    assert.equal(normText('A&nbsp;&amp;&#8217;B <b>C</b>'), "a &’b c");
});
