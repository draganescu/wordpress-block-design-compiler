#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const parse5 = require('parse5');
const csstree = require('css-tree');
const { assertOpenAiReady, callOpenAiJson, loadEnvFiles, resolvePrompt, resolveProvider, truncateMiddle } = require('./runtime.cjs');

const requireFromRoot = createRequire(path.join(process.cwd(), 'package.json'));
const blocks = requireFromRoot('@wordpress/blocks');
const element = requireFromRoot('@wordpress/element');

const ROOT = path.resolve('poc/transform-poc');
const OUT = path.join(ROOT, 'output');
const CONTEXT_CHAR_LIMIT = 18000;
const CORE_ASSEMBLY_BLOCKS = [
  'core/group',
  'core/columns',
  'core/column',
  'core/heading',
  'core/paragraph',
  'core/buttons',
  'core/button',
  'core/html',
];
const FIXED_CUSTOM_BLOCKS = [
  'poc/kind-marquee',
  'poc/studio-inquiry',
];
const BASE_ASSEMBLY_BLOCKS = [...CORE_ASSEMBLY_BLOCKS, ...FIXED_CUSTOM_BLOCKS];

loadEnvFiles();

async function main() {
  const providers = resolveLlmProviders();
  assertLlmProvidersReady(providers);
  const prompt = await resolvePrompt();

  resetOutput();
  registerPocBlocks();

  const mockup = providers.html === 'openai' ? await generateOpenAiMockup(prompt) : generateMockup(prompt);
  write('mockup/prompt.md', `${prompt}\n`);
  write('mockup/index.html', mockup.html);
  write('mockup/style.css', mockup.css);

  const analysis = analyzeMockup(mockup.html, mockup.css);
  const contentInventory = extractContentInventory(mockup.html);
  writeJson('analysis/analysis.json', analysis);
  writeJson('analysis/content-inventory.json', contentInventory);

  const plan = providers.plan === 'openai' ? await planBlocksWithOpenAi({ prompt, mockup, analysis }) : planBlocks(analysis);
  writeJson('plan/block-implementation-plan.json', plan);

  registerPlannedCustomBlocks(plan);
  const supportedBlockNames = supportedAssemblyBlockNames(plan);
  const assembly =
    providers.assembly === 'openai'
      ? await assembleBlocksWithOpenAi({ prompt, mockup, analysis, plan, contentInventory, supportedBlockNames })
      : assembleBlocks(plan);
  const contentRepair = repairMissingAssemblyContent(assembly.blockTree, contentInventory, { plan });
  assembly.blockMarkup = blocks.serialize(assembly.blockTree);
  writeJson('wordpress/block-tree.json', simplifyBlocks(assembly.blockTree));
  write('wordpress/content.html', assembly.blockMarkup);
  writeCustomBlockSource(plan);

  const renderedFragment = stripBlockComments(assembly.blockMarkup);
  const renderedHtml = renderFullHtml({
    title: `Rendered Blocks - ${analysis.title || 'POC'}`,
    css: [mockup.css, customBlockCss()].join('\n\n'),
    body: renderedFragment,
  });
  write('rendered/rendered-fragment.html', renderedFragment);
  write('rendered/rendered-blocks.html', renderedHtml);

  const report = buildReport({ prompt, analysis, plan, assembly, providers, contentRepair });
  writeJson('reports/summary.json', report);
  write('reports/summary.md', renderMarkdownReport(report));

  process.stdout.write(
    JSON.stringify(
      {
        output: OUT,
        providers,
        sections: analysis.sections.length,
        plannedCustomBlocks: plan.customBlocks.map((block) => block.name),
        renderedHtml: path.join(OUT, 'rendered/rendered-blocks.html'),
      },
      null,
      2
    )
  );
  process.stdout.write('\n');
}

function resetOutput() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
}

function write(relativePath, content) {
  const filePath = path.join(OUT, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function writeJson(relativePath, data) {
  write(relativePath, `${JSON.stringify(data, null, 2)}\n`);
}

function resolveLlmProviders() {
  return {
    html: resolveProvider({ stage: 'html', fallback: 'deterministic' }),
    plan: resolveProvider({ stage: 'plan', fallback: 'deterministic' }),
    assembly: resolveProvider({ stage: 'assembly', fallback: 'deterministic' }),
  };
}

function assertLlmProvidersReady(providers) {
  for (const [stage, provider] of Object.entries(providers)) {
    if (provider === 'openai') {
      assertOpenAiReady(`OpenAI ${stage} provider`);
    }
  }
}

async function generateOpenAiMockup(prompt) {
  const result = await callOpenAiJson({
    schemaName: 'html_mockup',
    schema: htmlMockupSchema(),
    instructions: [
      'You generate polished standalone HTML/CSS mockups for a WordPress block transform POC.',
      'Create a beautiful, visually specific one-page design from the user brief.',
      'Use semantic sections with data-section attributes, meaningful class names, responsive CSS, and no external assets.',
      'Return complete HTML and CSS separately. The HTML must link to ./style.css and must not include inline style tags.',
      'Include rich layout, typography, responsive behavior, and realistic editable text content.',
    ].join(' '),
    inputText: `Design brief:\n${prompt}`,
  });

  return {
    html: result.html.trim().endsWith('\n') ? result.html : `${result.html.trim()}\n`,
    css: result.css.trim().endsWith('\n') ? result.css : `${result.css.trim()}\n`,
  };
}

function htmlMockupSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'html', 'css'],
    properties: {
      title: { type: 'string' },
      html: { type: 'string' },
      css: { type: 'string' },
    },
  };
}

