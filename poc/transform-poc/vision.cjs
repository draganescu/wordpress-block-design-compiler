#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { loadEnvFiles, readOption } = require('./runtime.cjs');

loadEnvFiles();

const requireFromRoot = createRequire(path.join(process.cwd(), 'package.json'));
const { chromium } = requireFromRoot('playwright');
const { PNG } = requireFromRoot('pngjs');

const ROOT = path.resolve('poc/transform-poc');
const OUT = path.join(ROOT, 'output');
const VISION_OUT = path.join(OUT, 'vision');
const ITERATIONS_OUT = path.join(OUT, 'rendered/iterations');
const MOCKUP_HTML = path.join(OUT, 'mockup/index.html');
const RENDERED_HTML = path.join(OUT, 'rendered/rendered-blocks.html');
const BASE_RENDERED_HTML = path.join(OUT, 'rendered/rendered-blocks.base.html');
const FINAL_RENDERED_HTML = path.join(OUT, 'rendered/rendered-blocks.final.html');
const PLAN_JSON = path.join(OUT, 'plan/block-implementation-plan.json');
const BLOCK_TREE_JSON = path.join(OUT, 'wordpress/block-tree.json');
const MAX_REPAIR_PASSES = 3;
const DEFAULT_REPAIR_PROVIDER = 'deterministic';
const DEFAULT_OPENAI_VISION_MODEL = 'gpt-4.1';
const OPENAI_RESPONSES_URL = `${process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'}/responses`;
const OPENAI_TIMEOUT_MS = 120000;
const CONTEXT_CHAR_LIMIT = 18000;

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 1200 },
  { name: 'mobile', width: 390, height: 1200 },
];

async function main() {
  const { default: pixelmatch } = await import('pixelmatch');
  const repairProvider = resolveRepairProvider();

  assertRepairProviderReady(repairProvider);
  assertTransformOutputExists();
  resetVisionOutput();

  const baseRenderedHtml = stripPriorVisionRepairs(fs.readFileSync(RENDERED_HTML, 'utf8'));
  fs.writeFileSync(BASE_RENDERED_HTML, baseRenderedHtml, 'utf8');
  fs.writeFileSync(path.join(ITERATIONS_OUT, 'pass-0.html'), baseRenderedHtml, 'utf8');

  const browser = await chromium.launch({ headless: true });
  const passReports = [];
  const repairProposals = [];
  const appliedRepairs = [];
  let currentHtmlPath = path.join(ITERATIONS_OUT, 'pass-0.html');

  try {
    const mockupScreenshots = await captureMockupScreenshots(browser);

    for (let pass = 0; pass <= MAX_REPAIR_PASSES; pass += 1) {
      const viewports = [];
      for (const viewport of VIEWPORTS) {
        viewports.push(await compareViewport(browser, currentHtmlPath, pass, viewport, mockupScreenshots[viewport.name], pixelmatch));
      }

      const passReport = {
        pass,
        html: relativeToOutput(currentHtmlPath),
        repairsApplied: appliedRepairs.map((repair) => repair.id),
        viewports,
        aggregate: aggregateViewportResults(viewports),
      };
      passReports.push(passReport);

      if (isAcceptable(passReport) || pass === MAX_REPAIR_PASSES) {
        break;
      }

      const proposal = await proposeRepairPass({
        passReport,
        appliedRepairs,
        currentHtmlPath,
        repairProvider,
      });
      if (proposal.repairs.length === 0) {
        break;
      }

      repairProposals.push(proposal);
      appliedRepairs.push(...proposal.repairs);
      currentHtmlPath = path.join(ITERATIONS_OUT, `pass-${pass + 1}.html`);
      fs.writeFileSync(currentHtmlPath, injectRepairCss(baseRenderedHtml, appliedRepairs), 'utf8');
    }
  } finally {
    await browser.close();
  }

  fs.copyFileSync(currentHtmlPath, RENDERED_HTML);
  fs.copyFileSync(currentHtmlPath, FINAL_RENDERED_HTML);
  copyFinalScreenshots(passReports.at(-1));

  const report = buildVisionReport({ passReports, repairProposals, repairProvider });
  writeJson('visual-report.json', report);
  write('visual-report.md', renderMarkdownReport(report));
  write('llm-vision-brief.md', renderLlmVisionBrief(report));

  process.stdout.write(
    JSON.stringify(
      {
        visionReport: path.join(VISION_OUT, 'visual-report.md'),
        finalRenderedHtml: FINAL_RENDERED_HTML,
        finalPass: report.final.pass,
        viewports: report.final.viewports.map((viewport) => ({
          name: viewport.name,
          mismatchPercent: viewport.comparison.mismatchPercent,
          heightDelta: viewport.comparison.dimensionDelta.height,
        })),
      },
      null,
      2
    )
  );
  process.stdout.write('\n');
}

