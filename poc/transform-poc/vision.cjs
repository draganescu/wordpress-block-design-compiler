#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');

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
const MAX_REPAIR_PASSES = 3;

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 1200 },
  { name: 'mobile', width: 390, height: 1200 },
];

async function main() {
  const { default: pixelmatch } = await import('pixelmatch');

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

      const proposal = proposeRepairPass({ passReport, appliedRepairs });
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

  const report = buildVisionReport({ passReports, repairProposals });
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

function proposeRepairPass({ passReport, appliedRepairs }) {
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
    trigger: {
      maxMismatchPercent: passReport.aggregate.maxMismatchPercent,
      maxHeightDelta: passReport.aggregate.maxHeightDelta,
    },
    repairs,
  };
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

function buildVisionReport({ passReports, repairProposals }) {
  const final = passReports.at(-1);
  return {
    version: 2,
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
      pocMode: 'This POC uses a deterministic repair proxy so the iteration mechanics can be exercised without an external LLM call.',
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
          proposal.repairs.map(
            (repair) =>
              `- after pass ${proposal.afterPass}, apply \`${repair.id}\`: ${repair.reason} Real action: ${repair.preferredRealAction}`
          )
        )
        .join('\n')
    : '- No repairs proposed.';

  const observations = report.observations
    .map((observation) => `- \`${observation.viewport}\` (${observation.severity}): ${observation.issue} ${observation.promptImplication}`)
    .join('\n');

  return `# Vision Comparison Report

## Summary

Final pass: ${report.final.pass}

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
- LLM vision should be the diagnosis and repair planner.
- Full-page screenshots are captured with Playwright.
- Animations and transitions are disabled before capture to reduce noisy marquee diffs.
- Pixelmatch compares the shared cropped area and reports page-size deltas separately.
- This POC uses a deterministic repair proxy for up to ${MAX_REPAIR_PASSES} repair passes.
`;
}

function renderLlmVisionBrief(report) {
  return `# LLM Vision Repair Brief

Use this brief shape for the real brokered LLM call.

## Inputs

- Source mockup HTML: \`${report.source.mockup}\`
- Initial rendered block HTML: \`${report.source.initialRendered}\`
- Final rendered block HTML from current POC loop: \`${report.source.finalRendered}\`
- Block tree: \`wordpress/block-tree.json\`
- Block implementation plan: \`plan/block-implementation-plan.json\`
- Screenshots and diffs: see \`vision/pass-*/\`

## Role

Interpret the visual differences between the mockup screenshot, rendered block screenshot, and PNG diff. The PNG diff is a measurement signal, not the diagnosis.

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
- exact block-tree or block-source patch
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