async function planBlocksWithOpenAi({ prompt, mockup, analysis }) {
  const plan = await callOpenAiJson({
    schemaName: 'block_implementation_plan',
    schema: blockPlanSchema(),
    strict: false,
    instructions: [
      'You plan how to convert an HTML/CSS mockup into editable WordPress blocks.',
      'Prefer core WordPress blocks and block supports before custom blocks.',
      'Use custom static blocks only for the smallest subtree needing custom editor fields, behavior, or a markup contract.',
      'Use core/html only when neither core nor custom static blocks can preserve both fidelity and editability, and explain why.',
      'The plan should optimize for rendered visual fidelity while preserving editable text, links, repeated items, and form labels/placeholders.',
    ].join(' '),
    inputText: [
      `User prompt:\n${prompt}`,
      `Analysis:\n${JSON.stringify(analysis, null, 2)}`,
      `HTML:\n${truncateMiddle(mockup.html, CONTEXT_CHAR_LIMIT)}`,
      `CSS:\n${truncateMiddle(mockup.css, CONTEXT_CHAR_LIMIT)}`,
    ].join('\n\n'),
  });
  return normalizePlan(plan, analysis);
}

function normalizePlan(plan, analysis) {
  const sections = Array.isArray(plan.sections) && plan.sections.length ? plan.sections : planBlocks(analysis).sections;
  const customBlocks = Array.isArray(plan.customBlocks) ? plan.customBlocks : [];
  const customBlocksByName = new Map(
    customBlocks.map((block) => {
      const normalized = normalizeCustomBlockPlan(block);
      return [normalized.name, normalized];
    })
  );
  const customBlocksBySlug = new Map([...customBlocksByName.values()].map((block) => [block.slug, block]));
  const normalizedSections = sections.map((section) => {
    const customBlockName = normalizeSectionCustomBlockName(section.customBlock, customBlocksBySlug);
    if (customBlockName && !customBlocksByName.has(customBlockName)) {
      const blockSlug = blockSlugFromName(customBlockName);
      customBlocksByName.set(customBlockName, {
        name: customBlockName,
        slug: blockSlug,
        reason: `Custom static block planned for ${section.id || blockSlug}.`,
        controls: Array.isArray(section.editableFields) ? section.editableFields.map(String) : [],
      });
    }

    return {
      id: String(section.id || 'section'),
      sourceSelector: String(section.sourceSelector || section.id || 'section'),
      strategy: ['core-assembly', 'custom-block', 'html-block'].includes(section.strategy) ? section.strategy : 'core-assembly',
      coreAttempt: {
        considered: Array.isArray(section.coreAttempt && section.coreAttempt.considered) ? section.coreAttempt.considered.map(String) : ['core/group'],
        verdict: String((section.coreAttempt && section.coreAttempt.verdict) || 'Use editable blocks where possible.'),
      },
      customBlock: customBlockName,
      editableFields: Array.isArray(section.editableFields) ? section.editableFields.map(String) : [],
    };
  });

  return {
    version: Number(plan.version || 1),
    thesis: String(plan.thesis || 'OpenAI-generated block implementation plan.'),
    tokens: plan.tokens && typeof plan.tokens === 'object' && !Array.isArray(plan.tokens) ? plan.tokens : analysis.css.customProperties,
    sections: normalizedSections,
    customBlocks: [...customBlocksByName.values()],
  };
}

function normalizeCustomBlockPlan(block) {
  const blockSlug = slug(String(block.slug || block.name || 'custom-static')) || 'custom-static';
  const rawName = String(block.name || '').trim();
  const name = canonicalBlockName(rawName.includes('/') ? rawName : blockSlug, blockSlug);

  return {
    name,
    slug: blockSlugFromName(name),
    reason: String(block.reason || 'OpenAI planned custom block.'),
    controls: Array.isArray(block.controls) ? block.controls.map(String) : [],
  };
}

function normalizeSectionCustomBlockName(value, customBlocksBySlug) {
  if (!value) return null;

  const candidateSlug = slug(String(value).includes('/') ? String(value).split('/').pop() : String(value));
  if (candidateSlug && customBlocksBySlug.has(candidateSlug)) {
    return customBlocksBySlug.get(candidateSlug).name;
  }

  return canonicalBlockName(value, candidateSlug || 'custom-static');
}

function canonicalBlockName(value, fallbackSlug) {
  const raw = String(value || '').trim();
  if (raw.includes('/')) {
    const [rawNamespace, rawBlockSlug] = raw.split('/');
    return `${slug(rawNamespace) || 'poc'}/${slug(rawBlockSlug) || fallbackSlug || 'custom-static'}`;
  }

  return `poc/${slug(raw) || fallbackSlug || 'custom-static'}`;
}

function blockSlugFromName(name) {
  return slug(String(name).split('/').pop() || 'custom-static') || 'custom-static';
}

function blockPlanSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['version', 'thesis', 'tokens', 'sections', 'customBlocks'],
    properties: {
      version: { type: 'number' },
      thesis: { type: 'string' },
      tokens: {
        type: 'object',
        additionalProperties: { type: 'string' },
      },
      sections: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'sourceSelector', 'strategy', 'coreAttempt', 'customBlock', 'editableFields'],
          properties: {
            id: { type: 'string' },
            sourceSelector: { type: 'string' },
            strategy: { type: 'string', enum: ['core-assembly', 'custom-block', 'html-block'] },
            coreAttempt: {
              type: 'object',
              additionalProperties: false,
              required: ['considered', 'verdict'],
              properties: {
                considered: { type: 'array', items: { type: 'string' } },
                verdict: { type: 'string' },
              },
            },
            customBlock: { type: ['string', 'null'] },
            editableFields: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      customBlocks: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'slug', 'reason', 'controls'],
          properties: {
            name: { type: 'string' },
            slug: { type: 'string' },
            reason: { type: 'string' },
            controls: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  };
}