function assertTransformOutputExists() {
  for (const filePath of [MOCKUP_HTML, RENDERED_HTML]) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing ${filePath}. Run npm run poc:transform:html before npm run poc:vision.`);
    }
  }
}

function resetVisionOutput() {
  fs.rmSync(VISION_OUT, { recursive: true, force: true });
  fs.rmSync(ITERATIONS_OUT, { recursive: true, force: true });
  fs.mkdirSync(VISION_OUT, { recursive: true });
  fs.mkdirSync(ITERATIONS_OUT, { recursive: true });
}

async function captureMockupScreenshots(browser) {
  const screenshots = {};

  for (const viewport of VIEWPORTS) {
    const screenshot = path.join(VISION_OUT, `mockup-${viewport.name}.png`);
    await captureScreenshot(browser, MOCKUP_HTML, screenshot, viewport);
    screenshots[viewport.name] = screenshot;
  }

  return screenshots;
}

async function compareViewport(browser, renderedHtmlPath, pass, viewport, mockupScreenshot, pixelmatch) {
  const passOut = path.join(VISION_OUT, `pass-${pass}`);
  fs.mkdirSync(passOut, { recursive: true });

  const renderedScreenshot = path.join(passOut, `rendered-${viewport.name}.png`);
  const diffScreenshot = path.join(passOut, `diff-${viewport.name}.png`);

  await captureScreenshot(browser, renderedHtmlPath, renderedScreenshot, viewport);

  return {
    name: viewport.name,
    viewport: {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
    },
    screenshots: {
      mockup: relativeToOutput(mockupScreenshot),
      rendered: relativeToOutput(renderedScreenshot),
      diff: relativeToOutput(diffScreenshot),
    },
    comparison: compareScreenshots(mockupScreenshot, renderedScreenshot, diffScreenshot, pixelmatch),
  };
}

async function captureScreenshot(browser, htmlPath, screenshotPath, viewport) {
  const page = await browser.newPage({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
  });

  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });
    await page.addStyleTag({
      content: `
*, *::before, *::after {
  animation-delay: 0s !important;
  animation-duration: 0s !important;
  transition-delay: 0s !important;
  transition-duration: 0s !important;
  scroll-behavior: auto !important;
}
`,
    });
    await page.screenshot({ path: screenshotPath, fullPage: true, animations: 'disabled' });
  } finally {
    await page.close();
  }
}

function compareScreenshots(mockupPath, renderedPath, diffPath, pixelmatch) {
  const mockup = PNG.sync.read(fs.readFileSync(mockupPath));
  const rendered = PNG.sync.read(fs.readFileSync(renderedPath));
  const width = Math.min(mockup.width, rendered.width);
  const height = Math.min(mockup.height, rendered.height);
  const croppedMockup = cropPng(mockup, width, height);
  const croppedRendered = cropPng(rendered, width, height);
  const diff = new PNG({ width, height });

  const mismatchedPixels = pixelmatch(croppedMockup.data, croppedRendered.data, diff.data, width, height, {
    threshold: 0.1,
    includeAA: false,
    alpha: 0.12,
    diffColor: [218, 45, 73],
    diffColorAlt: [30, 112, 148],
    aaColor: [255, 178, 0],
  });

  fs.writeFileSync(diffPath, PNG.sync.write(diff));

  const comparedPixels = width * height;
  const mismatchRatio = comparedPixels === 0 ? 0 : mismatchedPixels / comparedPixels;

  return {
    mismatchedPixels,
    comparedPixels,
    mismatchPercent: roundPercent(mismatchRatio),
    comparedSize: { width, height },
    mockupSize: { width: mockup.width, height: mockup.height },
    renderedSize: { width: rendered.width, height: rendered.height },
    dimensionDelta: {
      width: Math.abs(mockup.width - rendered.width),
      height: Math.abs(mockup.height - rendered.height),
    },
  };
}

function cropPng(source, width, height) {
  if (source.width === width && source.height === height) {
    return source;
  }

  const cropped = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    const sourceStart = y * source.width * 4;
    const targetStart = y * width * 4;
    source.data.copy(cropped.data, targetStart, sourceStart, sourceStart + width * 4);
  }
  return cropped;
}

function aggregateViewportResults(viewports) {
  return {
    maxMismatchPercent: Math.max(...viewports.map((viewport) => viewport.comparison.mismatchPercent)),
    maxHeightDelta: Math.max(...viewports.map((viewport) => viewport.comparison.dimensionDelta.height)),
  };
}

function isAcceptable(passReport) {
  return passReport.aggregate.maxMismatchPercent <= 8 && passReport.aggregate.maxHeightDelta <= 80;
}

function resolveRepairProvider() {
  const requested = readOption(process.argv.slice(2), ['--provider', '--vision-provider']) || process.env.POC_VISION_REPAIR_PROVIDER || DEFAULT_REPAIR_PROVIDER;
  if (requested === 'auto') {
    return process.env.OPENAI_API_KEY ? 'openai' : 'deterministic';
  }
  if (['deterministic', 'openai', 'off'].includes(requested)) {
    return requested;
  }
  throw new Error(`Unsupported POC_VISION_REPAIR_PROVIDER "${requested}". Use deterministic, openai, auto, or off.`);
}

function assertRepairProviderReady(repairProvider) {
  if (repairProvider === 'openai' && !process.env.OPENAI_API_KEY) {
    throw new Error('POC_VISION_REPAIR_PROVIDER=openai requires OPENAI_API_KEY.');
  }
}

async function proposeRepairPass(context) {
  if (context.repairProvider === 'off') {
    return {
      afterPass: context.passReport.pass,
      nextPass: context.passReport.pass + 1,
      mode: 'off',
      trigger: triggerForPass(context.passReport),
      repairs: [],
    };
  }

  if (context.repairProvider === 'openai') {
    return proposeOpenAiVisionRepairPass(context);
  }

  return proposeDeterministicRepairPass(context);
}

async function proposeOpenAiVisionRepairPass(context) {
  const passOut = path.join(VISION_OUT, `pass-${context.passReport.pass}`);
  const requestSummaryPath = path.join(passOut, 'llm-repair-request.md');
  const responsePath = path.join(passOut, 'llm-repair-response.json');
  const proposalPath = path.join(passOut, 'llm-repair-proposal.json');
  const requestBody = buildOpenAiVisionRepairRequest(context);

  fs.writeFileSync(requestSummaryPath, renderOpenAiRequestSummary(context, requestBody), 'utf8');

  const response = await fetchWithTimeout(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI vision repair request failed with ${response.status}: ${responseText}`);
  }

  const responseJson = JSON.parse(responseText);
  fs.writeFileSync(responsePath, `${JSON.stringify(redactOpenAiResponse(responseJson), null, 2)}\n`, 'utf8');

  const parsedProposal = JSON.parse(extractOpenAiOutputText(responseJson));
  const proposal = normalizeOpenAiRepairProposal(parsedProposal, context, proposalPath);
  fs.writeFileSync(proposalPath, `${JSON.stringify(proposal, null, 2)}\n`, 'utf8');
  return proposal;
}

