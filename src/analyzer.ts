import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import * as parse5 from 'parse5';
import * as csstree from 'css-tree';
import { writeJson } from './artifact.js';
import type {
  ContentItem,
  CssAnalysis,
  DomAnalysis,
  DomNodeSummary,
  InteractionAnalysis,
  MockupAnalysis,
  SectionAnalysis,
} from './types.js';

type Parse5Node = parse5.DefaultTreeAdapterMap['node'];
type Parse5Element = parse5.DefaultTreeAdapterMap['element'];
type Parse5Document = parse5.DefaultTreeAdapterMap['document'];

const TEXT_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'a', 'button', 'li']);

export interface AnalyzeMockupOptions {
  mockupDir: string;
  outDir: string;
}

export async function analyzeMockup(options: AnalyzeMockupOptions): Promise<MockupAnalysis> {
  const mockupDir = path.resolve(options.mockupDir);
  const outDir = path.resolve(options.outDir);
  const htmlPath = path.join(mockupDir, 'index.html');
  const cssPath = path.join(mockupDir, 'style.css');

  const html = await readFile(htmlPath, 'utf8');
  const css = await readOptional(cssPath);
  const document = parse5.parse(html);

  const analysis: MockupAnalysis = {
    dom: analyzeDom(document),
    css: analyzeCss(css),
    content: collectContent(document),
    sections: collectSections(document),
    interactions: collectInteractions(document),
  };

  await mkdir(outDir, { recursive: true });
  await writeJson(path.join(outDir, 'dom.json'), analysis.dom);
  await writeJson(path.join(outDir, 'css.json'), analysis.css);
  await writeJson(path.join(outDir, 'content.json'), analysis.content);
  await writeJson(path.join(outDir, 'sections.json'), analysis.sections);
  await writeJson(path.join(outDir, 'interactions.json'), analysis.interactions);

  return analysis;
}

async function readOptional(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

function analyzeDom(document: Parse5Document): DomAnalysis {
  const html = findFirst(document, 'html');
  const title = textContent(findFirst(document, 'title')).trim();

  return {
    title,
    language: html ? getAttr(html, 'lang') : undefined,
    root: html ? summarizeNode(html) : null,
    counts: {
      elements: findAll(document).length,
      links: findAll(document, 'a').length,
      images: findAll(document, 'img').length,
      buttons: findAll(document, 'button').length,
      forms: findAll(document, 'form').length,
      sections: findAll(document, 'section').length,
    },
  };
}

function analyzeCss(css: string): CssAnalysis {
  const customProperties: Record<string, string> = {};
  const selectors: string[] = [];
  const mediaQueries: string[] = [];
  let ruleCount = 0;

  if (!css.trim()) {
    return { customProperties, selectors, mediaQueries, ruleCount };
  }

  const ast = csstree.parse(css, {
    parseValue: true,
    parseCustomProperty: false,
  });

  csstree.walk(ast, (node) => {
    if (node.type === 'Rule') {
      ruleCount++;
      selectors.push(csstree.generate(node.prelude).trim());
    }

    if (node.type === 'Atrule' && node.name === 'media' && node.prelude) {
      mediaQueries.push(csstree.generate(node.prelude).trim());
    }

    if (node.type === 'Declaration' && node.property.startsWith('--')) {
      customProperties[node.property] = csstree.generate(node.value).trim();
    }
  });

  return {
    customProperties,
    selectors: unique(selectors),
    mediaQueries: unique(mediaQueries),
    ruleCount,
  };
}

function collectContent(root: Parse5Node): ContentItem[] {
  return findAll(root)
    .filter((element) => TEXT_TAGS.has(element.tagName))
    .map((element) => ({
      tagName: element.tagName,
      selector: selectorFor(element),
      text: collapseWhitespace(textContent(element)),
    }))
    .filter((item) => item.text.length > 0);
}

function collectSections(root: Parse5Node): SectionAnalysis[] {
  return findAll(root, 'section').map((section, index) => {
    const id = getAttr(section, 'id') ?? firstClass(section) ?? `section-${index + 1}`;
    const heading = findAll(section).find((element) => /^h[1-6]$/.test(element.tagName));
    const links = findAll(section, 'a').map((link) => ({
      text: collapseWhitespace(textContent(link)),
      href: getAttr(link, 'href') ?? '',
    }));

    return {
      id,
      selector: selectorFor(section),
      classes: classList(section),
      heading: heading ? collapseWhitespace(textContent(heading)) : undefined,
      textLength: collapseWhitespace(textContent(section)).length,
      links,
    };
  });
}

function collectInteractions(root: Parse5Node): InteractionAnalysis {
  return {
    links: findAll(root, 'a').map((link) => ({
      selector: selectorFor(link),
      text: collapseWhitespace(textContent(link)),
      href: getAttr(link, 'href') ?? '',
    })),
    buttons: findAll(root, 'button').map((button) => ({
      selector: selectorFor(button),
      text: collapseWhitespace(textContent(button)),
    })),
    forms: findAll(root, 'form').map((form) => ({
      selector: selectorFor(form),
    })),
    scripts: findAll(root, 'script').map((script) => ({
      src: getAttr(script, 'src'),
      inline: !getAttr(script, 'src'),
    })),
  };
}

function summarizeNode(element: Parse5Element): DomNodeSummary {
  return {
    tagName: element.tagName,
    id: getAttr(element, 'id'),
    classes: classList(element),
    textLength: collapseWhitespace(textContent(element)).length,
    children: childElements(element).map((child) => summarizeNode(child)),
  };
}

function findFirst(root: Parse5Node, tagName: string): Parse5Element | null {
  return findAll(root, tagName)[0] ?? null;
}

function findAll(root: Parse5Node, tagName?: string): Parse5Element[] {
  const out: Parse5Element[] = [];

  function walk(node: Parse5Node): void {
    if (isElement(node) && (!tagName || node.tagName === tagName)) {
      out.push(node);
    }

    for (const child of getChildren(node)) {
      walk(child);
    }
  }

  walk(root);
  return out;
}

function childElements(element: Parse5Element): Parse5Element[] {
  return getChildren(element).filter((child): child is Parse5Element => isElement(child));
}

function getChildren(node: Parse5Node): Parse5Node[] {
  if ('childNodes' in node && Array.isArray(node.childNodes)) {
    return node.childNodes;
  }

  return [];
}

function isElement(node: Parse5Node): node is Parse5Element {
  return 'tagName' in node && typeof node.tagName === 'string';
}

function getAttr(element: Parse5Element | null, name: string): string | undefined {
  if (!element) {
    return undefined;
  }

  const attr = element.attrs.find((candidate) => candidate.name === name);
  return attr?.value;
}

function classList(element: Parse5Element): string[] {
  return (getAttr(element, 'class') ?? '')
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function firstClass(element: Parse5Element): string | undefined {
  return classList(element)[0];
}

function textContent(node: Parse5Node | null): string {
  if (!node) {
    return '';
  }

  if ('value' in node && typeof node.value === 'string') {
    return node.value;
  }

  return getChildren(node)
    .map((child) => textContent(child))
    .join(' ');
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function selectorFor(element: Parse5Element): string {
  const id = getAttr(element, 'id');
  if (id) {
    return `${element.tagName}#${id}`;
  }

  const classes = classList(element);
  if (classes.length > 0) {
    return `${element.tagName}.${classes.join('.')}`;
  }

  return element.tagName;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