async function assembleBlocksWithOpenAi({ prompt, mockup, analysis, plan, contentInventory, supportedBlockNames }) {
  const plannedCustomBlocks = plan.customBlocks
    .map((block) => `- ${block.name}: ${block.reason} Controls: ${block.controls.join(', ') || 'source html plus editable field inventory'}`)
    .join('\n');
  const result = await callOpenAiJson({
    schemaName: 'block_tree_assembly',
    schema: blockTreeAssemblySchema(supportedBlockNames),
    strict: false,
    instructions: [
      'You assemble a WordPress static block tree JSON for a POC renderer.',
      `Use only supported block names: ${supportedBlockNames.join(', ')}.`,
      'Extract real text, links, repeated items, and form fields from the HTML mockup.',
      'Every heading and paragraph from the content inventory must appear in a block attribute. Never leave core/heading content, core/paragraph content, core/button text, or core/html html empty when source content exists.',
      'Prefer core blocks for layout/text/buttons/columns. Use planned custom blocks for sections the plan marked custom-block. Use core/html sparingly for visual fragments that cannot fit core blocks or a planned custom block.',
      'When using a planned custom block, attributesJson must include sourceSelector, html with the exact source subtree for this static POC render, and editableFields with extracted text/link/control values.',
      'For every block, attributesJson must be a valid JSON object string containing the attributes for that block. Use "{}" when there are no attributes.',
      'Return a block tree that can render a close visual approximation using the generated CSS and the POC custom block CSS.',
    ].join(' '),
    inputText: [
      `User prompt:\n${prompt}`,
      `Analysis:\n${JSON.stringify(analysis, null, 2)}`,
      `Plan:\n${JSON.stringify(plan, null, 2)}`,
      `Planned custom static blocks:\n${plannedCustomBlocks || '(none)'}`,
      `Content inventory that must be preserved:\n${JSON.stringify(contentInventory, null, 2)}`,
      `HTML:\n${truncateMiddle(mockup.html, CONTEXT_CHAR_LIMIT)}`,
      `CSS selectors and variables:\n${JSON.stringify(analysis.css, null, 2)}`,
    ].join('\n\n'),
  });

  const blockTree = simplifiedToBlocks(result.blockTree || [], new Set(supportedBlockNames));
  return {
    blockTree,
    blockMarkup: blocks.serialize(blockTree),
  };
}

function blockTreeAssemblySchema(supportedBlockNames = BASE_ASSEMBLY_BLOCKS) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['notes', 'blockTree'],
    properties: {
      notes: { type: 'string' },
      blockTree: {
        type: 'array',
        items: blockNodeSchema(0, supportedBlockNames),
      },
    },
  };
}

function blockNodeSchema(depth, supportedBlockNames) {
  const childSchema =
    depth >= 5
      ? {
          type: 'array',
          maxItems: 0,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {},
          },
        }
      : {
          type: 'array',
          items: blockNodeSchema(depth + 1, supportedBlockNames),
        };

  return {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'attributesJson', 'innerBlocks'],
    properties: {
      name: {
        type: 'string',
        enum: supportedBlockNames,
      },
      attributesJson: { type: 'string' },
      innerBlocks: childSchema,
    },
  };
}

function simplifiedToBlocks(blockList, supportedBlocks = new Set(BASE_ASSEMBLY_BLOCKS)) {
  return blockList
    .filter((block) => block && supportedBlocks.has(block.name))
    .map((block) => {
      const attributes = parseBlockAttributes(block);
      return blocks.createBlock(block.name, attributes, simplifiedToBlocks(block.innerBlocks || [], supportedBlocks));
    });
}