function buildOpenAiVisionRepairRequest(context) {
  return {
    model: process.env.OPENAI_VISION_MODEL || DEFAULT_OPENAI_VISION_MODEL,
    store: false,
    instructions: [
      'You are the vision repair planner for a WordPress block design compiler POC.',
      'Use screenshots and diffs to diagnose visual drift between a source HTML mockup and rendered WordPress block HTML.',
      'Return a small scoped CSS repair for this POC, but explain the preferred production repair location: core block structure, block attributes/supports, custom static block source, or scoped CSS.',
      'Do not propose raw HTML blocks unless core/custom static blocks cannot preserve both fidelity and editability.',
      'Do not include scripts, imports, network resources, or HTML in css.',
    ].join(' '),
    input: [
      {
        role: 'user',
        content: buildOpenAiVisionContent(context),
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'vision_repair_proposal',
        strict: true,
        schema: visionRepairSchema(),
      },
    },
  };
}

function buildOpenAiVisionContent(context) {
  const content = [
    {
      type: 'input_text',
      text: buildVisionRepairPrompt(context),
    },
  ];

  for (const viewport of context.passReport.viewports) {
    content.push(
      { type: 'input_text', text: `${viewport.name} source mockup screenshot` },
      { type: 'input_image', detail: 'high', image_url: imageDataUrl(path.join(OUT, viewport.screenshots.mockup)) },
      { type: 'input_text', text: `${viewport.name} rendered block screenshot for pass ${context.passReport.pass}` },
      { type: 'input_image', detail: 'high', image_url: imageDataUrl(path.join(OUT, viewport.screenshots.rendered)) },
      { type: 'input_text', text: `${viewport.name} PNG diff for pass ${context.passReport.pass}` },
      { type: 'input_image', detail: 'high', image_url: imageDataUrl(path.join(OUT, viewport.screenshots.diff)) }
    );
  }

  return content;
}

