#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { fetchWithTimeout, loadEnvFiles, readOption } = require('./runtime.cjs');

loadEnvFiles();

const requireFromRoot = createRequire(path.join(process.cwd(), 'package.json'));
const { chromium } = requireFromRoot('playwright');
const { PNG } = requireFromRoot('pngjs');
const blocks = requireFromRoot('@wordpress/blocks');
const element = requireFromRoot('@wordpress/element');

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
const DEFAULT_MAX_REPAIR_PASSES = 3;
const DEFAULT_REPAIR_PROVIDER = 'deterministic';
const DEFAULT_OPENAI_VISION_MODEL = 'gpt-4.1';
const OPENAI_RESPONSES_URL = `${process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'}/responses`;
const CONTEXT_CHAR_LIMIT = 18000;
const DEFAULT_MAX_MISMATCH_PERCENT = 8;
const DEFAULT_MAX_HEIGHT_DELTA = 80;

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 1200 },
  { name: 'mobile', width: 390, height: 1200 },
];

async function main() {
  const { default: pixelmatch } = await import('pixelmatch');
  const repairProvider = resolveRepairProvider();
  const maxRepairPasses = resolveMaxRepairPasses();
  const acceptanceThresholds = resolveAcceptanceThresholds();

  assertRepairProviderReady(repairProvider);
  assertTransformOutputExists();
  resetVisionOutput();

  const baseRenderedHtml = stripPriorVisionRepairs(fs.readFileSync(RENDERED_HTML, 'utf8'));
  const repairState = {
    baseRenderedHtml,
    blockTree: readJsonFile(BLOCK_TREE_JSON, []),
    blockTreeChanged: false,
    cssRepairs: [],
    htmlReplacements: [],
    renderedHtmlOverride: null,
  };
  fs.writeFileSync(BASE_RENDERED_HTML, baseRenderedHtml, 'utf8');
  fs.writeFileSync(path.join(ITERATIONS_OUT, 'pass-0.html'), baseRenderedHtml, 'utf8');

  const browser = await chromium.launch({ headless: true });
  const passReports = [];
  const repairProposals = [];
  const appliedRepairs = [];
  let stopReason = null;
  let currentHtmlPath = path.join(ITERATIONS_OUT, 'pass-0.html');

  try {
    const mockupScreenshots = await captureMockupScreenshots(browser);

    for (let pass = 0; pass <= maxRepairPasses; pass += 1) {
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

      if (isAcceptable(passReport, acceptanceThresholds)) {
        stopReason = {
          reason: 'accepted',
          pass,
          detail: `Visual drift is within the POC acceptance threshold: <= ${acceptanceThresholds.maxMismatchPercent}% max mismatch and <= ${acceptanceThresholds.maxHeightDelta}px max height delta.`,
        };
        break;
      }

      if (pass === maxRepairPasses) {
        stopReason = { reason: 'max-repair-passes', pass, detail: 'Reached the configured maximum repair pass count.' };
        break;
      }

      const proposal = await proposeRepairPass({
        passReport,
        appliedRepairs,
        currentHtmlPath,
        repairProvider,
        acceptanceThresholds,
      });
      if (proposal.repairs.length === 0) {
        repairProposals.push(proposal);
        stopReason = {
          reason: proposal.mode === 'off' ? 'repair-provider-off' : 'no-executable-repairs',
          pass,
          detail: proposal.mode === 'off' ? 'Vision repair provider is disabled.' : 'The repair provider returned no executable repairs for the current pass.',
        };
        break;
      }

      const appliedActionCount = applyRepairProposal(repairState, proposal);
      if (appliedActionCount === 0) {
        break;
      }

      repairProposals.push(proposal);
      appliedRepairs.push(...proposal.repairs);
      currentHtmlPath = path.join(ITERATIONS_OUT, `pass-${pass + 1}.html`);
      fs.writeFileSync(currentHtmlPath, renderRepairStateHtml(repairState), 'utf8');
    }
  } finally {
    await browser.close();
  }

  fs.copyFileSync(currentHtmlPath, RENDERED_HTML);
  fs.copyFileSync(currentHtmlPath, FINAL_RENDERED_HTML);
  copyFinalScreenshots(passReports.at(-1));

  const report = buildVisionReport({ passReports, repairProposals, repairProvider, maxRepairPasses, acceptanceThresholds, stopReason });
  writeJson('visual-report.json', report);
  write('visual-report.md', renderMarkdownReport(report));
  write('llm-vision-brief.md', renderLlmVisionBrief(report));

  process.stdout.write(
    JSON.stringify(
      {
        visionReport: path.join(VISION_OUT, 'visual-report.md'),
        finalRenderedHtml: FINAL_RENDERED_HTML,
        finalPass: report.final.pass,
        maxRepairPasses: report.comparator.maxRepairPasses,
        acceptance: report.comparator.acceptance,
        stopReason: report.stop.reason,
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

function isAcceptable(passReport, acceptanceThresholds) {
  return (
    passReport.aggregate.maxMismatchPercent <= acceptanceThresholds.maxMismatchPercent &&
    passReport.aggregate.maxHeightDelta <= acceptanceThresholds.maxHeightDelta
  );
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

function resolveMaxRepairPasses() {
  const raw =
    readOption(process.argv.slice(2), ['--max-repair-passes', '--vision-repair-passes']) ||
    process.env.POC_VISION_MAX_REPAIR_PASSES ||
    String(DEFAULT_MAX_REPAIR_PASSES);
  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 20) {
    throw new Error(`Invalid max repair passes "${raw}". Use an integer from 0 to 20.`);
  }

  return parsed;
}

function resolveAcceptanceThresholds() {
  return {
    maxMismatchPercent: resolveNumberOption({
      names: ['--max-mismatch-percent'],
      envName: 'POC_VISION_MAX_MISMATCH_PERCENT',
      fallback: DEFAULT_MAX_MISMATCH_PERCENT,
      label: 'max mismatch percent',
      min: 0,
      max: 100,
    }),
    maxHeightDelta: resolveNumberOption({
      names: ['--max-height-delta'],
      envName: 'POC_VISION_MAX_HEIGHT_DELTA',
      fallback: DEFAULT_MAX_HEIGHT_DELTA,
      label: 'max height delta',
      min: 0,
      max: 10000,
    }),
  };
}

function resolveNumberOption({ names, envName, fallback, label, min, max }) {
  const raw = readOption(process.argv.slice(2), names) || process.env[envName] || String(fallback);
  const parsed = Number(raw);

  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`Invalid ${label} "${raw}". Use a number from ${min} to ${max}.`);
  }

  return parsed;
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
      stop: true,
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

  const response = await fetchWithTimeout(
    OPENAI_RESPONSES_URL,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    },
    {
      label: `vision repair pass ${context.passReport.pass} (${requestBody.model})`,
    }
  );

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
      'You are the vision repair artifact generator for a WordPress block design compiler POC.',
      'Use screenshots and diffs to diagnose visual drift between a source HTML mockup and rendered WordPress block HTML.',
      'Choose the highest-leverage repair artifact and regenerate that complete artifact instead of returning granular patch actions.',
      'Prefer a complete block-tree replacement when structure, content, wrappers, editability, forms, or custom-block choices are wrong.',
      'Use a complete vision-css replacement only when the block structure is already semantically right and the drift is purely cascade, layout, spacing, typography, or color.',
      'Do not propose raw HTML blocks unless core/custom static blocks cannot preserve both fidelity and editability.',
      'Use rendered-html only as an explicitly justified escape hatch.',
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
        name: 'vision_repair_artifact',
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

function buildVisionRepairPrompt({ passReport, appliedRepairs, currentHtmlPath, acceptanceThresholds }) {
  return [
    `Current pass: ${passReport.pass}`,
    `Aggregate mismatch: ${JSON.stringify(passReport.aggregate)}`,
    `Acceptance thresholds: ${JSON.stringify(acceptanceThresholds)}`,
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
    `Already applied repairs: ${JSON.stringify(appliedRepairs.map((repair) => ({ id: repair.id, artifact: repair.artifact || repair.layer, reason: repair.reason })), null, 2)}`,
    '',
    'Repair constraints:',
    '- Choose one repair artifact that matches the cause: block-tree, vision-css, or rendered-html.',
    '- Prefer block-tree when block composition, block attributes, core block choice, custom block choice, wrappers, content, forms, links, or editability are wrong.',
    '- Use vision-css only when the structure is semantically correct and the remaining drift is purely visual styling.',
    '- Use rendered-html only as an escape hatch when neither block-tree nor vision-css can express the repair in this POC, and explain why.',
    '- For block-tree, return the complete replacement simplified block tree JSON array. Do not return a patch. Preserve all editable text, links, form labels, placeholders, repeated items, and inspector-style attributes.',
    '- For block-tree, each node must use {"name":"namespace/block","attributes":{},"innerBlocks":[]}. Do not use markdown code fences.',
    '- For block-tree, prefer core block structure, block attributes, and block supports before custom blocks or CSS.',
    '- For block-tree, use custom blocks only for the smallest subtree needing a custom editor model, behavior, or markup contract.',
    '- For block-tree, do not add generated custom blocks that are disguised HTML blocks with html/sourceHtml/markup/innerHTML/editableFields/sourceSelector blobs.',
    '- For vision-css, return the complete replacement vision repair stylesheet for this pass. Keep it scoped to existing rendered block classes/selectors.',
    '- For rendered-html, return the complete replacement HTML document. Do not use scripts, imports, or external URLs.',
    '- Keep rich text, links, fields, labels, placeholders, repeated items, and inspector controls editable.',
    '- If visible literal markup such as <label>, <a href>, <br>, or closing tags appears in the screenshot, choose block-tree and make the rendered HTML semantic.',
    '- Explain expectedVisualEffect and editabilityRisk for each repair.',
    '- If no executable repair is appropriate, set stop=true and repairs=[].',
    '',
    `Block implementation plan:\n${readContextFile(PLAN_JSON)}`,
    '',
    `Source mockup HTML:\n${readContextFile(MOCKUP_HTML)}`,
    '',
    `Indexed block tree paths:\n${renderIndexedBlockTree(readJsonFile(BLOCK_TREE_JSON, []))}`,
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
        maxItems: 1,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'artifact', 'reason', 'preferredRealAction', 'expectedVisualEffect', 'editabilityRisk', 'content'],
          properties: {
            id: { type: 'string' },
            artifact: { type: 'string', enum: ['block-tree', 'vision-css', 'rendered-html'] },
            reason: { type: 'string' },
            preferredRealAction: { type: 'string' },
            expectedVisualEffect: { type: 'string' },
            editabilityRisk: { type: 'string' },
            content: { type: 'string' },
          },
        },
      },
    },
  };
}