function parseBlockAttributes(block) {
  if (block.attributes && typeof block.attributes === 'object') {
    return block.attributes;
  }

  try {
    const parsed = JSON.parse(block.attributesJson || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function generateMockup() {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Kiln & Kind POC</title>
    <link rel="stylesheet" href="./style.css">
  </head>
  <body>
    <main>
      <section class="hero" data-section="hero">
        <div class="hero-copy">
          <p class="eyebrow">Portland ceramic studio</p>
          <h1>Useful vessels with a visible maker's hand.</h1>
          <p class="lede">Hand-thrown tableware, sculptural jars, and weekend workshops from a working neighborhood kiln.</p>
          <a class="button" href="#inquiry">Book a studio visit</a>
        </div>
        <div class="hero-object" aria-label="Large ash-glaze vessel"></div>
      </section>

      <section class="story" data-section="story">
        <p>Every piece is shaped slowly, fired in small batches, and finished with glazes mixed in-house.</p>
        <p>Irregular rims, ash marks, and thumbprints stay visible because the hand belongs in the final object.</p>
      </section>

      <section class="values-marquee" data-section="values-marquee" aria-label="Studio values">
        <div class="marquee-track">
          <span>Local clay</span>
          <span>Small batches</span>
          <span>Food-safe glazes</span>
          <span>Weekend workshops</span>
        </div>
      </section>

      <section class="collection" data-section="collection">
        <div class="section-heading">
          <p class="eyebrow">Current collection</p>
          <h2>Quiet pieces for daily rituals.</h2>
        </div>
        <div class="product-grid">
          <article><span class="swatch oat"></span><h3>Breakfast bowl</h3><p>Speckled clay, oat glaze.</p></article>
          <article><span class="swatch iron"></span><h3>Tall cup</h3><p>Iron wash, clear glaze.</p></article>
          <article><span class="swatch ash"></span><h3>Moon jar</h3><p>Ash glaze, hand burnished.</p></article>
        </div>
      </section>

      <section id="inquiry" class="inquiry" data-section="inquiry">
        <div>
          <p class="eyebrow">Workshops and visits</p>
          <h2>Plan a studio visit or join the next wheel session.</h2>
        </div>
        <form class="inquiry-form">
          <label>Name <input type="text" name="name" placeholder="Your name"></label>
          <label>Email <input type="email" name="email" placeholder="you@example.com"></label>
          <label>Interest <select name="interest"><option>Studio visit</option><option>Workshop seat</option></select></label>
          <button type="submit">Send inquiry</button>
        </form>
      </section>
    </main>
  </body>
</html>
`;

  const css = `:root {
  --ink: #14201d;
  --paper: #f7f0e3;
  --clay: #a14f3e;
  --moss: #416553;
  --ash: #d8d1bd;
  --blue: #2e5c70;
}

* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
a { color: inherit; }
.hero, .story, .collection, .inquiry { padding: clamp(48px, 8vw, 104px) clamp(20px, 6vw, 80px); }
.hero { min-height: 86vh; display: grid; grid-template-columns: 1.1fr 0.8fr; gap: 72px; align-items: end; }
.eyebrow { color: var(--clay); font-size: 12px; font-weight: 800; letter-spacing: 0; text-transform: uppercase; }
h1, h2 { font-family: Georgia, serif; font-weight: 500; line-height: 0.98; margin: 0 0 24px; }
h1 { font-size: clamp(56px, 8vw, 124px); max-width: 900px; }
h2 { font-size: clamp(38px, 5vw, 76px); max-width: 820px; }
.lede { max-width: 620px; font-size: 21px; line-height: 1.55; color: rgba(20, 32, 29, 0.72); }
.button, button { display: inline-flex; min-height: 48px; align-items: center; border: 1px solid var(--ink); background: var(--ink); color: white; padding: 0 22px; text-decoration: none; }
.hero-object { min-height: 540px; background: radial-gradient(circle at 50% 24%, var(--ash) 0 13%, transparent 14%), linear-gradient(150deg, #f1e5cb, #a75f42 58%, #59342d); border-radius: 48% 48% 38% 38%; box-shadow: 0 40px 90px rgba(0,0,0,.24); }
.story { display: grid; grid-template-columns: 1fr 1fr; gap: 56px; background: var(--ink); color: white; font: 34px/1.18 Georgia, serif; }
.values-marquee { overflow: hidden; background: var(--clay); color: white; padding: 18px 0; }
.marquee-track { display: flex; gap: 46px; width: max-content; animation: drift 18s linear infinite; font: 700 18px/1 Inter, sans-serif; text-transform: uppercase; }
.marquee-track span { white-space: nowrap; }
@keyframes drift { from { transform: translateX(0); } to { transform: translateX(-50%); } }
.collection { display: grid; gap: 36px; }
.product-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
.product-grid article { background: white; border: 1px solid rgba(20,32,29,.14); padding: 22px; min-height: 280px; }
.swatch { display: block; height: 132px; margin-bottom: 22px; }
.swatch.oat { background: var(--ash); }
.swatch.iron { background: var(--blue); }
.swatch.ash { background: var(--clay); }
.inquiry { display: grid; grid-template-columns: 1fr 420px; gap: 48px; align-items: start; border-top: 1px solid rgba(20,32,29,.18); }
.inquiry-form { display: grid; gap: 16px; background: white; padding: 24px; border: 1px solid rgba(20,32,29,.14); }
.inquiry-form label { display: grid; gap: 8px; font-weight: 700; }
.inquiry-form input, .inquiry-form select, .inquiry-form textarea { min-height: 44px; border: 1px solid rgba(20,32,29,.24); padding: 0 12px; font: inherit; background: var(--paper); }
@media (max-width: 760px) {
  .hero, .story, .inquiry, .product-grid { grid-template-columns: 1fr; }
  .hero-object { min-height: 360px; }
}
`;

  return { html, css };
}

function analyzeMockup(html, css) {
  const document = parse5.parse(html);
  const sections = findSectionRoots(document).map((section, index) => {
    const className = attr(section, 'class') || '';
    const heading = findElements(section).find((node) => /^h[1-6]$/.test(node.tagName));
    const hasForm = findElements(section, 'form').length > 0;
    const hasMarquee = className.includes('marquee') || findElements(section).some((node) => (attr(node, 'class') || '').includes('marquee-track'));

    return {
      id: attr(section, 'data-section') || attr(section, 'id') || `section-${index + 1}`,
      selector: selector(section),
      tagName: section.tagName,
      classes: className.split(/\s+/).filter(Boolean),
      heading: heading ? clean(text(heading)) : null,
      textLength: clean(text(section)).length,
      features: {
        hasForm,
        hasMarquee,
        linkCount: findElements(section, 'a').length,
        inputCount: findElements(section, 'input').length + findElements(section, 'select').length,
        cardCount: findElements(section, 'article').length,
      },
    };
  });

  const cssAst = csstree.parse(css, { parseValue: true, parseCustomProperty: false });
  const customProperties = {};
  const selectors = [];
  csstree.walk(cssAst, (node) => {
    if (node.type === 'Declaration' && node.property.startsWith('--')) {
      customProperties[node.property] = csstree.generate(node.value).trim();
    }
    if (node.type === 'Rule') {
      selectors.push(csstree.generate(node.prelude).trim());
    }
  });

  return {
    title: clean(text(findElements(document, 'title')[0])),
    sections,
    css: {
      customProperties,
      selectors: [...new Set(selectors)],
    },
  };
}

function extractContentInventory(html) {
  const document = parse5.parse(html);
  return {
    sections: findSectionRoots(document).map((node, index) => ({
      id: attr(node, 'data-section') || attr(node, 'id') || `section-${index + 1}`,
      selector: selector(node),
      tagName: node.tagName,
      className: attr(node, 'class') || '',
      text: clean(text(node)),
      html: outerHtml(node),
      editableFields: editableFieldsForNode(node),
    })),
    headings: findElements(document)
      .filter((node) => /^h[1-6]$/.test(node.tagName))
      .map((node) => ({
        level: Number(node.tagName.slice(1)),
        className: attr(node, 'class') || '',
        content: clean(text(node)),
      }))
      .filter((item) => item.content),
    paragraphs: findElements(document, 'p')
      .map((node) => ({
        className: attr(node, 'class') || '',
        content: clean(text(node)),
      }))
      .filter((item) => item.content),
    links: findElements(document, 'a')
      .map((node) => ({
        className: attr(node, 'class') || '',
        text: clean(text(node)),
        url: attr(node, 'href') || '',
      }))
      .filter((item) => item.text || item.url),
    htmlFragments: findHtmlFragments(document),
  };
}

function findSectionRoots(document) {
  return findElements(document).filter((node) => {
    if (attr(node, 'data-section')) return true;
    return ['section', 'header', 'footer'].includes(node.tagName);
  });
}

function editableFieldsForNode(node) {
  return {
    headings: findElements(node)
      .filter((child) => /^h[1-6]$/.test(child.tagName))
      .map((child) => ({
        level: Number(child.tagName.slice(1)),
        className: attr(child, 'class') || '',
        content: clean(text(child)),
      }))
      .filter((item) => item.content),
    paragraphs: findElements(node, 'p')
      .map((child) => ({
        className: attr(child, 'class') || '',
        content: clean(text(child)),
      }))
      .filter((item) => item.content),
    links: findElements(node, 'a')
      .map((child) => ({
        className: attr(child, 'class') || '',
        text: clean(text(child)),
        url: attr(child, 'href') || '',
      }))
      .filter((item) => item.text || item.url),
  };
}

function findHtmlFragments(root) {
  const fragments = [];

  function visit(node, insideCandidate) {
    if (!node || !node.tagName) {
      for (const child of node.childNodes || []) visit(child, insideCandidate);
      return;
    }

    const candidate = isHtmlFragmentCandidate(node);
    if (candidate && !insideCandidate) {
      fragments.push({
        selector: selector(node),
        className: attr(node, 'class') || '',
        html: outerHtml(node),
      });
    }

    for (const child of node.childNodes || []) {
      visit(child, insideCandidate || candidate);
    }
  }

  visit(root, false);
  return fragments;
}

function isHtmlFragmentCandidate(node) {
  const tagName = node.tagName;
  const className = attr(node, 'class') || '';
  if (!className && !['nav', 'blockquote'].includes(tagName)) return false;
  if (!['div', 'nav', 'blockquote', 'span'].includes(tagName)) return false;
  if (findElements(node).some((child) => /^h[1-6]$/.test(child.tagName) || child.tagName === 'p' || child.tagName === 'form')) return false;

  return /bg|light|photo|circle|quote|icon|nav|object|shape|blob|decor|visual/i.test(`${className} ${tagName}`);
}

function outerHtml(node) {
  const attrs = (node.attrs || [])
    .map((nodeAttr) => ` ${nodeAttr.name}="${escapeHtml(nodeAttr.value)}"`)
    .join('');
  return `<${node.tagName}${attrs}>${parse5.serialize(node)}</${node.tagName}>`;
}

function repairMissingAssemblyContent(blockTree, inventory, { plan = null } = {}) {
  const customBlockSources = new Map();
  for (const section of (plan && plan.sections) || []) {
    if (section.customBlock) {
      customBlockSources.set(section.customBlock, section.sourceSelector || section.id);
    }
  }

  const state = {
    sections: new Set(),
    headings: new Set(),
    paragraphs: new Set(),
    links: new Set(),
    htmlFragments: new Set(),
    repairs: [],
  };

  visitBlocks(blockTree, (block) => {
    const attributes = block.attributes || {};

    if (customBlockSources.has(block.name) && !hasText(attributes.html)) {
      const expectedSource = attributes.sourceSelector || customBlockSources.get(block.name);
      const item = takeInventoryItem(inventory.sections, state.sections, (candidate) => matchesSection(candidate, expectedSource));
      if (item) {
        attributes.sourceSelector = attributes.sourceSelector || item.selector;
        attributes.html = item.html;
        attributes.editableFields = attributes.editableFields || item.editableFields;
        state.repairs.push({ block: block.name, field: 'html', selector: item.selector });
      }
    }

    if (block.name === 'core/heading' && !hasText(attributes.content)) {
      const item = takeInventoryItem(inventory.headings, state.headings, (candidate) => {
        const sameClass = attributes.className && candidate.className === attributes.className;
        const sameLevel = attributes.level && Number(attributes.level) === Number(candidate.level);
        return sameClass || sameLevel;
      });
      if (item) {
        attributes.content = item.content;
        if (!attributes.level) attributes.level = item.level;
        if (!attributes.className && item.className) attributes.className = item.className;
        state.repairs.push({ block: block.name, field: 'content', value: item.content });
      }
    }

    if (block.name === 'core/paragraph' && !hasText(attributes.content)) {
      const item = takeInventoryItem(inventory.paragraphs, state.paragraphs, (candidate) => attributes.className && candidate.className === attributes.className);
      if (item) {
        attributes.content = item.content;
        if (!attributes.className && item.className) attributes.className = item.className;
        state.repairs.push({ block: block.name, field: 'content', value: item.content });
      }
    }

    if (block.name === 'core/button' && !hasText(attributes.text)) {
      const item = takeInventoryItem(inventory.links, state.links, (candidate) => attributes.url && candidate.url === attributes.url);
      if (item) {
        attributes.text = item.text;
        if (!attributes.url) attributes.url = item.url;
        state.repairs.push({ block: block.name, field: 'text', value: item.text });
      }
    }

    if (block.name === 'core/html' && !hasText(attributes.html)) {
      const item = takeInventoryItem(inventory.htmlFragments, state.htmlFragments);
      if (item) {
        attributes.html = item.html;
        state.repairs.push({ block: block.name, field: 'html', selector: item.selector });
      }
    }

    block.attributes = attributes;
  });

  return {
    repairedBlocks: state.repairs.length,
    repairs: state.repairs,
  };
}

function matchesSection(candidate, expectedSource) {
  if (!expectedSource) return false;

  const source = String(expectedSource);
  return (
    candidate.selector === source ||
    candidate.id === source ||
    source.includes(candidate.id) ||
    (candidate.className && source.includes(candidate.className)) ||
    (source.includes('#') && candidate.selector.includes(source)) ||
    (source.includes('.') && source.split('.').some((part) => part && candidate.className.split(/\s+/).includes(part)))
  );
}

function visitBlocks(blockTree, callback) {
  for (const block of blockTree || []) {
    callback(block);
    visitBlocks(block.innerBlocks || [], callback);
  }
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function takeInventoryItem(items, used, preferred = null) {
  const preferredIndex = preferred ? items.findIndex((item, index) => !used.has(index) && preferred(item)) : -1;
  if (preferredIndex >= 0) {
    used.add(preferredIndex);
    return items[preferredIndex];
  }

  const nextIndex = items.findIndex((_, index) => !used.has(index));
  if (nextIndex >= 0) {
    used.add(nextIndex);
    return items[nextIndex];
  }

  return null;
}

function planBlocks(analysis) {
  const sections = analysis.sections.map((section) => {
    if (section.features.hasMarquee) {
      return {
        id: section.id,
        sourceSelector: section.selector,
        strategy: 'custom-block',
        coreAttempt: {
          considered: ['core/group', 'core/paragraph'],
          verdict: 'A static core group could show the words, but editable repeated marquee items, speed, and duplicated track markup need a purpose-built block.',
        },
        customBlock: 'poc/kind-marquee',
        editableFields: ['items', 'speedSeconds', 'tone'],
      };
    }

    if (section.features.hasForm) {
      return {
        id: section.id,
        sourceSelector: section.selector,
        strategy: 'custom-block',
        coreAttempt: {
          considered: ['core/group', 'core/heading', 'core/paragraph', 'core/buttons'],
          verdict: 'Core blocks can fake the CTA, but the mockup contains structured inputs and submission UI that need explicit fields and controls.',
        },
        customBlock: 'poc/studio-inquiry',
        editableFields: ['eyebrow', 'heading', 'fields', 'buttonText'],
      };
    }

    return {
      id: section.id,
      sourceSelector: section.selector,
      strategy: 'core-assembly',
      coreAttempt: {
        considered: ['core/group', 'core/columns', 'core/heading', 'core/paragraph', 'core/buttons'],
        verdict: 'Core blocks plus custom classes preserve the content model and are sufficient for this section.',
      },
      editableFields: ['heading', 'paragraphs', 'links'],
    };
  });

  return {
    version: 1,
    thesis: 'Core-first plan with custom blocks only for repeated marquee behavior and structured form editing.',
    tokens: analysis.css.customProperties,
    sections,
    customBlocks: [
      {
        name: 'poc/kind-marquee',
        slug: 'kind-marquee',
        reason: 'Editable repeated marquee items and speed/tone controls are cleaner as a custom static block than a brittle core group.',
        controls: ['RichText-like repeated item text fields', 'Inspector speedSeconds', 'Inspector tone'],
      },
      {
        name: 'poc/studio-inquiry',
        slug: 'studio-inquiry',
    reason: 'Structured form fields, labels, placeholders, and submit button need a coherent editor UI.',
        controls: ['RichText heading fields', 'field list controls', 'button text control', 'core columns layout wrapper'],
      },
    ],
  };
}

function assembleBlocks(plan) {
  const blockTree = [
    createCoreGroup('hero alignwide', [
      blocks.createBlock('core/paragraph', { content: 'Portland ceramic studio', className: 'eyebrow' }),
      blocks.createBlock('core/heading', {
        level: 1,
        content: "Useful vessels with a visible maker's hand.",
      }),
      blocks.createBlock('core/paragraph', {
        content: 'Hand-thrown tableware, sculptural jars, and weekend workshops from a working neighborhood kiln.',
        className: 'lede',
      }),
      blocks.createBlock('core/buttons', {}, [
        blocks.createBlock('core/button', {
          text: 'Book a studio visit',
          url: '#inquiry',
        }),
      ]),
      blocks.createBlock('core/group', { className: 'hero-object', tagName: 'div' }),
    ]),
    createCoreGroup('story', [
      blocks.createBlock('core/paragraph', {
        content: 'Every piece is shaped slowly, fired in small batches, and finished with glazes mixed in-house.',
      }),
      blocks.createBlock('core/paragraph', {
        content: 'Irregular rims, ash marks, and thumbprints stay visible because the hand belongs in the final object.',
      }),
    ]),
    blocks.createBlock('poc/kind-marquee', {
      items: ['Local clay', 'Small batches', 'Food-safe glazes', 'Weekend workshops'],
      speedSeconds: 18,
      tone: 'clay',
    }),
    createCoreGroup('collection', [
      blocks.createBlock('core/paragraph', { content: 'Current collection', className: 'eyebrow' }),
      blocks.createBlock('core/heading', { level: 2, content: 'Quiet pieces for daily rituals.' }),
      blocks.createBlock('core/columns', { className: 'product-grid' }, [
        productColumn('oat', 'Breakfast bowl', 'Speckled clay, oat glaze.'),
        productColumn('iron', 'Tall cup', 'Iron wash, clear glaze.'),
        productColumn('ash', 'Moon jar', 'Ash glaze, hand burnished.'),
      ]),
    ]),
    blocks.createBlock('poc/studio-inquiry', {
      eyebrow: 'Workshops and visits',
      heading: 'Plan a studio visit or join the next wheel session.',
      fields: [
        { label: 'Name', type: 'text', placeholder: 'Your name' },
        { label: 'Email', type: 'email', placeholder: 'you@example.com' },
        { label: 'Interest', type: 'select', options: ['Studio visit', 'Workshop seat'] },
      ],
      buttonText: 'Send inquiry',
    }),
  ];

  return {
    blockTree,
    blockMarkup: blocks.serialize(blockTree),
  };
}

function createCoreGroup(className, innerBlocks) {
  return blocks.createBlock('core/group', { className, tagName: 'section' }, innerBlocks);
}

function productColumn(swatch, title, description) {
  return blocks.createBlock('core/column', { className: 'product-card' }, [
    blocks.createBlock('core/group', { className: `swatch ${swatch}`, tagName: 'span' }),
    blocks.createBlock('core/heading', { level: 3, content: title }),
    blocks.createBlock('core/paragraph', { content: description }),
  ]);
}

function registerPocBlocks() {
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
      element.createElement(`h${attributes.level || 2}`, { className: attributes.className }, attributes.content),
  });

  safeRegister('core/paragraph', {
    apiVersion: 3,
    title: 'Paragraph',
    category: 'text',
    attributes: {
      content: { type: 'string' },
      className: { type: 'string' },
    },
    save: ({ attributes }) => element.createElement('p', { className: attributes.className }, attributes.content),
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
    },
    save: ({ attributes }) =>
      element.createElement('div', { className: 'wp-block-button' }, element.createElement('a', { className: 'wp-block-button__link wp-element-button', href: attributes.url }, attributes.text)),
  });

  safeRegister('core/html', {
    apiVersion: 3,
    title: 'Custom HTML',
    category: 'widgets',
    attributes: {
      html: { type: 'string' },
    },
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
}

function registerPlannedCustomBlocks(plan) {
  for (const customBlock of plan.customBlocks) {
    if (FIXED_CUSTOM_BLOCKS.includes(customBlock.name)) continue;
    safeRegister(customBlock.name, {
      apiVersion: 3,
      title: titleCase(customBlock.slug),
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

function supportedAssemblyBlockNames(plan) {
  return [...new Set([...BASE_ASSEMBLY_BLOCKS, ...plan.customBlocks.map((block) => block.name)])];
}

function renderField(field) {
  if (field.type === 'textarea') {
    return element.createElement(
      'label',
      { key: field.label },
      field.label,
      element.createElement('textarea', {
        name: slug(field.label),
        placeholder: field.placeholder,
      })
    );
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

function safeRegister(name, settings) {
  if (!blocks.getBlockType(name)) {
    blocks.registerBlockType(name, settings);
  }
}

function writeCustomBlockSource(plan) {
  for (const customBlock of plan.customBlocks) {
    const base = `wordpress/blocks/${customBlock.slug}`;
    const attributes = customBlockAttributes(customBlock.name);
    writeJson(`${base}/block.json`, {
      apiVersion: 3,
      name: customBlock.name,
      title: titleCase(customBlock.slug),
      category: customBlock.name.includes('inquiry') ? 'forms' : 'design',
      attributes,
    });
    write(
      `${base}/edit.js`,
      `// POC edit component sketch.\n// Planned controls: ${customBlock.controls.join(', ') || 'source html plus editable field inventory'}\n`
    );
    write(`${base}/save.js`, `// POC save implementation lives in run.cjs for executable comparison.\n`);
    write(`${base}/style.css`, FIXED_CUSTOM_BLOCKS.includes(customBlock.name) ? customBlockCss() : '/* Generated static block CSS is currently supplied by the page mockup stylesheet. */\n');
  }
}

function customBlockAttributes(name) {
  if (name === 'poc/kind-marquee') {
    return {
      items: { type: 'array', default: [] },
      speedSeconds: { type: 'number', default: 18 },
      tone: { type: 'string', default: 'clay' },
    };
  }

  if (name === 'poc/studio-inquiry') {
    return {
      eyebrow: { type: 'string' },
      heading: { type: 'string' },
      fields: { type: 'array', default: [] },
      buttonText: { type: 'string' },
    };
  }

  return {
    sourceSelector: { type: 'string' },
    html: { type: 'string' },
    editableFields: { type: 'object' },
    className: { type: 'string' },
  };
}

function renderFullHtml({ title, css, body }) {
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
    <main>
${indent(body, 6)}
    </main>
  </body>
</html>
`;
}

function customBlockCss() {
  return `.wp-block-button__link { display: inline-flex; min-height: 48px; align-items: center; border: 1px solid var(--ink); background: var(--ink); color: white; padding: 0 22px; text-decoration: none; }
.wp-block-columns { display: grid; grid-template-columns: repeat(var(--wp--columns-count, 2), minmax(0, 1fr)); gap: 48px; }
@media (max-width: 760px) {
  .wp-block-columns { grid-template-columns: 1fr; }
}
.product-card { background: white; border: 1px solid rgba(20,32,29,.14); padding: 22px; min-height: 280px; }
.wp-block-poc-kind-marquee { overflow: hidden; background: var(--clay); color: white; padding: 18px 0; }
.wp-block-poc-kind-marquee .marquee-track { display: flex; gap: 46px; width: max-content; animation: drift var(--marquee-speed, 18s) linear infinite; font: 700 18px/1 Inter, sans-serif; text-transform: uppercase; }
.wp-block-poc-kind-marquee span { white-space: nowrap; }
.wp-block-poc-studio-inquiry { padding: clamp(48px, 8vw, 104px) clamp(20px, 6vw, 80px); border-top: 1px solid rgba(20,32,29,.18); }
.wp-block-poc-studio-inquiry textarea { padding-top: 10px; }
.wp-block-poc-studio-inquiry .inquiry-columns { --wp--columns-count: 2; align-items: start; margin: 0; }`;
}

function buildReport({ prompt, analysis, plan, assembly, providers, contentRepair }) {
  return {
    prompt,
    providers,
    contentRepair,
    sectionsAnalyzed: analysis.sections.length,
    sectionStrategies: plan.sections.map((section) => ({
      id: section.id,
      strategy: section.strategy,
      coreAttempt: section.coreAttempt.verdict,
      customBlock: section.customBlock || null,
    })),
    customBlocks: plan.customBlocks.map((block) => block.name),
    blockCount: countBlocks(assembly.blockTree),
    outputs: {
      mockup: 'mockup/index.html',
      plan: 'plan/block-implementation-plan.json',
      blockMarkup: 'wordpress/content.html',
      renderedHtml: 'rendered/rendered-blocks.html',
      visionReport: 'vision/visual-report.md',
    },
  };
}

function renderMarkdownReport(report) {
  return `# Transform POC Report

## Summary

- Sections analyzed: ${report.sectionsAnalyzed}
- Blocks in assembled tree: ${report.blockCount}
- Custom blocks: ${report.customBlocks.join(', ')}
- LLM providers: html=${report.providers.html}, plan=${report.providers.plan}, assembly=${report.providers.assembly}
- Content repairs applied: ${report.contentRepair.repairedBlocks}

## Section Strategies

${report.sectionStrategies
  .map((section) => `- \`${section.id}\`: ${section.strategy}${section.customBlock ? ` (${section.customBlock})` : ''}\n  - Core attempt: ${section.coreAttempt}`)
  .join('\n')}

## Outputs

- Mockup: \`${report.outputs.mockup}\`
- Plan: \`${report.outputs.plan}\`
- Block markup: \`${report.outputs.blockMarkup}\`
- Rendered HTML: \`${report.outputs.renderedHtml}\`
- Vision report: \`${report.outputs.visionReport}\`
`;
}

function simplifyBlocks(blockList) {
  return blockList.map((block) => ({
    name: block.name,
    attributes: block.attributes,
    innerBlocks: simplifyBlocks(block.innerBlocks || []),
  }));
}

function countBlocks(blockList) {
  return blockList.reduce((sum, block) => sum + 1 + countBlocks(block.innerBlocks || []), 0);
}

function stripBlockComments(markup) {
  return markup
    .replace(/<!--\s*\/?wp:[\s\S]*?-->/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function findElements(root, tagName) {
  const out = [];
  walk(root, (node) => {
    if (node && node.tagName && (!tagName || node.tagName === tagName)) {
      out.push(node);
    }
  });
  return out;
}

function walk(node, callback) {
  callback(node);
  for (const child of node.childNodes || []) {
    walk(child, callback);
  }
}

function attr(node, name) {
  const found = (node.attrs || []).find((candidate) => candidate.name === name);
  return found ? found.value : null;
}

function text(node) {
  if (!node) return '';
  if (typeof node.value === 'string') return node.value;
  return (node.childNodes || []).map(text).join(' ');
}

function selector(node) {
  const id = attr(node, 'id');
  if (id) return `${node.tagName}#${id}`;
  const classes = (attr(node, 'class') || '').split(/\s+/).filter(Boolean);
  return classes.length ? `${node.tagName}.${classes.join('.')}` : node.tagName;
}

function clean(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function titleCase(value) {
  return value
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function indent(value, spaces) {
  const pad = ' '.repeat(spaces);
  return value
    .split('\n')
    .map((line) => (line.length ? `${pad}${line}` : ''))
    .join('\n');
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