function buildVisionRepairPrompt({ passReport, appliedRepairs, currentHtmlPath }) {
  return [
    `Current pass: ${passReport.pass}`,
    `Aggregate mismatch: ${JSON.stringify(passReport.aggregate)}`,
    `Per-viewport comparison: ${JSON.stringify(
      passReport.viewports.map((viewport) => ({
        viewport: viewport.name,
        mismatchPercent: viewport.comparison.mismatchPercent,
        heightDelta: viewport.comparison.dimensionDelta.height,
        mockupSize: viewport.comparison.mockupSize,
        renderedSize: viewport.comparison.renderedSize,
      })),
      null,
      2
    )}`,
    `Already applied repairs: ${JSON.stringify(appliedRepairs.map((repair) => ({ id: repair.id, reason: repair.reason })), null, 2)}`,
    '',
    'Repair constraints:',
    '- Prefer core block structure, block attributes, and block supports before custom blocks.',
    '- Use custom blocks only for the smallest subtree needing a custom editor model, behavior, or markup contract.',
    '- Keep rich text, links, fields, labels, placeholders, repeated items, and inspector controls editable.',
    '- For this POC, return only scoped CSS in repairs[].css. Use preferredRealAction to describe where the production fix should live.',
    '- Explain expectedVisualEffect and editabilityRisk for each repair.',
    '- Keep CSS scoped to existing rendered block classes/selectors.',
    '- Do not include </style>, <script>, @import, external URLs, or broad universal resets.',
    '- If no CSS-only repair is appropriate, set stop=true and repairs=[].',
    '',
    `Block implementation plan:\n${readContextFile(PLAN_JSON)}`,
    '',
    `Block tree:\n${readContextFile(BLOCK_TREE_JSON)}`,
    '',
    `Current rendered HTML:\n${readContextFile(currentHtmlPath)}`,
  ].join('\n');
}

function visionRepairSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['stop', 'confidence', 'observedDiscrepancy', 'likelyCause', 'repairs'],
    properties: {
      stop: { type: 'boolean' },
      confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
      observedDiscrepancy: { type: 'string' },
      likelyCause: { type: 'string' },
      repairs: {
        type: 'array',
        maxItems: 2,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'reason', 'preferredRealAction', 'expectedVisualEffect', 'editabilityRisk', 'css'],
          properties: {
            id: { type: 'string' },
            reason: { type: 'string' },
            preferredRealAction: { type: 'string' },
            expectedVisualEffect: { type: 'string' },
            editabilityRisk: { type: 'string' },
            css: { type: 'string' },
          },
        },
      },
    },
  };
}

