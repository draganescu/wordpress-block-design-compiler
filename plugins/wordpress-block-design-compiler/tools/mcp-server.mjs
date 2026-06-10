#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const DEFAULT_VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 1200 },
  { name: 'mobile', width: 390, height: 1200 },
];

const TOOLS = [
  {
    name: 'create_workspace',
    description: 'Create a WordPress block design compiler workspace with mockup, plan, wordpress, rendered, and report folders.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['workspaceRoot', 'prompt'],
      properties: {
        workspaceRoot: { type: 'string' },
        prompt: { type: 'string' },
        force: { type: 'boolean', default: false },
      },
    },
  },
  {
    name: 'analyze_mockup',
    description: 'Analyze mockup/index.html and mockup/style.css into content inventory and CSS selector summaries.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['workspaceRoot'],
      properties: {
        workspaceRoot: { type: 'string' },
        htmlPath: { type: 'string', default: 'mockup/index.html' },
        cssPath: { type: 'string', default: 'mockup/style.css' },
      },
    },
  },
  {
    name: 'scaffold_custom_block',
    description: 'Generate a vanilla JavaScript WordPress custom block baseline with block.json, index.js, and style.css.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['workspaceRoot', 'name', 'attributes'],
      properties: {
        workspaceRoot: { type: 'string' },
        name: { type: 'string' },
        title: { type: 'string' },
        category: { type: 'string' },
        description: { type: 'string' },
        form: { type: 'boolean', default: false },
        attributes: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
            required: ['name', 'type'],
            properties: {
              name: { type: 'string' },
              type: { type: 'string', enum: ['string', 'number', 'boolean', 'array', 'object'] },
              role: { type: 'string' },
              default: {},
            },
          },
        },
      },
    },
  },
  {
    name: 'build_rendered_preview',
    description: 'Build wordpress/content.html and rendered/rendered-blocks.html from wordpress/block-tree.json plus mockup and block CSS.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['workspaceRoot'],
      properties: {
        workspaceRoot: { type: 'string' },
        treePath: { type: 'string', default: 'wordpress/block-tree.json' },
        contentPath: { type: 'string', default: 'wordpress/content.html' },
        outPath: { type: 'string', default: 'rendered/rendered-blocks.html' },
      },
    },
  },
  {
    name: 'compare_html',
    description: 'Capture mockup/rendered screenshots, generate pixel diffs, and write reports/comparison.json plus reports/repair-tasks.md.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['workspaceRoot'],
      properties: {
        workspaceRoot: { type: 'string' },
        mockupPath: { type: 'string', default: 'mockup/index.html' },
        renderedPath: { type: 'string', default: 'rendered/rendered-blocks.html' },
        maxMismatchPercent: { type: 'number', default: 1 },
        maxHeightDelta: { type: 'number', default: 8 },
        viewports: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name', 'width', 'height'],
            properties: {
              name: { type: 'string' },
              width: { type: 'number' },
              height: { type: 'number' },
            },
          },
        },
      },
    },
  },
];

const handlers = {
  create_workspace: createWorkspace,
  analyze_mockup: analyzeMockup,
  scaffold_custom_block: scaffoldCustomBlock,
  build_rendered_preview: buildRenderedPreview,
  compare_html: compareHtml,
};

let buffer = Buffer.alloc(0);

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  processIncoming();
});

function processIncoming() {
  while (buffer.length) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd >= 0) {
      const header = buffer.slice(0, headerEnd).toString('utf8');
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) throw new Error('Missing Content-Length header.');
      const length = Number(match[1]);
      const messageStart = headerEnd + 4;
      if (buffer.length < messageStart + length) return;
      const raw = buffer.slice(messageStart, messageStart + length).toString('utf8');
      buffer = buffer.slice(messageStart + length);
      void handleMessage(JSON.parse(raw));
      continue;
    }

    const newline = buffer.indexOf('\n');
    if (newline < 0) return;
    const line = buffer.slice(0, newline).toString('utf8').trim();
    buffer = buffer.slice(newline + 1);
    if (line) void handleMessage(JSON.parse(line));
  }
}

