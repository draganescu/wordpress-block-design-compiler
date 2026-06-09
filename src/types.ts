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

export interface DomNodeSummary {
  tagName: string;
  id?: string;
  classes: string[];
  textLength: number;
  children: DomNodeSummary[];
}

export interface DomAnalysis {
  title: string;
  language?: string;
  root: DomNodeSummary | null;
  counts: {
    elements: number;
    links: number;
    images: number;
    buttons: number;
    forms: number;
    sections: number;
  };
}

export interface CssAnalysis {
  customProperties: Record<string, string>;
  selectors: string[];
  mediaQueries: string[];
  ruleCount: number;
}

export interface ContentItem {
  tagName: string;
  selector: string;
  text: string;
}

export interface SectionAnalysis {
  id: string;
  selector: string;
  classes: string[];
  heading?: string;
  textLength: number;
  links: Array<{
    text: string;
    href: string;
  }>;
}

export interface InteractionAnalysis {
  links: Array<{
    selector: string;
    text: string;
    href: string;
  }>;
  buttons: Array<{
    selector: string;
    text: string;
  }>;
  forms: Array<{
    selector: string;
  }>;
  scripts: Array<{
    src?: string;
    inline: boolean;
  }>;
}

export interface MockupAnalysis {
  dom: DomAnalysis;
  css: CssAnalysis;
  content: ContentItem[];
  sections: SectionAnalysis[];
  interactions: InteractionAnalysis;
}