function normalizeOpenAiRepairProposal(raw, context, proposalPath) {
  const repairs = raw.stop ? [] : (raw.repairs || []).map(normalizeRepair).filter(Boolean);
  return {
    afterPass: context.passReport.pass,
    nextPass: context.passReport.pass + 1,
    mode: 'openai-vision',
    provider: {
      model: process.env.OPENAI_VISION_MODEL || DEFAULT_OPENAI_VISION_MODEL,
      response: relativeToOutput(path.join(VISION_OUT, `pass-${context.passReport.pass}`, 'llm-repair-response.json')),
      proposal: relativeToOutput(proposalPath),
    },
    trigger: triggerForPass(context.passReport),
    observedDiscrepancy: raw.observedDiscrepancy,
    likelyCause: raw.likelyCause,
    confidence: raw.confidence,
    repairs,
  };
}

function normalizeRepair(repair) {
  const id = slug(String(repair.id || 'openai-vision-repair'));
  const css = String(repair.css || '').trim();
  if (!css) return null;
  if (css.length > 12000) return null;
  if (/<\/?style|<\/?script|@import|url\s*\(/i.test(css)) return null;

  return {
    id,
    source: 'openai-vision',
    reason: String(repair.reason || '').trim(),
    preferredRealAction: String(repair.preferredRealAction || '').trim(),
    expectedVisualEffect: String(repair.expectedVisualEffect || '').trim(),
    editabilityRisk: String(repair.editabilityRisk || '').trim(),
    css,
  };
}

function proposeDeterministicRepairPass({ passReport, appliedRepairs }) {
  const appliedIds = new Set(appliedRepairs.map((repair) => repair.id));
  const repairs = [];

  if (!appliedIds.has('core-layout-selector-bridges')) {
    repairs.push({
      id: 'core-layout-selector-bridges',
      source: 'deterministic-poc-vision-proxy',
      reason: 'The diff shows large structural drift. The block tree uses core wrappers, so selectors from the mockup no longer map cleanly to the rendered block DOM.',
      preferredRealAction: 'Ask the LLM to revise the block plan with explicit core wrapper mapping before adding new custom blocks.',
      css: `.wp-block-group.hero.alignwide > .eyebrow,
.wp-block-group.hero.alignwide > h1,
.wp-block-group.hero.alignwide > .lede,
.wp-block-group.hero.alignwide > .wp-block-buttons {
  grid-column: 1;
}
.wp-block-group.hero.alignwide > .hero-object {
  grid-column: 2;
  grid-row: 1 / 5;
  width: 100%;
  align-self: end;
}
.wp-block-columns.product-grid {
  grid-template-columns: repeat(3, 1fr);
  gap: 18px;
}
.wp-block-poc-studio-inquiry .inquiry-columns {
  grid-template-columns: 1fr 420px;
}
@media (max-width: 760px) {
  .wp-block-group.hero.alignwide > .eyebrow,
  .wp-block-group.hero.alignwide > h1,
  .wp-block-group.hero.alignwide > .lede,
  .wp-block-group.hero.alignwide > .wp-block-buttons,
  .wp-block-group.hero.alignwide > .hero-object {
    grid-column: 1;
    grid-row: auto;
  }
  .wp-block-columns.product-grid,
  .wp-block-poc-studio-inquiry .inquiry-columns {
    grid-template-columns: 1fr;
  }
}`,
    });
  } else if (!appliedIds.has('core-block-spacing-reset')) {
    repairs.push({
      id: 'core-block-spacing-reset',
      source: 'deterministic-poc-vision-proxy',
      reason: 'The first structural repair still leaves block-library wrapper spacing that changes the page height and rhythm.',
      preferredRealAction: 'Ask the LLM to preserve the source spacing model through block supports, spacing attributes, or scoped CSS on the smallest affected wrapper.',
      css: `.wp-block-group.hero.alignwide > * {
  margin-top: 0;
}
.wp-block-buttons {
  margin-top: 22px;
}
.wp-block-column > :first-child {
  margin-top: 0;
}
.wp-block-column > :last-child {
  margin-bottom: 0;
}
.wp-block-poc-studio-inquiry .inquiry-columns {
  gap: 48px;
}`,
    });
  } else if (!appliedIds.has('semantic-form-width-lock')) {
    repairs.push({
      id: 'semantic-form-width-lock',
      source: 'deterministic-poc-vision-proxy',
      reason: 'The remaining drift is concentrated around the custom form panel width and block wrapper behavior.',
      preferredRealAction: 'Ask the LLM whether the custom inquiry block should expose a form width control or use a core column width attribute.',
      css: `.wp-block-poc-studio-inquiry .inquiry-panel {
  max-width: 420px;
}
@media (max-width: 760px) {
  .wp-block-poc-studio-inquiry .inquiry-panel {
    max-width: none;
  }
}`,
    });
  }

  return {
    afterPass: passReport.pass,
    nextPass: passReport.pass + 1,
    mode: 'deterministic-poc-vision-proxy',
    trigger: triggerForPass(passReport),
    repairs,
  };
}

function triggerForPass(passReport) {
  return {
    maxMismatchPercent: passReport.aggregate.maxMismatchPercent,
    maxHeightDelta: passReport.aggregate.maxHeightDelta,
  };
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function imageDataUrl(filePath) {
  const bytes = fs.readFileSync(filePath);
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

function readContextFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return `[missing: ${relativeToOutput(filePath)}]`;
  }

  return truncateMiddle(fs.readFileSync(filePath, 'utf8'), CONTEXT_CHAR_LIMIT);
}

function truncateMiddle(value, limit) {
  if (value.length <= limit) return value;

  const half = Math.floor((limit - 80) / 2);
  return `${value.slice(0, half)}\n\n[... ${value.length - half * 2} characters omitted ...]\n\n${value.slice(-half)}`;
}

function renderOpenAiRequestSummary(context, requestBody) {
  return `# OpenAI Vision Repair Request

Provider: OpenAI Responses API
Model: ${requestBody.model}
Pass: ${context.passReport.pass}

## Trigger

${JSON.stringify(triggerForPass(context.passReport), null, 2)}

## Images Sent

${context.passReport.viewports
  .flatMap((viewport) => [
    `- ${viewport.name} mockup: \`${viewport.screenshots.mockup}\``,
    `- ${viewport.name} rendered: \`${viewport.screenshots.rendered}\``,
    `- ${viewport.name} diff: \`${viewport.screenshots.diff}\``,
  ])
  .join('\n')}