async function handleMessage(message) {
  if (!message || typeof message !== 'object') return;
  if (!Object.prototype.hasOwnProperty.call(message, 'id')) return;

  try {
    if (message.method === 'initialize') {
      return send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'wordpress-block-design-compiler', version: '0.1.0' },
        },
      });
    }

    if (message.method === 'tools/list') {
      return send({ jsonrpc: '2.0', id: message.id, result: { tools: TOOLS } });
    }

    if (message.method === 'tools/call') {
      const { name, arguments: args = {} } = message.params || {};
      if (!handlers[name]) throw new Error(`Unknown tool: ${name}`);
      const result = await handlers[name](args);
      return send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        },
      });
    }

    if (message.method === 'ping') {
      return send({ jsonrpc: '2.0', id: message.id, result: {} });
    }

    throw new Error(`Unsupported method: ${message.method}`);
  } catch (error) {
    send({
      jsonrpc: '2.0',
      id: message.id,
      error: {
        code: -32000,
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

function send(payload) {
  const body = JSON.stringify(payload);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
}

async function createWorkspace(args) {
  const workspaceRoot = resolvePath(args.workspaceRoot);
  if (fs.existsSync(workspaceRoot) && !args.force) {
    throw new Error(`Workspace exists: ${workspaceRoot}. Pass force=true to reuse it.`);
  }

  for (const dir of ['mockup', 'analysis', 'plan', 'wordpress/blocks', 'rendered', 'reports', 'visual']) {
    fs.mkdirSync(path.join(workspaceRoot, dir), { recursive: true });
  }

  writeFile(path.join(workspaceRoot, 'brief.md'), `${args.prompt.trim()}\n`);
  writeFile(path.join(workspaceRoot, 'mockup/index.html'), starterHtml(args.prompt));
  writeFile(path.join(workspaceRoot, 'mockup/style.css'), starterCss());
  writeJson(path.join(workspaceRoot, 'wordpress/block-tree.json'), { version: 1, blocks: [] });
  writeFile(path.join(workspaceRoot, 'wordpress/content.html'), '<!-- Generated from wordpress/block-tree.json by build_rendered_preview. -->\n');
  writeJson(path.join(workspaceRoot, 'plan/block-plan.json'), { sections: [], customBlocks: [] });
  copyReference('design-prompt.md', path.join(workspaceRoot, 'plan/design-prompt.md'));

  return {
    workspaceRoot,
    files: {
      brief: path.join(workspaceRoot, 'brief.md'),
      mockupHtml: path.join(workspaceRoot, 'mockup/index.html'),
      mockupCss: path.join(workspaceRoot, 'mockup/style.css'),
      blockPlan: path.join(workspaceRoot, 'plan/block-plan.json'),
      blockTree: path.join(workspaceRoot, 'wordpress/block-tree.json'),
      blockContent: path.join(workspaceRoot, 'wordpress/content.html'),
    },
    next: 'Replace the starter mockup with the designed HTML/CSS/JS, then call analyze_mockup. Assemble blocks in wordpress/block-tree.json.',
  };
}

async function analyzeMockup(args) {
  const workspaceRoot = resolvePath(args.workspaceRoot);
  const htmlPath = path.join(workspaceRoot, args.htmlPath || 'mockup/index.html');
  const cssPath = path.join(workspaceRoot, args.cssPath || 'mockup/style.css');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : '';
  const inventory = extractInventory(html);
  const analysis = {
    title: firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i) || '',
    sections: inventory.sections.map((section) => ({
      id: section.id,
      selector: section.selector,
      tagName: section.tagName,
      className: section.className,
      heading: section.headings[0]?.content || '',
      textLength: section.text.length,
      features: {
        forms: section.forms.length,
        links: section.links.length,
        cards: section.cards.length,
        headings: section.headings.length,
      },
    })),
    css: {
      customProperties: extractCustomProperties(css),
      selectors: extractSelectors(css),
    },
  };

  writeJson(path.join(workspaceRoot, 'analysis/content-inventory.json'), inventory);
  writeJson(path.join(workspaceRoot, 'analysis/analysis.json'), analysis);

  return {
    analysisPath: path.join(workspaceRoot, 'analysis/analysis.json'),
    inventoryPath: path.join(workspaceRoot, 'analysis/content-inventory.json'),
    sections: analysis.sections.length,
    forms: inventory.forms.length,
    links: inventory.links.length,
    selectors: analysis.css.selectors.length,
  };
}

async function scaffoldCustomBlock(args) {
  const workspaceRoot = resolvePath(args.workspaceRoot);
  const name = String(args.name || '').trim();
  if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(name)) {
    throw new Error('Block name must look like namespace/block-name.');
  }

  const slug = name.split('/')[1];
  const blockRoot = path.join(workspaceRoot, 'wordpress/blocks', slug);
  fs.mkdirSync(blockRoot, { recursive: true });
  const attributes = normalizeAttributes(args.attributes || [], Boolean(args.form));
  const title = args.title || titleCase(slug);
  const form = Boolean(args.form) || looksFormLike(name, attributes);

  writeJson(path.join(blockRoot, 'block.json'), {
    apiVersion: 3,
    name,
    title,
    category: args.category || (form ? 'forms' : 'design'),
    description: args.description || `${title} custom block generated by WordPress Block Design Compiler.`,
    editorScript: 'file:./index.js',
    style: 'file:./style.css',
    attributes: blockJsonAttributes(attributes),
    supports: defaultSupports(),
  });
  writeFile(path.join(blockRoot, 'index.js'), generateIndexJs({ name, title, slug, attributes, form }));
  writeFile(path.join(blockRoot, 'style.css'), generateBlockCss({ name, slug, form }));

  return {
    blockRoot,
    files: ['block.json', 'index.js', 'style.css'].map((file) => path.join(blockRoot, file)),
    next: 'Edit the generated block source to match the mockup component exactly, then reference it from wordpress/block-tree.json.',
  };
}

async function buildRenderedPreview(args) {
  const workspaceRoot = resolvePath(args.workspaceRoot);
  const treePath = path.join(workspaceRoot, args.treePath || 'wordpress/block-tree.json');
  const contentPath = path.join(workspaceRoot, args.contentPath || 'wordpress/content.html');
  const outPath = path.join(workspaceRoot, args.outPath || 'rendered/rendered-blocks.html');
  const treeExists = fs.existsSync(treePath);
  const blockMarkup = treeExists ? serializeBlockTree(readJson(treePath)) : null;
  const previewHtml = treeExists ? stripBlockComments(blockMarkup) : fs.readFileSync(contentPath, 'utf8');
  const cssParts = [
    readIfExists(path.join(workspaceRoot, 'mockup/style.css')),
    readIfExists(path.join(workspaceRoot, 'wordpress/style.css')),
    ...findFiles(path.join(workspaceRoot, 'wordpress/blocks'), 'style.css').map((file) => fs.readFileSync(file, 'utf8')),
  ].filter(Boolean);

  if (treeExists) writeFile(contentPath, `${blockMarkup.trim()}\n`);
  writeFile(outPath, fullHtml('Rendered WordPress Blocks', cssParts.join('\n\n'), previewHtml));
  return {
    treePath: treeExists ? treePath : null,
    contentPath,
    renderedPath: outPath,
    cssSources: cssParts.length,
    next: 'Call compare_html, inspect screenshots/diffs, then write repair tasks against wordpress/block-tree.json, block source, or CSS.',
  };
}

function serializeBlockTree(tree) {
  const blocks = Array.isArray(tree) ? tree : tree.blocks;
  if (!Array.isArray(blocks)) {
    throw new Error('Block tree must be an array or an object with a blocks array.');
  }
  const { serializeRawBlock } = loadWordPressBlocks();
  return blocks.map((block) => serializeRawBlock(normalizeRawBlock(block))).join('\n\n');
}

function normalizeRawBlock(block) {
  if (!block || typeof block !== 'object') throw new Error('Every block tree item must be an object.');
  const blockName = block.blockName || block.name;
  if (!blockName || typeof blockName !== 'string') throw new Error('Every block tree item needs blockName or name.');
  const innerBlocks = (block.innerBlocks || []).map(normalizeRawBlock);
  const hasInnerContent = Object.prototype.hasOwnProperty.call(block, 'innerContent');
  if (innerBlocks.length && !hasInnerContent) {
    throw new Error(`${blockName} has innerBlocks and must include innerContent with null placeholders.`);
  }
  const innerHTML = block.innerHTML ?? block.html ?? (Array.isArray(block.htmlLines) ? block.htmlLines.join('\n') : '');
  const innerContent = hasInnerContent ? block.innerContent : [innerHTML];
  const placeholderCount = innerContent.filter((item) => item === null).length;
  if (innerBlocks.length && placeholderCount !== innerBlocks.length) {
    throw new Error(`${blockName} innerContent must contain one null placeholder per inner block.`);
  }
  return {
    blockName,
    attrs: block.attrs || block.attributes || {},
    innerBlocks,
    innerHTML,
    innerContent,
  };
}

function loadWordPressBlocks() {
  try {
    return require('@wordpress/blocks');
  } catch (error) {
    throw new Error(`build_rendered_preview needs @wordpress/blocks. Run npm install in ${PLUGIN_ROOT}. Missing dependency: ${error.message}`);
  }
}

function stripBlockComments(markup) {
  return String(markup || '').replace(/<!--\s*\/?wp:[\s\S]*?-->\n?/g, '');
}

async function compareHtml(args) {
  const workspaceRoot = resolvePath(args.workspaceRoot);
  let chromium;
  let pixelmatch;
  let PNG;
  try {
    chromium = (await import('playwright')).chromium;
    pixelmatch = (await import('pixelmatch')).default;
    PNG = (await import('pngjs')).PNG;
  } catch (error) {
    throw new Error(`compare_html needs optional packages. Run npm install in ${PLUGIN_ROOT}. Missing dependency: ${error.message}`);
  }

  const mockupPath = path.join(workspaceRoot, args.mockupPath || 'mockup/index.html');
  const renderedPath = path.join(workspaceRoot, args.renderedPath || 'rendered/rendered-blocks.html');
  const outDir = path.join(workspaceRoot, 'visual');
  fs.mkdirSync(outDir, { recursive: true });
  const viewports = Array.isArray(args.viewports) && args.viewports.length ? args.viewports : DEFAULT_VIEWPORTS;
  const browser = await chromium.launch({ headless: true });
  const results = [];

  try {
    for (const viewport of viewports) {
      const mockupShot = path.join(outDir, `mockup-${viewport.name}.png`);
      const renderedShot = path.join(outDir, `rendered-${viewport.name}.png`);
      const diffShot = path.join(outDir, `diff-${viewport.name}.png`);
      await capture(browser, mockupPath, mockupShot, viewport);
      await capture(browser, renderedPath, renderedShot, viewport);
      results.push(comparePngs({ mockupShot, renderedShot, diffShot, viewport, PNG, pixelmatch }));
    }
  } finally {
    await browser.close();
  }

  const thresholds = {
    maxMismatchPercent: Number(args.maxMismatchPercent ?? 1),
    maxHeightDelta: Number(args.maxHeightDelta ?? 8),
  };
  const aggregate = {
    maxMismatchPercent: Math.max(...results.map((result) => result.mismatchPercent)),
    maxHeightDelta: Math.max(...results.map((result) => result.heightDelta)),
  };
  const tasks = comparisonTasks(results, thresholds);
  const report = { mockupPath, renderedPath, thresholds, aggregate, results, tasks };
  writeJson(path.join(workspaceRoot, 'reports/comparison.json'), report);
  writeFile(path.join(workspaceRoot, 'reports/repair-tasks.md'), renderRepairTasks(tasks, report));

  return {
    reportPath: path.join(workspaceRoot, 'reports/comparison.json'),
    tasksPath: path.join(workspaceRoot, 'reports/repair-tasks.md'),
    aggregate,
    passed: aggregate.maxMismatchPercent <= thresholds.maxMismatchPercent && aggregate.maxHeightDelta <= thresholds.maxHeightDelta,
    tasks,
  };
}

async function capture(browser, htmlPath, screenshotPath, viewport) {
  const page = await browser.newPage({
    viewport: { width: Number(viewport.width), height: Number(viewport.height) },
    deviceScaleFactor: 1,
  });
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });
    await page.addStyleTag({
      content: '*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}',
    });
    await page.screenshot({ path: screenshotPath, fullPage: true, animations: 'disabled' });
  } finally {
    await page.close();
  }
}

