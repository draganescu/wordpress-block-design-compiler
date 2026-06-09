import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runFixture } from '../src/fixtures.js';

test('runFixture creates the expected artifact structure', async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'wp-block-compiler-'));
  const fixturePath = path.resolve('fixtures/simple-landing');

  const result = await runFixture({
    fixturePath,
    outDir,
  });

  assert.equal(result.artifactRoot, outDir);
  assert.ok(result.files.includes('input/prompt.md'));
  assert.ok(result.files.includes('input/brief.json'));
  assert.ok(result.files.includes('mockup/index.html'));
  assert.ok(result.files.includes('mockup/style.css'));
  assert.ok(result.files.includes('reports/summary.md'));

  const brief = JSON.parse(await readFile(path.join(outDir, 'input/brief.json'), 'utf8')) as {
    source: string;
    fixtureName: string;
  };

  assert.equal(brief.source, 'fixture');
  assert.equal(brief.fixtureName, 'simple-landing');
});