function normalizeOpenAiRepairProposal(raw, context, proposalPath) {
  const repairs = raw.stop ? [] : (raw.repairs || []).map(normalizeArtifactRepair).filter(Boolean);
  return {
    afterPass: context.passReport.pass,
    nextPass: context.passReport.pass + 1,
    mode: 'openai-vision-artifact',
    provider: {
      model: process.env.OPENAI_VISION_MODEL || DEFAULT_OPENAI_VISION_MODEL,
      response: relativeToOutput(path.join(VISION_OUT, `pass-${context.passReport.pass}`, 'llm-repair-response.json')),
      proposal: relativeToOutput(proposalPath),
    },
    trigger: triggerForPass(context.passReport),
    observedDiscrepancy: raw.observedDiscrepancy,
    likelyCause: raw.likelyCause,
    confidence: raw.confidence,
    stop: Boolean(raw.stop),
    repairs,
  };
}

function normalizeArtifactRepair(repair) {
  const id = slug(String(repair.id || 'openai-vision-artifact-repair'));
  const artifact = ['block-tree', 'vision-css', 'rendered-html'].includes(repair.artifact) ? repair.artifact : null;
  const content = String(repair.content || '').trim();
  if (!artifact || !content) return null;

  const normalized = {
    id,
    source: 'openai-vision',
    layer: artifactLayer(artifact),
    artifact,
    reason: String(repair.reason || '').trim(),
    preferredRealAction: String(repair.preferredRealAction || '').trim(),
    expectedVisualEffect: String(repair.expectedVisualEffect || '').trim(),
    editabilityRisk: String(repair.editabilityRisk || '').trim(),
  };

  if (artifact === 'block-tree') {
    const blockTree = normalizeBlockTreeJson(content);
    return blockTree ? { ...normalized, blockTree } : null;
  }

  if (artifact === 'vision-css') {
    const css = normalizeCss(content);
    return css ? { ...normalized, css } : null;
  }

  const html = normalizeRenderedHtml(content);
  return html ? { ...normalized, html } : null;
}