function comparePngs({ mockupShot, renderedShot, diffShot, viewport, PNG, pixelmatch }) {
  const mockup = PNG.sync.read(fs.readFileSync(mockupShot));
  const rendered = PNG.sync.read(fs.readFileSync(renderedShot));
  const width = Math.min(mockup.width, rendered.width);
  const height = Math.min(mockup.height, rendered.height);
  const diff = new PNG({ width, height });
  const mismatch = pixelmatch(
    cropPng(mockup, width, height, PNG).data,
    cropPng(rendered, width, height, PNG).data,
    diff.data,
    width,
    height,
    { threshold: 0.1 }
  );
  fs.writeFileSync(diffShot, PNG.sync.write(diff));
  return {
    viewport: viewport.name,
    size: `${viewport.width}x${viewport.height}`,
    mockup: mockupShot,
    rendered: renderedShot,
    diff: diffShot,
    mismatchPercent: Number(((mismatch / (width * height)) * 100).toFixed(2)),
    widthDelta: Math.abs(mockup.width - rendered.width),
    heightDelta: Math.abs(mockup.height - rendered.height),
  };
}

function cropPng(source, width, height, PNG) {
  if (source.width === width && source.height === height) return source;
  const cropped = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    const sourceStart = y * source.width * 4;
    const targetStart = y * width * 4;
    source.data.copy(cropped.data, targetStart, sourceStart, sourceStart + width * 4);
  }
  return cropped;
}