## Prompt Text

${requestBody.input[0].content.find((item) => item.type === 'input_text').text}
`;
}

function extractOpenAiOutputText(responseJson) {
  if (typeof responseJson.output_text === 'string') {
    return responseJson.output_text;
  }

  for (const item of responseJson.output || []) {
    for (const content of item.content || []) {
      if (content.type === 'output_text' && typeof content.text === 'string') {
        return content.text;
      }
    }
  }

  throw new Error('OpenAI response did not include output_text.');
}

function redactOpenAiResponse(responseJson) {
  return {
    id: responseJson.id,
    object: responseJson.object,
    created_at: responseJson.created_at,
    status: responseJson.status,
    model: responseJson.model,
    output_text: responseJson.output_text || extractOpenAiOutputText(responseJson),
    usage: responseJson.usage,
  };
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'repair';
}

function injectRepairCss(html, repairs) {
  const css = repairs.map((repair, index) => `/* pass ${index + 1}: ${repair.id} */\n${repair.css}`).join('\n\n');
  return stripPriorVisionRepairs(html).replace(
    '</head>',
    `    <style data-poc-vision-repair="true">
${indent(css, 6)}
    </style>
  </head>`
  );
}

function stripPriorVisionRepairs(html) {
  return html.replace(/\s*<style data-poc-vision-repair="true">[\s\S]*?<\/style>/g, '');
}

function copyFinalScreenshots(finalPass) {
  if (!finalPass) return;

  for (const viewport of finalPass.viewports) {
    for (const kind of ['rendered', 'diff']) {
      const source = path.join(OUT, viewport.screenshots[kind]);
      const target = path.join(VISION_OUT, `${kind}-${viewport.name}.png`);
      fs.copyFileSync(source, target);
    }
  }
}

function buildVisionReport({ passReports, repairProposals, repairProvider }) {
  const final = passReports.at(-1);
  return {
    version: 3,
    source: {
      mockup: 'mockup/index.html',
      initialRendered: 'rendered/rendered-blocks.base.html',
      finalRendered: 'rendered/rendered-blocks.html',
      finalRenderedCopy: 'rendered/rendered-blocks.final.html',
    },
    comparator: {
      tool: 'playwright + pixelmatch',
      screenshotMode: 'fullPage',
      animations: 'disabled',
      maxRepairPasses: MAX_REPAIR_PASSES,
      acceptance: {
        maxMismatchPercent: 8,
        maxHeightDelta: 80,
      },
      note: 'Images are compared across the shared cropped area. Full-page dimension deltas are reported separately.',
    },
    strategy: {
      measurement: 'PNG diff is used as the deterministic score and regression signal.',
      interpretation: 'LLM vision should inspect screenshots and diffs to identify the visual cause, then propose the smallest block-tree, block-attribute, or scoped-CSS repair.',
      repairProvider,
      pocMode:
        repairProvider === 'openai'
          ? 'This POC used a brokered OpenAI vision repair request for each non-acceptable pass.'
          : 'This POC used a deterministic repair proxy. Set POC_VISION_REPAIR_PROVIDER=openai to use the brokered LLM vision step.',
    },
    passes: passReports,
    repairProposals,
    final,
    observations: buildObservations(final),
  };
}

function buildObservations(finalPass) {
  return finalPass.viewports.map((viewport) => {
    const { mismatchPercent, dimensionDelta } = viewport.comparison;

    if (dimensionDelta.height > 120) {
      return {
        viewport: viewport.name,
        severity: 'high',
        issue: 'Rendered page height still diverges from the mockup.',
        promptImplication: 'The transform planner should re-check layout primitives, responsive behavior, and spacing before choosing or styling blocks.',
      };
    }

    if (mismatchPercent > 10) {
      return {
        viewport: viewport.name,
        severity: 'medium',
        issue: 'Rendered pixels still diverge materially from the mockup.',
        promptImplication: 'The repair prompt should inspect high-diff regions and decide whether core block attributes, wrapper structure, or custom CSS need revision.',
      };
    }

    return {
      viewport: viewport.name,
      severity: 'low',
      issue: 'No large visual drift detected by this coarse POC comparator.',
      promptImplication: 'The transform can continue to semantic/editability checks before a final acceptance decision.',
    };
  });
}

function renderMarkdownReport(report) {
  const rows = report.passes
    .flatMap((pass) =>
      pass.viewports.map(
        (viewport) =>
          `| ${pass.pass} | ${viewport.name} | ${viewport.viewport.width}x${viewport.viewport.height} | ${viewport.comparison.mismatchPercent}% | ${viewport.comparison.dimensionDelta.width}px / ${viewport.comparison.dimensionDelta.height}px | \`${viewport.screenshots.diff}\` |`
      )
    )
    .join('\n');

  const repairs = report.repairProposals.length
    ? report.repairProposals
        .flatMap((proposal) =>
          proposal.repairs.map((repair) => {
            const expected = repair.expectedVisualEffect ? ` Expected effect: ${repair.expectedVisualEffect}` : '';
            const risk = repair.editabilityRisk ? ` Editability risk: ${repair.editabilityRisk}` : '';
            return `- after pass ${proposal.afterPass}, apply \`${repair.id}\` (${proposal.mode}): ${repair.reason} Real action: ${repair.preferredRealAction}${expected}${risk}`;
          })
        )
        .join('\n')
    : '- No repairs proposed.';

  const observations = report.observations
    .map((observation) => `- \`${observation.viewport}\` (${observation.severity}): ${observation.issue} ${observation.promptImplication}`)
    .join('\n');

  return `# Vision Comparison Report

## Summary

Final pass: ${report.final.pass}
Repair provider: ${report.strategy.repairProvider}

| Pass | Viewport | Size | Pixel mismatch | Width / height delta | Diff |
| ---: | --- | ---: | ---: | ---: | --- |
${rows}

## Repairs

${repairs}

## Final Screenshots

${report.final.viewports
  .map(
    (viewport) => `- \`${viewport.name}\`: mockup \`vision/mockup-${viewport.name}.png\`, rendered \`vision/rendered-${viewport.name}.png\`, diff \`vision/diff-${viewport.name}.png\``
  )
  .join('\n')}

