export type ArtifactStage =
  | 'input'
  | 'mockup'
  | 'analysis'
  | 'plan'
  | 'wordpress'
  | 'preview'
  | 'reports';

export type ProgressEventType =
  | 'stage_started'
  | 'stage_completed'
  | 'file_written'
  | 'error';

export interface ProgressEvent {
  type: ProgressEventType;
  stage: ArtifactStage;
  message: string;
  path?: string;
  timestamp: string;
}

export interface ArtifactPaths {
  root: string;
  input: string;
  mockup: string;
  analysis: string;
  plan: string;
  wordpress: string;
  preview: string;
  reports: string;
}

export interface FixtureRunResult {
  artifactRoot: string;
  events: ProgressEvent[];
  files: string[];
}

export interface FixtureBrief {
  source: 'fixture';
  fixtureName: string;
  prompt: string;
  createdAt: string;
}