function comparisonTasks(results, thresholds) {
  const tasks = [];
  for (const result of results) {
    if (result.heightDelta > thresholds.maxHeightDelta) {
      tasks.push({
        priority: 'high',
        viewport: result.viewport,
        issue: `Rendered page height differs by ${result.heightDelta}px.`,
        target: 'macro layout / section vertical scale',
        fix: 'Inspect screenshots and restore missing content, section height, component scale, responsive columns, or vertical rhythm before fine polish.',
        verification: `Height delta <= ${thresholds.maxHeightDelta}px for ${result.viewport}.`,
        images: { mockup: result.mockup, rendered: result.rendered, diff: result.diff },
      });
    }
    if (result.mismatchPercent > thresholds.maxMismatchPercent) {
      tasks.push({
        priority: result.mismatchPercent > thresholds.maxMismatchPercent * 3 ? 'high' : 'medium',
        viewport: result.viewport,
        issue: `Pixel mismatch is ${result.mismatchPercent}%.`,
        target: 'visible differences in screenshot diff',
        fix: 'Inspect mockup/rendered/diff images. Write specific tasks for missing elements, wrong grid geometry, button layout, component scale, color, and typography.',
        verification: `Mismatch <= ${thresholds.maxMismatchPercent}% for ${result.viewport}.`,
        images: { mockup: result.mockup, rendered: result.rendered, diff: result.diff },
      });
    }
  }
  return tasks;
}