function artifactLayer(artifact) {
  if (artifact === 'block-tree') return 'artifact:block-tree';
  if (artifact === 'vision-css') return 'artifact:vision-css';
  return 'artifact:rendered-html';
}

function normalizeRepair(repair) {
  const id = slug(String(repair.id || 'openai-vision-repair'));
  const actions = normalizeRepairActions(repair);
  if (actions.length === 0) return null;

  return {
    id,
    source: 'openai-vision',
    layer: ['block-composition', 'block-styling', 'css', 'rendered-html'].includes(repair.layer) ? repair.layer : inferRepairLayer(actions),
    reason: String(repair.reason || '').trim(),
    preferredRealAction: String(repair.preferredRealAction || '').trim(),
    expectedVisualEffect: String(repair.expectedVisualEffect || '').trim(),
    editabilityRisk: String(repair.editabilityRisk || '').trim(),
    actions,
    css: actions
      .filter((action) => action.kind === 'css')
      .map((action) => action.css)
      .join('\n\n'),
  };
}

function normalizeRepairActions(repair) {
  const actions = [];

  if (Array.isArray(repair.actions)) {
    for (const action of repair.actions) {
      const normalized = normalizeRepairAction(action);
      if (normalized) actions.push(normalized);
    }
  }

  const legacyCss = normalizeCss(String(repair.css || ''));
  if (legacyCss) {
    actions.push({ kind: 'css', css: legacyCss });
  }

  return actions;
}