## Observations

${observations}

## Comparator Notes

- PNG diff is the score and regression gate.
- LLM vision is the diagnosis and repair planner when \`POC_VISION_REPAIR_PROVIDER=openai\`.
- Full-page screenshots are captured with Playwright.
- Animations and transitions are disabled before capture to reduce noisy marquee diffs.
- Pixelmatch compares the shared cropped area and reports page-size deltas separately.
- This POC runs up to ${MAX_REPAIR_PASSES} repair passes.
`;
}

function renderLlmVisionBrief(report) {
  return `# LLM Vision Repair Brief

Use this brief shape for the brokered LLM call. The POC can call OpenAI directly with:

\`\`\`bash
npm run poc:transform:openai
\`\`\`

The OpenAI API key is read from the process environment or local env files such as \`.env.local\`.

## Inputs

- Source mockup HTML: \`${report.source.mockup}\`
- Initial rendered block HTML: \`${report.source.initialRendered}\`
- Final rendered block HTML from current POC loop: \`${report.source.finalRendered}\`
- Block tree: \`wordpress/block-tree.json\`
- Block implementation plan: \`plan/block-implementation-plan.json\`
- Screenshots and diffs: see \`vision/pass-*/\`

## Role

Interpret the visual differences between the mockup screenshot, rendered block screenshot, and PNG diff. The PNG diff is a measurement signal, not the diagnosis.

The current POC applies only scoped CSS from the returned proposal. The production implementation should apply the same diagnosis to the correct repair location: core block structure, block attributes/supports, custom static block source, or narrow bridge CSS.

## Repair Rules

- Prefer core block structure, block attributes, and block supports before custom blocks.
- Use custom blocks only for the smallest subtree that needs a custom editor model, behavior, or markup contract.
- Preserve editable rich text, links, form labels/placeholders, repeated items, and inspector controls.
- Do not use raw HTML blocks unless the plan explains why core/custom static blocks cannot preserve both fidelity and editability.
- Keep repairs scoped to the observed discrepancy.
- Stop after one to three repair passes, or earlier when visual drift is acceptable.

## Output

Return a repair proposal with:

- observed discrepancy
- likely cause in block tree, block wrapper DOM, CSS cascade, responsive behavior, or missing custom block
- scoped CSS patch for this POC
- preferred production repair location
- expected visual effect
- editability risk
`;
}

function write(relativePath, content) {
  const filePath = path.join(VISION_OUT, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function writeJson(relativePath, data) {
  write(relativePath, `${JSON.stringify(data, null, 2)}\n`);
}

function relativeToOutput(filePath) {
  return path.relative(OUT, filePath).split(path.sep).join('/');
}

function roundPercent(ratio) {
  return Number((ratio * 100).toFixed(2));
}

function indent(value, spaces) {
  const pad = ' '.repeat(spaces);
  return value
    .split('\n')
    .map((line) => (line.length ? `${pad}${line}` : ''))
    .join('\n');
}

main().catch((error) => {
  if (String(error && error.message).includes("Executable doesn't exist")) {
    error.message = `${error.message}\n\nInstall the Chromium browser with: npx playwright install chromium`;
  }
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