function renderRepairTasks(tasks, report) {
  const lines = [
    '# Repair Tasks',
    '',
    `Mockup: ${report.mockupPath}`,
    `Rendered: ${report.renderedPath}`,
    `Max mismatch: ${report.aggregate.maxMismatchPercent}%`,
    `Max height delta: ${report.aggregate.maxHeightDelta}px`,
    '',
  ];
  if (!tasks.length) {
    lines.push('No deterministic visual drift tasks. Inspect screenshots for residual polish.');
  } else {
    for (const task of tasks) {
      lines.push(
        `- [ ] Priority: ${task.priority}`,
        `  Viewport: ${task.viewport}`,
        `  Issue: ${task.issue}`,
        `  Target: ${task.target}`,
        `  Fix: ${task.fix}`,
        `  Verify: ${task.verification}`,
        `  Images: ${task.images.mockup}, ${task.images.rendered}, ${task.images.diff}`,
        ''
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

function extractInventory(html) {
  const sections = [];
  const sectionPattern = /<(header|section|footer|main|aside|article|nav)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let match;
  let index = 0;
  while ((match = sectionPattern.exec(html))) {
    index += 1;
    const tagName = match[1].toLowerCase();
    const attrs = parseAttrs(match[2]);
    const inner = match[3];
    const id = attrs['data-section'] || attrs.id || attrs.class || `${tagName}-${index}`;
    sections.push({
      id: slug(id) || `${tagName}-${index}`,
      selector: attrs.id ? `#${attrs.id}` : attrs.class ? `.${attrs.class.split(/\s+/)[0]}` : tagName,
      tagName,
      className: attrs.class || '',
      text: cleanText(inner),
      headings: extractHeadings(inner),
      paragraphs: extractParagraphs(inner),
      links: extractLinks(inner),
      forms: extractForms(inner),
      cards: extractCards(inner),
      html: match[0],
    });
  }
  return {
    sections,
    headings: extractHeadings(html),
    paragraphs: extractParagraphs(html),
    links: extractLinks(html),
    forms: extractForms(html),
    cards: extractCards(html),
  };
}

function extractHeadings(html) {
  return [...html.matchAll(/<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi)]
    .map((match) => ({ level: Number(match[1]), className: parseAttrs(match[2]).class || '', content: cleanText(match[3]) }))
    .filter((item) => item.content);
}

function extractParagraphs(html) {
  return [...html.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi)]
    .map((match) => ({ className: parseAttrs(match[1]).class || '', content: cleanText(match[2]) }))
    .filter((item) => item.content);
}

function extractLinks(html) {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
    .map((match) => {
      const attrs = parseAttrs(match[1]);
      return { className: attrs.class || '', url: attrs.href || '', text: cleanText(match[2]) };
    })
    .filter((item) => item.text || item.url);
}

function extractForms(html) {
  return [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)].map((match) => {
    const attrs = parseAttrs(match[1]);
    const inner = match[2];
    const fields = [...inner.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/gi)].map((labelMatch, index) => {
      const labelHtml = labelMatch[1];
      const control = firstMatch(labelHtml, /<(input|select|textarea)\b([^>]*)>/i, 0);
      const controlAttrs = control ? parseAttrs(control.replace(/^<\w+\s*|\s*\/?>$/g, '')) : {};
      return {
        label: cleanText(labelHtml.replace(/<(input|select|textarea)\b[\s\S]*$/i, '')) || `Field ${index + 1}`,
        type: control?.startsWith('<textarea') ? 'textarea' : control?.startsWith('<select') ? 'select' : controlAttrs.type || 'text',
        name: controlAttrs.name || '',
        placeholder: controlAttrs.placeholder || '',
        required: Object.prototype.hasOwnProperty.call(controlAttrs, 'required'),
      };
    });
    return {
      className: attrs.class || '',
      action: attrs.action || '',
      method: attrs.method || 'post',
      fields,
      buttonText: cleanText(firstMatch(inner, /<button\b[^>]*>([\s\S]*?)<\/button>/i) || ''),
    };
  });
}

function extractCards(html) {
  return [...html.matchAll(/<article\b([^>]*)>([\s\S]*?)<\/article>/gi)].map((match) => ({
    className: parseAttrs(match[1]).class || '',
    title: extractHeadings(match[2])[0]?.content || '',
    text: extractParagraphs(match[2])[0]?.content || '',
    links: extractLinks(match[2]),
  }));
}

function parseAttrs(value) {
  const attrs = {};
  for (const match of String(value || '').matchAll(/([:@A-Za-z0-9_-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    attrs[match[1]] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return attrs;
}

function extractCustomProperties(css) {
  const props = {};
  for (const match of css.matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*([^;]+);/g)) props[match[1]] = match[2].trim();
  return props;
}

function extractSelectors(css) {
  return [...new Set([...css.matchAll(/([^{}@]+)\{/g)].map((match) => match[1].trim()).filter(Boolean))];
}

function normalizeAttributes(attributes, form) {
  const normalized = attributes.map((attribute) => ({
    name: camelName(attribute.name),
    type: ['string', 'number', 'boolean', 'array', 'object'].includes(attribute.type) ? attribute.type : 'string',
    role: attribute.role || roleFromName(attribute.name),
    default: attribute.default,
  }));
  if (form && !normalized.some((attribute) => attribute.name === 'fields')) {
    normalized.push({ name: 'fields', type: 'array', role: 'form-fields', default: [] });
  }
  return normalized;
}

function blockJsonAttributes(attributes) {
  const payload = {};
  for (const attribute of attributes) {
    payload[attribute.name] = { type: attribute.type };
    if (attribute.default !== undefined) payload[attribute.name].default = attribute.default;
    else if (attribute.type === 'array') payload[attribute.name].default = [];
    else if (attribute.type === 'object') payload[attribute.name].default = {};
    else if (attribute.type === 'boolean') payload[attribute.name].default = false;
  }
  return payload;
}

function defaultSupports() {
  return {
    anchor: true,
    align: ['wide', 'full'],
    className: true,
    color: { text: true, background: true, gradients: true },
    spacing: { margin: true, padding: true, blockGap: true },
    typography: { fontSize: true, lineHeight: true },
    border: { color: true, radius: true, style: true, width: true },
    html: false,
  };
}

function generateIndexJs({ name, slug, attributes, form }) {
  const richText = attributes
    .filter((attribute) => isInlineEditable(attribute) && !(form && isButtonText(attribute)))
    .map((attribute) => richTextEdit(attribute, slug))
    .join(',\n        ');
  const inspector = attributes.filter((attribute) => !isInlineEditable(attribute) && attribute.type !== 'array' && attribute.type !== 'object').map(inspectorControl).join(',\n            ');
  const formCanvas = form ? formEditCanvas(slug) : '';
  const saveContent = form ? formSaveCanvas(slug) : attributes.filter((attribute) => isInlineEditable(attribute) || attribute.type === 'array').map((attribute) => saveElement(attribute, slug)).join(',\n          ');
  return `(function (blocks, blockEditor, components, element) {
  const el = element.createElement;
  const Fragment = element.Fragment;
  const registerBlockType = blocks.registerBlockType;
  const useBlockProps = blockEditor.useBlockProps;
  const RichText = blockEditor.RichText;
  const InspectorControls = blockEditor.InspectorControls;
  const PanelBody = components.PanelBody;
  const TextControl = components.TextControl;
  const ToggleControl = components.ToggleControl;

  registerBlockType(${JSON.stringify(name)}, {
    edit: function Edit(props) {
      const attributes = props.attributes;
      const setAttributes = props.setAttributes;
      const blockProps = useBlockProps({ className: ${JSON.stringify(slug)} });
      const fields = attributes.fields && attributes.fields.length ? attributes.fields : [{ label: 'Email address', type: 'email', name: 'email', placeholder: '', required: false }];
      const updateField = function (index, key, value) {
        const next = fields.slice();
        next[index] = Object.assign({}, next[index], { [key]: value });
        setAttributes({ fields: next });
      };

      return el(Fragment, null,
        ${inspector ? `el(InspectorControls, null, el(PanelBody, { title: 'Settings' }, ${inspector})),` : ''}
        el('section', blockProps,
          ${[richText, formCanvas].filter(Boolean).join(',\n          ') || "el('div', null)"}
        )
      );
    },

    save: function Save(props) {
      const attributes = props.attributes;
      const blockProps = useBlockProps.save({ className: ${JSON.stringify(slug)} });
      return el('section', blockProps,
          ${saveContent || "el('div', null)"}
      );
    }
  });
})(window.wp.blocks, window.wp.blockEditor, window.wp.components, window.wp.element);
`;
}

function richTextEdit(attribute, slugValue) {
  const tag = tagFor(attribute);
  return `el(RichText, {
            tagName: ${JSON.stringify(tag)},
            className: ${JSON.stringify(`${slugValue}__${slug(attribute.name)}`)},
            value: attributes.${attribute.name} || '',
            allowedFormats: ['core/bold', 'core/italic', 'core/link'],
            placeholder: ${JSON.stringify(titleCase(attribute.name))},
            onChange: function (value) { setAttributes({ ${attribute.name}: value }); }
          })`;
}

function inspectorControl(attribute) {
  if (attribute.type === 'boolean') {
    return `el(ToggleControl, { label: ${JSON.stringify(titleCase(attribute.name))}, checked: !!attributes.${attribute.name}, onChange: function (value) { setAttributes({ ${attribute.name}: value }); } })`;
  }
  const type = attribute.type === 'number' ? ', type: "number"' : '';
  const value = attribute.type === 'number' ? `Number(value)` : 'value';
  return `el(TextControl, { label: ${JSON.stringify(titleCase(attribute.name))}${type}, value: attributes.${attribute.name} || '', onChange: function (value) { setAttributes({ ${attribute.name}: ${value} }); } })`;
}

function formEditCanvas(slugValue) {
  return `el('form', { className: ${JSON.stringify(`${slugValue}__form`)} },
            fields.map(function (field, index) {
              return el('label', { key: field.name || index },
                el(RichText, {
                  tagName: 'span',
                  className: ${JSON.stringify(`${slugValue}__field-label`)},
                  value: field.label || '',
                  placeholder: 'Field label',
                  allowedFormats: ['core/bold', 'core/italic'],
                  onChange: function (value) { updateField(index, 'label', value); }
                }),
                field.type === 'textarea'
                  ? el('textarea', { name: field.name || '', placeholder: field.placeholder || '', required: !!field.required, disabled: true })
                  : el('input', { type: field.type || 'text', name: field.name || '', placeholder: field.placeholder || '', required: !!field.required, disabled: true })
              );
            }),
            el('button', { type: 'button', disabled: true },
              el(RichText, {
                tagName: 'span',
                value: attributes.buttonText || 'Submit',
                placeholder: 'Button text',
                allowedFormats: ['core/bold', 'core/italic'],
                onChange: function (value) { setAttributes({ buttonText: value }); }
              })
            )
          )`;
}

function formSaveCanvas(slugValue) {
  return `el('form', { className: ${JSON.stringify(`${slugValue}__form`)}, action: attributes.action || '#', method: attributes.method || 'post' },
            (attributes.fields || []).map(function (field, index) {
              const name = field.name || String(field.label || 'field-' + index).toLowerCase().replace(/[^a-z0-9]+/g, '-');
              return el('label', { key: name },
                field.label || name,
                field.type === 'textarea'
                  ? el('textarea', { name: name, placeholder: field.placeholder || '', required: !!field.required })
                  : el('input', { type: field.type || 'text', name: name, placeholder: field.placeholder || '', required: !!field.required })
              );
            }),
            el('button', { type: 'submit' }, attributes.buttonText || 'Submit')
          )`;
}

function saveElement(attribute, slugValue) {
  if (attribute.type === 'array') {
    return `el('div', { className: ${JSON.stringify(`${slugValue}__${slug(attribute.name)}`)} }, (attributes.${attribute.name} || []).map(function (item, index) { return el('article', { key: index }, item.title ? el('h3', null, item.title) : null, item.text ? el('p', null, item.text) : null); }))`;
  }
  if (!isInlineEditable(attribute)) return '';
  return `attributes.${attribute.name} ? el(RichText.Content, { tagName: ${JSON.stringify(tagFor(attribute))}, className: ${JSON.stringify(`${slugValue}__${slug(attribute.name)}`)}, value: attributes.${attribute.name} }) : null`;
}

function generateBlockCss({ name, slug: slugValue, form }) {
  const className = `wp-block-${name.replace('/', '-')}`;
  return `.${className} {
  box-sizing: border-box;
}

.${className} .${slugValue}__form {
  display: grid;
  gap: 1rem;
}

.${className} .${slugValue}__form label {
  display: grid;
  gap: 0.5rem;
}

.${className} .${slugValue}__form input,
.${className} .${slugValue}__form textarea,
.${className} .${slugValue}__form select,
.${className} .${slugValue}__form button {
  font: inherit;
}
${form ? '' : `\n.${className} [class$="__items"] { display: grid; gap: 1rem; }\n`}
`;
}

function isInlineEditable(attribute) {
  const role = `${attribute.role || ''} ${attribute.name}`.toLowerCase();
  if (/url|href|action|method|required|placeholder|inputname|style|variant|speed|duration|fields/.test(role)) return false;
  return attribute.type === 'string';
}

function isButtonText(attribute) {
  return /button|cta|submit/.test(`${attribute.role || ''} ${attribute.name}`.toLowerCase());
}

function tagFor(attribute) {
  const role = `${attribute.role || ''} ${attribute.name}`.toLowerCase();
  if (/heading|title|headline/.test(role)) return 'h2';
  if (/eyebrow|kicker|label/.test(role)) return 'p';
  if (/button|cta/.test(role)) return 'span';
  return 'p';
}

function roleFromName(name) {
  const value = String(name).toLowerCase();
  if (/heading|title|headline/.test(value)) return 'heading';
  if (/body|text|intro|description|copy|lede/.test(value)) return 'body';
  if (/button|cta|submit/.test(value)) return 'button-text';
  if (/url|href|link/.test(value)) return 'url';
  if (/fields?/.test(value)) return 'form-fields';
  return 'content';
}

function looksFormLike(name, attributes) {
  return /form|search|subscribe|booking|contact|inquiry|email/.test(`${name} ${attributes.map((attribute) => `${attribute.name} ${attribute.role}`).join(' ')}`.toLowerCase());
}

function starterHtml(prompt) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>WordPress Block Design Compiler Mockup</title>
    <link rel="stylesheet" href="./style.css">
  </head>
  <body>
    <main>
      <!-- Replace this starter with the designed source-of-truth mockup for:
${escapeHtml(prompt)}
      -->
    </main>
  </body>
</html>
`;
}

function starterCss() {
  return `:root {
  --paper: #f8f5ef;
  --ink: #181512;
}

* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); font-family: system-ui, sans-serif; }
`;
}

function fullHtml(title, css, body) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <style>
${css}
    </style>
  </head>
  <body>
${body}
  </body>
</html>
`;
}

function copyReference(name, target) {
  const source = path.join(PLUGIN_ROOT, 'skills/build-wordpress-block-site/references', name);
  if (fs.existsSync(source)) writeFile(target, fs.readFileSync(source, 'utf8'));
}

function findFiles(root, basename) {
  if (!fs.existsSync(root)) return [];
  const found = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) found.push(...findFiles(filePath, basename));
    else if (entry.name === basename) found.push(filePath);
  }
  return found;
}

function resolvePath(value) {
  if (!value) throw new Error('Path is required.');
  return path.resolve(String(value));
}

function readIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function writeJson(filePath, data) {
  writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function firstMatch(value, pattern, group = 1) {
  const match = String(value || '').match(pattern);
  return match ? match[group] : '';
}

function cleanText(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCase(value) {
  return String(value || '')
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function slug(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function camelName(value) {
  const raw = String(value || '').trim();
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(raw)) {
    return raw.charAt(0).toLowerCase() + raw.slice(1);
  }
  const parts = slug(raw).split('-').filter(Boolean);
  if (!parts.length) return 'field';
  return parts[0] + parts.slice(1).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