function normalizeRepairAction(action) {
  const kind = String(action && action.kind ? action.kind : '').trim();

  if (kind === 'css') {
    const css = normalizeCss(String(action.css || ''));
    return css ? { kind, css } : null;
  }

  if (kind === 'set-block-attributes') {
    const blockPath = normalizeBlockPath(action.blockPath);
    const attributes = parseJsonObject(action.attributesJson);
    return blockPath && attributes ? { kind, blockPath, attributes } : null;
  }

  if (kind === 'replace-block') {
    const blockPath = normalizeBlockPath(action.blockPath);
    const block = normalizeBlockJson(action.blockJson);
    return blockPath && block ? { kind, blockPath, block } : null;
  }

  if (kind === 'delete-block') {
    const blockPath = normalizeBlockPath(action.blockPath);
    return blockPath ? { kind, blockPath } : null;
  }

  if (kind === 'insert-block') {
    const parentPath = normalizeBlockPath(action.parentPath, { allowRoot: true });
    const block = normalizeBlockJson(action.blockJson);
    const index = Number.isInteger(Number(action.index)) ? Number(action.index) : null;
    return parentPath && block && index !== null && index >= 0 ? { kind, parentPath, index, block } : null;
  }

  if (kind === 'html-replace') {
    const find = String(action.find || '');
    const replace = String(action.replace || '');
    if (!find || find.length > 12000 || replace.length > 12000) return null;
    if (/<\/?script|@import/i.test(replace)) return null;
    return { kind, find, replace };
  }

  return null;
}

