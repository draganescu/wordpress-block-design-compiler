import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ArtifactPaths, ArtifactStage, ProgressEvent } from './types.js';

export const ARTIFACT_STAGES: ArtifactStage[] = [
  'input',
  'mockup',
  'analysis',
  'plan',
  'wordpress',
  'preview',
  'reports',
];

export function artifactPaths(root: string): ArtifactPaths {
  const absoluteRoot = path.resolve(root);

  return {
    root: absoluteRoot,
    input: path.join(absoluteRoot, 'input'),
    mockup: path.join(absoluteRoot, 'mockup'),
    analysis: path.join(absoluteRoot, 'analysis'),
    plan: path.join(absoluteRoot, 'plan'),
    wordpress: path.join(absoluteRoot, 'wordpress'),
    preview: path.join(absoluteRoot, 'preview'),
    reports: path.join(absoluteRoot, 'reports'),
  };
}

export async function ensureArtifactStructure(root: string): Promise<ArtifactPaths> {
  const paths = artifactPaths(root);
  await mkdir(paths.root, { recursive: true });

  for (const stage of ARTIFACT_STAGES) {
    await mkdir(paths[stage], { recursive: true });
  }

  return paths;
}

export function createEvent(
  type: ProgressEvent['type'],
  stage: ArtifactStage,
  message: string,
  filePath?: string
): ProgressEvent {
  return {
    type,
    stage,
    message,
    path: filePath,
    timestamp: new Date().toISOString(),
  };
}

export async function writeJson(filePath: string, data: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export async function listFiles(root: string): Promise<string[]> {
  const out: string[] = [];

  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (entry.isFile()) {
        out.push(path.relative(root, fullPath));
      }
    }
  }

  if (await exists(root)) {
    await walk(root);
  }

  return out.sort();
}

export async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
