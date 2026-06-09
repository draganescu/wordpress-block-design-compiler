import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { analyzeMockup } from '../src/analyzer.js';

test('analyzeMockup writes structured mockup analysis files', async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'wp-block-analysis-'));
  const mockupDir = path.resolve('fixtures/simple-landing/mockup');

  const result = await analyzeMockup({
    mockupDir,
    outDir,
  });

  assert.equal(result.dom.title, 'Kiln & Kind');
  assert.equal(result.dom.language, 'en');
  assert.equal(result.dom.counts.sections, 5);
  assert.ok(result.dom.counts.links >= 5);

  assert.deepEqual(
    result.sections.map((section) => section.id),
    ['hero', 'story', 'collection', 'workshops', 'visit']
  );
  assert.equal(result.sections[0]?.heading, "Objects with weight, warmth, and a visible maker's hand.");
  assert.ok(result.content.some((item) => item.text === 'Book a studio visit'));
  assert.equal(result.css.customProperties['--clay'], '#a84f3d');
  assert.ok(result.css.mediaQueries.includes('(max-width:760px)'));
  assert.ok(result.interactions.links.some((link) => link.href === 'mailto:hello@example.com'));

  const sections = JSON.parse(await readFile(path.join(outDir, 'sections.json'), 'utf8')) as Array<{
    id: string;
  }>;
  assert.equal(sections.length, 5);
});