function normalizeCss(value) {
  const css = stripMarkdownFence(value).trim();
  if (!css) return null;
  if (css.length > 12000) return null;
  if (/<\/?style|<\/?script|@import|url\s*\(/i.test(css)) return null;
  return css;
}

function normalizeBlockPath(value, { allowRoot = false } = {}) {
  if (!Array.isArray(value)) return null;
  if (value.length === 0) return allowRoot ? [] : null;
  if (value.length > 10) return null;

  const pathItems = value.map((item) => Number(item));
  return pathItems.every((item) => Number.isInteger(item) && item >= 0) ? pathItems : null;
}

function parseJsonObject(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeBlockJson(value) {
  const parsed = parseJsonObject(value);
  if (!parsed || typeof parsed.name !== 'string') return null;
  return {
    name: parsed.name,
    attributes: parsed.attributes && typeof parsed.attributes === 'object' && !Array.isArray(parsed.attributes) ? parsed.attributes : {},
    innerBlocks: Array.isArray(parsed.innerBlocks) ? parsed.innerBlocks.map((block) => normalizeBlockObject(block)).filter(Boolean) : [],
  };
}

function normalizeBlockTreeJson(value) {
  try {
    const parsed = JSON.parse(stripMarkdownFence(value));
    if (!Array.isArray(parsed)) return null;
    const blockTree = parsed.map((block) => normalizeBlockObject(block)).filter(Boolean);
    return blockTree.length ? blockTree : null;
  } catch {
    return null;
  }
}

function normalizeBlockObject(block) {
  if (!block || typeof block.name !== 'string') return null;
  const attributes = block.attributes && typeof block.attributes === 'object' && !Array.isArray(block.attributes) ? block.attributes : parseJsonObject(block.attributesJson) || {};
  return {
    name: block.name,
    attributes,
    innerBlocks: Array.isArray(block.innerBlocks) ? block.innerBlocks.map((child) => normalizeBlockObject(child)).filter(Boolean) : [],
  };
}

function normalizeRenderedHtml(value) {
  const html = stripMarkdownFence(value).trim();
  if (!html || html.length > 200000) return null;
  if (!/<!doctype html>|<html[\s>]/i.test(html) || !/<body[\s>]/i.test(html)) return null;
  if (/<\/?script|@import|url\s*\(/i.test(html)) return null;
  return html;
}

function stripMarkdownFence(value) {
  return String(value || '')
    .trim()
    .replace(/^```(?:json|html|css)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function inferRepairLayer(actions) {
  if (actions.some((action) => ['replace-block', 'delete-block', 'insert-block'].includes(action.kind))) return 'block-composition';
  if (actions.some((action) => action.kind === 'set-block-attributes')) return 'block-styling';
  if (actions.some((action) => action.kind === 'html-replace')) return 'rendered-html';
  return 'css';
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
    stop: repairs.length === 0,
    trigger: triggerForPass(passReport),
    repairs,
  };
}

function applyRepairProposal(state, proposal) {
  let appliedActionCount = 0;

  for (const repair of proposal.repairs || []) {
    if (repair.artifact && applyArtifactRepair(state, repair)) {
      appliedActionCount += 1;
      continue;
    }

    const actions = Array.isArray(repair.actions) && repair.actions.length ? repair.actions : legacyRepairActions(repair);
    for (const action of actions) {
      if (applyRepairAction(state, repair, action)) {
        appliedActionCount += 1;
      }
    }
  }

  if (state.blockTreeChanged) {
    writeBlockArtifacts(state.blockTree);
  }

  return appliedActionCount;
}

function applyArtifactRepair(state, repair) {
  if (repair.artifact === 'block-tree') {
    state.blockTree = repair.blockTree;
    state.blockTreeChanged = true;
    state.renderedHtmlOverride = null;
    return true;
  }

  if (repair.artifact === 'vision-css') {
    state.cssRepairs = [
      {
        id: repair.id,
        source: repair.source || proposalSource(repair),
        css: repair.css,
      },
    ];
    return true;
  }

  if (repair.artifact === 'rendered-html') {
    state.renderedHtmlOverride = repair.html;
    return true;
  }

  return false;
}

function legacyRepairActions(repair) {
  const css = normalizeCss(String(repair.css || ''));
  return css ? [{ kind: 'css', css }] : [];
}

function applyRepairAction(state, repair, action) {
  if (action.kind === 'css') {
    state.cssRepairs.push({
      id: repair.id,
      source: repair.source || proposalSource(repair),
      css: action.css,
    });
    return true;
  }

  if (action.kind === 'set-block-attributes') {
    const block = getBlockAtPath(state.blockTree, action.blockPath);
    if (!block) return false;
    block.attributes = { ...(block.attributes || {}), ...action.attributes };
    state.blockTreeChanged = true;
    return true;
  }

  if (action.kind === 'replace-block') {
    if (!replaceBlockAtPath(state.blockTree, action.blockPath, action.block)) return false;
    state.blockTreeChanged = true;
    return true;
  }

  if (action.kind === 'delete-block') {
    if (!deleteBlockAtPath(state.blockTree, action.blockPath)) return false;
    state.blockTreeChanged = true;
    return true;
  }

  if (action.kind === 'insert-block') {
    if (!insertBlockAtPath(state.blockTree, action.parentPath, action.index, action.block)) return false;
    state.blockTreeChanged = true;
    return true;
  }

  if (action.kind === 'html-replace') {
    state.htmlReplacements.push({ find: action.find, replace: action.replace });
    return true;
  }

  return false;
}

function proposalSource(repair) {
  return repair.source || 'vision-repair';
}

function renderRepairStateHtml(state) {
  let html = state.renderedHtmlOverride || (state.blockTreeChanged ? replaceMainHtml(state.baseRenderedHtml, renderBlockTreeFragment(state.blockTree)) : state.baseRenderedHtml);

  for (const replacement of state.htmlReplacements) {
    html = html.split(replacement.find).join(replacement.replace);
  }

  return injectRepairCss(html, state.cssRepairs);
}

function writeBlockArtifacts(blockTree) {
  const blockMarkup = renderBlockTreeMarkup(blockTree);
  fs.writeFileSync(BLOCK_TREE_JSON, `${JSON.stringify(blockTree, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(OUT, 'wordpress/content.html'), blockMarkup, 'utf8');
  fs.writeFileSync(path.join(OUT, 'rendered/rendered-fragment.html'), stripBlockComments(blockMarkup), 'utf8');
}

function renderBlockTreeFragment(blockTree) {
  return stripBlockComments(renderBlockTreeMarkup(blockTree));
}

function renderBlockTreeMarkup(blockTree) {
  registerVisionBlocks(blockTree);
  return blocks.serialize(simplifiedToBlocks(blockTree));
}

function replaceMainHtml(html, fragment) {
  const indentedFragment = indent(fragment.trim(), 6);
  if (/<main>[\s\S]*?<\/main>/.test(html)) {
    return html.replace(/<main>[\s\S]*?<\/main>/, `<main>\n${indentedFragment}\n    </main>`);
  }

  return html.replace('</body>', `<main>\n${indentedFragment}\n    </main>\n  </body>`);
}

function getBlockAtPath(blockTree, blockPath) {
  let list = blockTree;
  let block = null;

  for (const index of blockPath) {
    if (!Array.isArray(list) || !list[index]) return null;
    block = list[index];
    list = block.innerBlocks || [];
  }

  return block;
}

function getBlockListAtPath(blockTree, parentPath) {
  if (parentPath.length === 0) return blockTree;
  const parent = getBlockAtPath(blockTree, parentPath);
  if (!parent) return null;
  if (!Array.isArray(parent.innerBlocks)) parent.innerBlocks = [];
  return parent.innerBlocks;
}

function replaceBlockAtPath(blockTree, blockPath, replacement) {
  const parentPath = blockPath.slice(0, -1);
  const index = blockPath.at(-1);
  const list = getBlockListAtPath(blockTree, parentPath);
  if (!list || !list[index]) return false;
  list[index] = replacement;
  return true;
}

function deleteBlockAtPath(blockTree, blockPath) {
  const parentPath = blockPath.slice(0, -1);
  const index = blockPath.at(-1);
  const list = getBlockListAtPath(blockTree, parentPath);
  if (!list || !list[index]) return false;
  list.splice(index, 1);
  return true;
}

function insertBlockAtPath(blockTree, parentPath, index, block) {
  const list = getBlockListAtPath(blockTree, parentPath);
  if (!list || index > list.length) return false;
  list.splice(index, 0, block);
  return true;
}

function triggerForPass(passReport) {
  return {
    maxMismatchPercent: passReport.aggregate.maxMismatchPercent,
    maxHeightDelta: passReport.aggregate.maxHeightDelta,
  };
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

function readJsonFile(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function renderIndexedBlockTree(blockTree) {
  const lines = [];

  function visit(list, pathItems) {
    for (let index = 0; index < list.length; index += 1) {
      const block = list[index];
      const blockPath = [...pathItems, index];
      const attributes = block.attributes || {};
      const label = [attributes.className, attributes.content, attributes.html, attributes.text]
        .filter(Boolean)
        .map((value) => cleanForLine(String(value)))
        .find(Boolean);
      lines.push(`${JSON.stringify(blockPath)} ${block.name}${label ? ` :: ${label}` : ''}`);
      visit(block.innerBlocks || [], blockPath);
    }
  }

  visit(blockTree || [], []);
  return lines.length ? lines.join('\n') : '(empty block tree)';
}

function cleanForLine(value) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 160);
}

function registerVisionBlocks(blockTree) {
  safeRegister('core/group', {
    apiVersion: 3,
    title: 'Group',
    category: 'design',
    attributes: {
      className: { type: 'string' },
      tagName: { type: 'string', default: 'div' },
    },
    save: ({ attributes }) =>
      element.createElement(
        attributes.tagName || 'div',
        blocks.__unstableGetInnerBlocksProps({ className: ['wp-block-group', attributes.className].filter(Boolean).join(' ') })
      ),
  });

  safeRegister('core/columns', {
    apiVersion: 3,
    title: 'Columns',
    category: 'design',
    attributes: { className: { type: 'string' } },
    save: ({ attributes }) =>
      element.createElement('div', blocks.__unstableGetInnerBlocksProps({ className: ['wp-block-columns', attributes.className].filter(Boolean).join(' ') })),
  });

  safeRegister('core/column', {
    apiVersion: 3,
    title: 'Column',
    category: 'design',
    attributes: { className: { type: 'string' } },
    save: ({ attributes }) =>
      element.createElement('div', blocks.__unstableGetInnerBlocksProps({ className: ['wp-block-column', attributes.className].filter(Boolean).join(' ') })),
  });

  safeRegister('core/heading', {
    apiVersion: 3,
    title: 'Heading',
    category: 'text',
    attributes: {
      level: { type: 'number', default: 2 },
      content: { type: 'string' },
      className: { type: 'string' },
    },
    save: ({ attributes }) =>
      element.createElement(`h${attributes.level || 2}`, { className: attributes.className }, element.createElement(element.RawHTML, null, attributes.content || '')),
  });

  safeRegister('core/paragraph', {
    apiVersion: 3,
    title: 'Paragraph',
    category: 'text',
    attributes: {
      content: { type: 'string' },
      className: { type: 'string' },
    },
    save: ({ attributes }) => element.createElement('p', { className: attributes.className }, element.createElement(element.RawHTML, null, attributes.content || '')),
  });

  safeRegister('core/buttons', {
    apiVersion: 3,
    title: 'Buttons',
    category: 'design',
    save: () => element.createElement('div', blocks.__unstableGetInnerBlocksProps({ className: 'wp-block-buttons' })),
  });

  safeRegister('core/button', {
    apiVersion: 3,
    title: 'Button',
    category: 'design',
    attributes: {
      text: { type: 'string' },
      url: { type: 'string' },
      className: { type: 'string' },
    },
    save: ({ attributes }) =>
      element.createElement(
        'div',
        { className: ['wp-block-button', attributes.className].filter(Boolean).join(' ') },
        element.createElement('a', { className: 'wp-block-button__link wp-element-button', href: attributes.url }, element.createElement(element.RawHTML, null, attributes.text || ''))
      ),
  });

  safeRegister('core/html', {
    apiVersion: 3,
    title: 'Custom HTML',
    category: 'widgets',
    attributes: { html: { type: 'string' } },
    save: ({ attributes }) => element.createElement(element.RawHTML, null, attributes.html || ''),
  });

  safeRegister('poc/kind-marquee', {
    apiVersion: 3,
    title: 'Kind Marquee',
    category: 'design',
    attributes: {
      items: { type: 'array', default: [] },
      speedSeconds: { type: 'number', default: 18 },
      tone: { type: 'string', default: 'clay' },
    },
    save: ({ attributes }) => {
      const items = attributes.items || [];
      const repeated = [...items, ...items];
      return element.createElement(
        'section',
        {
          className: `wp-block-poc-kind-marquee is-tone-${attributes.tone || 'clay'}`,
          style: { '--marquee-speed': `${attributes.speedSeconds || 18}s` },
          'aria-label': 'Studio values',
        },
        element.createElement(
          'div',
          { className: 'marquee-track' },
          repeated.map((item, index) => element.createElement('span', { key: `${item}-${index}` }, item))
        )
      );
    },
  });

  safeRegister('poc/studio-inquiry', {
    apiVersion: 3,
    title: 'Studio Inquiry',
    category: 'forms',
    attributes: {
      eyebrow: { type: 'string' },
      heading: { type: 'string' },
      fields: { type: 'array', default: [] },
      buttonText: { type: 'string' },
    },
    save: ({ attributes }) =>
      element.createElement(
        'section',
        { className: 'wp-block-poc-studio-inquiry', id: 'inquiry' },
        element.createElement(
          'div',
          { className: 'wp-block-columns inquiry-columns' },
          element.createElement(
            'div',
            { className: 'wp-block-column inquiry-copy' },
            element.createElement('p', { className: 'eyebrow' }, attributes.eyebrow),
            element.createElement('h2', null, attributes.heading)
          ),
          element.createElement(
            'div',
            { className: 'wp-block-column inquiry-panel' },
            element.createElement(
              'form',
              { className: 'inquiry-form' },
              (attributes.fields || []).map((field) => renderField(field)),
              element.createElement('button', { type: 'submit' }, attributes.buttonText)
            )
          )
        )
      ),
  });

  for (const name of collectBlockNames(blockTree)) {
    if (blocks.getBlockType(name)) continue;
    safeRegister(name, {
      apiVersion: 3,
      title: name,
      category: 'design',
      attributes: {
        sourceSelector: { type: 'string' },
        html: { type: 'string' },
        editableFields: { type: 'object' },
        className: { type: 'string' },
      },
      save: ({ attributes }) => element.createElement(element.RawHTML, null, attributes.html || ''),
    });
  }
}

function safeRegister(name, settings) {
  if (!blocks.getBlockType(name)) {
    blocks.registerBlockType(name, settings);
  }
}

function collectBlockNames(blockTree) {
  const names = new Set();
  visitSimplifiedBlocks(blockTree, (block) => names.add(block.name));
  return names;
}

function visitSimplifiedBlocks(blockTree, callback) {
  for (const block of blockTree || []) {
    callback(block);
    visitSimplifiedBlocks(block.innerBlocks || [], callback);
  }
}

function simplifiedToBlocks(blockList) {
  return (blockList || []).map((block) => blocks.createBlock(block.name, block.attributes || {}, simplifiedToBlocks(block.innerBlocks || [])));
}

function renderField(field) {
  if (field.type === 'textarea') {
    return element.createElement('label', { key: field.label }, field.label, element.createElement('textarea', { name: slug(field.label), placeholder: field.placeholder }));
  }

  if (field.type === 'select') {
    return element.createElement(
      'label',
      { key: field.label },
      field.label,
      element.createElement(
        'select',
        { name: slug(field.label) },
        (field.options || []).map((option) => element.createElement('option', { key: option }, option))
      )
    );
  }

  return element.createElement(
    'label',
    { key: field.label },
    field.label,
    element.createElement('input', {
      type: field.type,
      name: slug(field.label),
      placeholder: field.placeholder,
    })
  );
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

function stripBlockComments(markup) {
  return markup
    .replace(/<!--\s*\/?wp:[\s\S]*?-->/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'repair';
}

function injectRepairCss(html, repairs) {
  if (!repairs.length) return stripPriorVisionRepairs(html);

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

function buildVisionReport({ passReports, repairProposals, repairProvider, maxRepairPasses, acceptanceThresholds, stopReason }) {
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
      maxRepairPasses,
      acceptance: acceptanceThresholds,
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
    stop: stopReason || { reason: 'unknown', pass: final ? final.pass : null, detail: 'The loop ended without recording a stop reason.' },
    observations: buildObservations(final, acceptanceThresholds),
  };
}

function buildObservations(finalPass, acceptanceThresholds) {
  return finalPass.viewports.map((viewport) => {
    const { mismatchPercent, dimensionDelta } = viewport.comparison;

    if (dimensionDelta.height > acceptanceThresholds.maxHeightDelta) {
      return {
        viewport: viewport.name,
        severity: 'high',
        issue: 'Rendered page height still diverges from the mockup.',
        promptImplication: 'The transform planner should re-check layout primitives, responsive behavior, and spacing before choosing or styling blocks.',
      };
    }

    if (mismatchPercent > acceptanceThresholds.maxMismatchPercent) {
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

  const repairLines = report.repairProposals.flatMap((proposal) =>
    proposal.repairs.map((repair) => {
      const expected = repair.expectedVisualEffect ? ` Expected effect: ${repair.expectedVisualEffect}` : '';
      const risk = repair.editabilityRisk ? ` Editability risk: ${repair.editabilityRisk}` : '';
      const actions = repairActionSummary(repair);
      return `- after pass ${proposal.afterPass}, apply \`${repair.id}\` (${proposal.mode}, ${actions}): ${repair.reason} Real action: ${repair.preferredRealAction}${expected}${risk}`;
    })
  );
  const repairs = repairLines.length ? repairLines.join('\n') : '- No repairs proposed.';

  const observations = report.observations
    .map((observation) => `- \`${observation.viewport}\` (${observation.severity}): ${observation.issue} ${observation.promptImplication}`)
    .join('\n');

  return `# Vision Comparison Report

## Summary

Final pass: ${report.final.pass} of max ${report.comparator.maxRepairPasses}
Repair provider: ${report.strategy.repairProvider}
Acceptance gate: <= ${report.comparator.acceptance.maxMismatchPercent}% max mismatch and <= ${report.comparator.acceptance.maxHeightDelta}px max height delta
Stop reason: ${report.stop.reason} - ${report.stop.detail}

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
- LLM vision regenerates one complete repair artifact per pass when \`POC_VISION_REPAIR_PROVIDER=openai\`.
- Full-page screenshots are captured with Playwright.
- Animations and transitions are disabled before capture to reduce noisy marquee diffs.
- Pixelmatch compares the shared cropped area and reports page-size deltas separately.
- A pass is accepted when the maximum viewport mismatch percentage and maximum viewport height delta are both within the configured gate.
- This POC runs up to ${report.comparator.maxRepairPasses} repair passes.
`;
}

function repairActionSummary(repair) {
  if (repair.artifact) {
    return `${repair.artifact} replacement`;
  }

  const actions = Array.isArray(repair.actions) && repair.actions.length ? repair.actions : legacyRepairActions(repair);
  return actions.map((action) => action.kind).join(', ') || 'no executable action';
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

The current POC asks the LLM to choose and regenerate one complete repair artifact per pass: a full simplified block tree, a complete scoped vision CSS stylesheet, or a full rendered HTML document as a rare escape hatch. The deterministic proxy still supports older local patch actions for cheap debugging.

## Repair Rules

- Choose one repair artifact: \`block-tree\`, \`vision-css\`, or \`rendered-html\`.
- Prefer \`block-tree\` when composition, editable content, wrappers, core/custom block choices, forms, or escaped markup are wrong.
- Use \`vision-css\` only when the block structure is semantically correct and the remaining discrepancy is visual styling.
- Use \`rendered-html\` only as an explicitly justified escape hatch.
- Prefer core block structure, block attributes, and block supports before custom blocks.
- Use custom blocks only for the smallest subtree that needs a custom editor model, behavior, or markup contract.
- Preserve editable rich text, links, form labels/placeholders, repeated items, and inspector controls.
- Do not use raw HTML blocks unless the plan explains why core/custom static blocks cannot preserve both fidelity and editability.
- If escaped markup is visible in the browser, repair the block tree or block attributes rather than styling the text to look less wrong.
- Keep regenerated artifacts scoped to the observed discrepancy.
- Stop after the configured repair pass limit, or earlier when visual drift is acceptable.

## Output

Return a repair proposal with:

- observed discrepancy
- likely cause in block tree, block wrapper DOM, CSS cascade, responsive behavior, or missing custom block
- artifact: \`block-tree\`, \`vision-css\`, or \`rendered-html\`
- content: full replacement artifact
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
