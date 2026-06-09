import { cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  createEvent,
  ensureArtifactStructure,
  exists,
  listFiles,
  writeJson,
} from './artifact.js';
import type { FixtureBrief, FixtureRunResult, ProgressEvent } from './types.js';

export interface RunFixtureOptions {
  fixturePath: string;
  outDir: string;
}

export async function runFixture(options: RunFixtureOptions): Promise<FixtureRunResult> {
  const fixturePath = path.resolve(options.fixturePath);
  const outDir = path.resolve(options.outDir);
  const fixtureName = path.basename(fixturePath);
  const events: ProgressEvent[] = [];

  events.push(createEvent('stage_started', 'input', `Loading fixture ${fixtureName}`));

  const promptPath = path.join(fixturePath, 'prompt.md');
  const mockupPath = path.join(fixturePath, 'mockup');

  if (!(await exists(promptPath))) {
    throw new Error(`Fixture is missing prompt.md: ${promptPath}`);
  }

  if (!(await exists(path.join(mockupPath, 'index.html')))) {
    throw new Error(`Fixture is missing mockup/index.html: ${mockupPath}`);
  }

  const artifact = await ensureArtifactStructure(outDir);
  const prompt = await readFile(promptPath, 'utf8');
  const createdAt = new Date().toISOString();
  const brief: FixtureBrief = {
    source: 'fixture',
    fixtureName,
    prompt,
    createdAt,
  };

  await writeFile(path.join(artifact.input, 'prompt.md'), prompt, 'utf8');
  events.push(
    createEvent('file_written', 'input', 'Wrote fixture prompt', path.join(artifact.input, 'prompt.md'))
  );

  await writeJson(path.join(artifact.input, 'brief.json'), brief);
  events.push(
    createEvent('file_written', 'input', 'Wrote normalized fixture brief', path.join(artifact.input, 'brief.json'))
  );

  events.push(createEvent('stage_completed', 'input', `Loaded fixture ${fixtureName}`));

  events.push(createEvent('stage_started', 'mockup', 'Copying fixture mockup bundle'));
  await cp(mockupPath, artifact.mockup, { recursive: true, force: true });
  events.push(createEvent('stage_completed', 'mockup', 'Copied fixture mockup bundle', artifact.mockup));

  const expectedPath = path.join(fixturePath, 'expected');
  if (await exists(expectedPath)) {
    await cp(expectedPath, path.join(artifact.input, 'expected'), { recursive: true, force: true });
    events.push(
      createEvent('file_written', 'input', 'Copied fixture expectations', path.join(artifact.input, 'expected'))
    );
  }

  await writeJson(path.join(artifact.reports, 'events.json'), events);
  await writeJson(path.join(artifact.reports, 'files.json'), []);

  let files = await listFiles(artifact.root);
  await writeFile(path.join(artifact.reports, 'summary.md'), renderSummary(fixtureName, files), 'utf8');

  files = await listFiles(artifact.root);
  await writeJson(path.join(artifact.reports, 'files.json'), files);
  files = await listFiles(artifact.root);

  return {
    artifactRoot: artifact.root,
    events,
    files,
  };
}

function renderSummary(fixtureName: string, files: string[]): string {
  const fileList = files.map((file) => `- \`${file}\``).join('\n');

  return `# Fixture Run: ${fixtureName}

This artifact was generated from a local fixture. No model provider or WordPress runtime was used.

## Files

${fileList}
`;
}
