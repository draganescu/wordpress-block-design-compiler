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
const DESIGN_SYSTEM_PROMPT = path.join(ROOT, 'system.design.md');
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
const OPAQUE_CUSTOM_BLOCK_ATTRIBUTES = new Set(['html', 'sourceHtml', 'sourceHTML', 'markup', 'innerHTML', 'editableFields', 'sourceSelector']);
const GENERATED_CUSTOM_BLOCK_ATTRIBUTE_TYPES = new Set(['string', 'number', 'boolean', 'array', 'object']);

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

  const plan = providers.plan === 'openai' ? await planBlocksWithOpenAi({ prompt, mockup, analysis, contentInventory }) : planBlocks(analysis);
  writeJson('plan/block-implementation-plan.json', plan);

  registerPlannedCustomBlocks(plan);
  const supportedBlockNames = supportedAssemblyBlockNames(plan);
  const assembly =
    providers.assembly === 'openai'
      ? await assembleBlocksWithOpenAi({ prompt, mockup, analysis, plan, contentInventory, supportedBlockNames })
      : assembleBlocks(plan);
  const customContractRepair = enforceCustomBlockContracts(assembly.blockTree, plan, contentInventory);
  const contentRepair = repairMissingAssemblyContent(assembly.blockTree, contentInventory, { plan });
  assembly.blockMarkup = blocks.serialize(assembly.blockTree);
  writeJson('wordpress/block-tree.json', simplifyBlocks(assembly.blockTree));
  write('wordpress/content.html', assembly.blockMarkup);
  writeCustomBlockSource(plan);

  const renderedFragment = stripBlockComments(assembly.blockMarkup);
  const renderedHtml = renderFullHtml({
    title: `Rendered Blocks - ${analysis.title || 'POC'}`,
    css: [mockup.css, customBlockCss(plan)].join('\n\n'),
    body: renderedFragment,
  });
  write('rendered/rendered-fragment.html', renderedFragment);
  write('rendered/rendered-blocks.html', renderedHtml);

  const report = buildReport({ prompt, analysis, plan, assembly, providers, contentRepair, customContractRepair });
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
  const designSystemPrompt = fs.readFileSync(DESIGN_SYSTEM_PROMPT, 'utf8').trim();
  const result = await callOpenAiJson({
    schemaName: 'html_mockup',
    schema: htmlMockupSchema(),
    instructions: designSystemPrompt,
    inputText: `User request:\n${prompt}`,
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

async function planBlocksWithOpenAi({ prompt, mockup, analysis, contentInventory }) {
  const plan = await callOpenAiJson({
    schemaName: 'block_implementation_plan',
    schema: blockPlanSchema(),
    strict: false,
    instructions: [
      'You plan how to convert an HTML/CSS mockup into editable WordPress blocks.',
      'Prefer core WordPress blocks and block supports before custom blocks.',
      'Use custom static blocks only for the smallest subtree needing custom editor fields, behavior, or a semantic markup contract.',
      'Do not make a whole hero, collection, or contact section custom only because it has decorative SVG, gradients, backgrounds, overlays, or exact CSS layout. Keep editable text/layout in core blocks and isolate the decorative fragment if needed.',
      'A planned custom block must define typed editable attributes, block supports, inline RichText-editable visible copy, inspector controls for non-inline settings, and a semantic save template. It must not be a wrapper around an html, sourceHtml, markup, innerHTML, or editableFields blob.',
      'If the mockup element is a form, search box, booking widget, email subscription, contact form, or inquiry form, the custom block save template must render a real semantic <form> with labels, fields, placeholders, button, action, and method. Never render form metadata as paragraphs.',
      'Do not plan TextControl/TextareaControl as the primary editing surface for visible text. Visible block content should be editable in canvas with RichText; action URLs, method, required flags, style variants, speed, and other settings belong in InspectorControls or BlockControls.',
      'If the only viable implementation is opaque raw HTML, do not call it a custom block. Use core/html for the smallest decorative fragment only and explain why.',
      'The plan should optimize for rendered visual fidelity while preserving editable text, links, repeated items, and form labels/placeholders.',
    ].join(' '),
    inputText: [
      `User prompt:\n${prompt}`,
      `Analysis:\n${JSON.stringify(analysis, null, 2)}`,
      `Content inventory:\n${JSON.stringify(contentInventory, null, 2)}`,
      `HTML:\n${truncateMiddle(mockup.html, CONTEXT_CHAR_LIMIT)}`,
      `CSS:\n${truncateMiddle(mockup.css, CONTEXT_CHAR_LIMIT)}`,
    ].join('\n\n'),
  });
  return normalizePlan(plan, analysis);
}

function normalizePlan(plan, analysis) {
  const sections = Array.isArray(plan.sections) && plan.sections.length ? plan.sections : planBlocks(analysis).sections;
  const customBlocks = Array.isArray(plan.customBlocks) ? plan.customBlocks : [];
  const customBlocksByName = normalizeCustomBlockPlanList(customBlocks);
  const customBlocksBySlug = customBlockSlugIndex(customBlocksByName.values());
  const normalizedSections = sections.map((section) => {
    const customBlockName = normalizeSectionCustomBlockName(section.customBlock, customBlocksBySlug);
    if (customBlockName && !customBlocksByName.has(customBlockName)) {
      const blockSlug = blockSlugFromName(customBlockName);
      customBlocksByName.set(customBlockName, {
        name: customBlockName,
        slug: blockSlug,
        reason: `Custom static block planned for ${section.id || blockSlug}.`,
        controls: Array.isArray(section.editableFields) ? section.editableFields.map(String) : [],
        attributes: inferCustomBlockAttributes({ name: customBlockName, slug: blockSlug, reason: '', controls: section.editableFields || [] }),
        template: normalizeCustomBlockTemplate(null, { slug: blockSlug, sourceClassName: sourceClassNameFromSelector(section.sourceSelector) }),
      });
      for (const key of customBlockSlugKeys(blockSlug)) customBlocksBySlug.set(key, customBlocksByName.get(customBlockName));
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
  attachCustomBlockSectionMetadata(customBlocksByName, normalizedSections);

  return {
    version: Number(plan.version || 1),
    thesis: String(plan.thesis || 'OpenAI-generated block implementation plan.'),
    tokens: plan.tokens && typeof plan.tokens === 'object' && !Array.isArray(plan.tokens) ? plan.tokens : analysis.css.customProperties,
    sections: normalizedSections,
    customBlocks: [...customBlocksByName.values()],
  };
}

function normalizeCustomBlockPlanList(customBlocks) {
  const byName = new Map();
  const byCompactSlug = new Map();

  for (const block of customBlocks) {
    const normalized = normalizeCustomBlockPlan(block);
    const compactKey = compactSlugKey(normalized.slug);
    const existing = byCompactSlug.get(compactKey);
    if (existing) {
      mergeCustomBlockPlan(existing, normalized);
      continue;
    }

    byName.set(normalized.name, normalized);
    byCompactSlug.set(compactKey, normalized);
  }

  return byName;
}

function mergeCustomBlockPlan(target, incoming) {
  target.controls = [...new Set([...target.controls, ...incoming.controls])];
  const attributesByName = new Map(target.attributes.map((attribute) => [attribute.name, attribute]));
  for (const attribute of incoming.attributes) {
    if (!attributesByName.has(attribute.name)) {
      target.attributes.push(attribute);
      attributesByName.set(attribute.name, attribute);
    }
  }
  if (!target.reason.includes(incoming.reason)) target.reason = `${target.reason} ${incoming.reason}`.trim();
  if (!target.template.structure.includes(incoming.template.structure)) {
    target.template.structure = `${target.template.structure} ${incoming.template.structure}`.trim();
  }
}

function normalizeCustomBlockPlan(block) {
  const blockSlug = slug(String(block.slug || block.name || 'custom-static')) || 'custom-static';
  const rawName = String(block.name || '').trim();
  const name = canonicalBlockName(rawName.includes('/') ? rawName : blockSlug, blockSlug);
  const reason = String(block.reason || 'OpenAI planned custom block.');
  const controls = Array.isArray(block.controls) ? block.controls.map(String) : [];
  const normalized = {
    name,
    slug: blockSlugFromName(name),
    reason,
    controls,
    attributes: normalizeCustomBlockAttributes(block.attributes, { name, slug: blockSlugFromName(name), reason, controls }),
    template: normalizeCustomBlockTemplate(block.template, { slug: blockSlugFromName(name) }),
  };
  return enhanceCustomBlockPlan(normalized);
}

function enhanceCustomBlockPlan(customBlock) {
  if (!customBlockLooksFormLike(customBlock)) {
    return customBlock;
  }

  customBlock.attributes = customBlock.attributes.map((attribute) => ({
    ...attribute,
    role: normalizeFormAttributeRole(attribute),
  }));

  if (!customBlock.attributes.some((attribute) => /form-fields|fields/.test(`${attribute.role} ${attribute.name}`.toLowerCase()))) {
    customBlock.attributes.push({
      name: 'fields',
      type: 'array',
      role: 'form-fields',
      source: 'form labels, types, names, placeholders, required state, and select options',
    });
  }

  customBlock.controls = [
    ...new Set([
      ...customBlock.controls,
      'RichText labels and button text in canvas',
      'InspectorControls for action, method, required state, placeholder, and behavior settings',
      'Block supports for spacing, color, border, typography, alignment, and className',
    ]),
  ];
  customBlock.template.structure = `${customBlock.template.structure} Render a real semantic form in save output; never expose action, method, inputName, placeholder, required, or other form metadata as visible paragraphs.`.trim();
  return customBlock;
}

function customBlockLooksFormLike(customBlock) {
  const text = [
    customBlock.name,
    customBlock.slug,
    customBlock.reason,
    customBlock.template && customBlock.template.structure,
    ...(customBlock.attributes || []).map((attribute) => `${attribute.name} ${attribute.role} ${attribute.source}`),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return /\b(form|forms|subscribe|subscription|signup|newsletter|search|booking|inquiry|contact|email|dispatch)\b/.test(text);
}

function normalizeFormAttributeRole(attribute) {
  const text = `${attribute.role || ''} ${attribute.name || ''} ${attribute.source || ''}`.toLowerCase();
  if (/action/.test(text)) return 'form-action';
  if (/method/.test(text)) return 'form-method';
  if (/input.*name|field.*name/.test(text)) return 'form-input-name';
  if (/placeholder/.test(text)) return 'form-placeholder';
  if (/required/.test(text)) return 'form-required';
  if (/button|submit|cta/.test(text)) return 'button-text';
  if (/note|privacy|disclaimer|help/.test(text)) return 'form-note';
  if (/fields?|form-fields|options/.test(text)) return 'form-fields';
  if (/label/.test(text)) return 'form-label';
  return attribute.role || roleFromAttributeName(attribute.name);
}

function normalizeSectionCustomBlockName(value, customBlocksBySlug) {
  if (!value) return null;

  const candidateSlug = slug(String(value).includes('/') ? String(value).split('/').pop() : String(value));
  for (const key of customBlockSlugKeys(candidateSlug)) {
    if (key && customBlocksBySlug.has(key)) {
      return customBlocksBySlug.get(key).name;
    }
  }

  return canonicalBlockName(value, candidateSlug || 'custom-static');
}

function customBlockSlugIndex(customBlocks) {
  const index = new Map();
  for (const block of customBlocks) {
    for (const key of customBlockSlugKeys(block.slug)) {
      if (key && !index.has(key)) index.set(key, block);
    }
  }
  return index;
}

function customBlockSlugKeys(value) {
  const slugValue = slug(value || '');
  const compact = compactSlugKey(slugValue);
  return [...new Set([slugValue, compact].filter(Boolean))];
}

function compactSlugKey(value) {
  return slug(value || '').replace(/-/g, '');
}

function attachCustomBlockSectionMetadata(customBlocksByName, sections) {
  for (const section of sections) {
    if (!section.customBlock || !customBlocksByName.has(section.customBlock)) continue;
    const customBlock = customBlocksByName.get(section.customBlock);
    if (!customBlock.sourceSelector) customBlock.sourceSelector = section.sourceSelector;
    if (!customBlock.sourceClassName) customBlock.sourceClassName = sourceClassNameFromSelector(section.sourceSelector);
    if (!customBlock.template.rootClass && customBlock.sourceClassName) {
      customBlock.template.rootClass = customBlock.sourceClassName;
    }
  }
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

function normalizeCustomBlockAttributes(attributes, context) {
  const normalized = [];
  const seen = new Set();

  for (const attribute of Array.isArray(attributes) ? attributes : []) {
    const item = normalizeCustomBlockAttribute(attribute);
    if (!item || seen.has(item.name)) continue;
    normalized.push(item);
    seen.add(item.name);
  }

  if (normalized.length) return normalized;
  return inferCustomBlockAttributes(context);
}

function normalizeCustomBlockAttribute(attribute) {
  const rawName = String(attribute && attribute.name ? attribute.name : '').trim();
  const name = toAttributeName(rawName);
  if (!name || OPAQUE_CUSTOM_BLOCK_ATTRIBUTES.has(name)) return null;

  const requestedType = String(attribute.type || '').toLowerCase();
  const type = GENERATED_CUSTOM_BLOCK_ATTRIBUTE_TYPES.has(requestedType) ? requestedType : 'string';
  return {
    name,
    type,
    role: String(attribute.role || roleFromAttributeName(name)).trim() || roleFromAttributeName(name),
    source: String(attribute.source || 'extracted editable content').trim(),
  };
}

function inferCustomBlockAttributes({ name, slug: blockSlug, reason = '', controls = [] }) {
  const text = `${name || ''} ${blockSlug || ''} ${reason} ${controls.join(' ')}`.toLowerCase();

  if (/marquee|ticker/.test(text)) {
    return [
      { name: 'items', type: 'array', role: 'repeater', source: 'marquee item text' },
      { name: 'speedSeconds', type: 'number', role: 'inspector-control', source: 'animation speed' },
      { name: 'tone', type: 'string', role: 'style-variant', source: 'visual tone' },
    ];
  }

  if (/form|contact|inquiry|signup|newsletter/.test(text)) {
    return [
      { name: 'eyebrow', type: 'string', role: 'eyebrow', source: 'section eyebrow or label' },
      { name: 'heading', type: 'string', role: 'heading', source: 'section heading' },
      { name: 'body', type: 'string', role: 'body', source: 'supporting paragraph' },
      { name: 'fields', type: 'array', role: 'form-fields', source: 'form labels, types, placeholders, and options' },
      { name: 'buttonText', type: 'string', role: 'button-text', source: 'form submit button text' },
    ];
  }

  if (/collection|grid|card|product|work|portfolio|gallery|menu/.test(text)) {
    return [
      { name: 'eyebrow', type: 'string', role: 'eyebrow', source: 'section eyebrow or label' },
      { name: 'heading', type: 'string', role: 'heading', source: 'section heading' },
      { name: 'intro', type: 'string', role: 'body', source: 'section intro paragraph' },
      { name: 'items', type: 'array', role: 'cards', source: 'repeated card title, text, link, and visual metadata' },
    ];
  }

  return [
    { name: 'eyebrow', type: 'string', role: 'eyebrow', source: 'section eyebrow or label' },
    { name: 'heading', type: 'string', role: 'heading', source: 'section heading' },
    { name: 'body', type: 'string', role: 'body', source: 'supporting paragraph' },
    { name: 'ctaText', type: 'string', role: 'button-text', source: 'primary link text' },
    { name: 'ctaUrl', type: 'string', role: 'button-url', source: 'primary link href' },
  ];
}

function normalizeCustomBlockTemplate(template, { slug: blockSlug, sourceClassName = '' }) {
  const rootTag = ['section', 'div', 'article', 'aside', 'header', 'footer', 'nav'].includes(template && template.rootTag) ? template.rootTag : 'section';
  return {
    rootTag,
    rootClass: String((template && template.rootClass) || sourceClassName || blockSlug || '').trim(),
    structure: String((template && template.structure) || 'Render semantic editable attributes with stable class names.').trim(),
  };
}

function toAttributeName(value) {
  const parts = String(value)
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (!parts.length) return '';
  const name = parts[0] + parts.slice(1).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
  return /^[A-Za-z_]/.test(name) ? name : `field${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

function roleFromAttributeName(name) {
  if (/action/i.test(name)) return 'form-action';
  if (/method/i.test(name)) return 'form-method';
  if (/input.*name|field.*name/i.test(name)) return 'form-input-name';
  if (/placeholder/i.test(name)) return 'form-placeholder';
  if (/required/i.test(name)) return 'form-required';
  if (/note|privacy|disclaimer|help/i.test(name)) return 'form-note';
  if (/eyebrow|kicker|label/.test(name)) return 'eyebrow';
  if (/heading|title|headline/.test(name)) return 'heading';
  if (/body|text|description|intro|lede|copy|subtitle/.test(name)) return 'body';
  if (/fields?/.test(name)) return 'form-fields';
  if (/items?|cards?|products?|entries?/.test(name)) return 'repeater';
  if (/button.*text|cta.*text/.test(name)) return 'button-text';
  if (/url|href|link/.test(name)) return 'url';
  return 'content';
}

function sourceClassNameFromSelector(value) {
  const selectorValue = String(value || '');
  const classMatches = [...selectorValue.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((match) => match[1]);
  return classMatches.join(' ');
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
          required: ['name', 'slug', 'reason', 'controls', 'attributes', 'template'],
          properties: {
            name: { type: 'string' },
            slug: { type: 'string' },
            reason: { type: 'string' },
            controls: { type: 'array', items: { type: 'string' } },
            attributes: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['name', 'type', 'role', 'source'],
                properties: {
                  name: { type: 'string' },
                  type: { type: 'string', enum: ['string', 'number', 'boolean', 'array', 'object'] },
                  role: { type: 'string' },
                  source: { type: 'string' },
                },
              },
            },
            template: {
              type: 'object',
              additionalProperties: false,
              required: ['rootTag', 'rootClass', 'structure'],
              properties: {
                rootTag: { type: 'string' },
                rootClass: { type: 'string' },
                structure: { type: 'string' },
              },
            },
          },
        },
      },
    },
  };
}

async function assembleBlocksWithOpenAi({ prompt, mockup, analysis, plan, contentInventory, supportedBlockNames }) {
  const plannedCustomBlocks = renderCustomBlockContracts(plan.customBlocks);
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
      'When using a planned custom block, attributesJson must contain only attributes declared in that custom block contract, plus optional className. Fill those typed attributes from the content inventory.',
      'Never put html, sourceHtml, markup, innerHTML, editableFields, or sourceSelector into a generated custom block. A custom block is not a disguised HTML block.',
      'For custom blocks that represent forms, populate form fields as structured field objects whenever the contract has a fields attribute. Preserve action/method as behavior attributes and label/placeholder/button text as editable field content. Do not flatten action, method, label, inputName, placeholder, or required into visible paragraphs.',
      'Use core/html only for the smallest decorative fragment, such as an isolated SVG or background element, and never for headings, paragraphs, links, repeated cards, or forms that should remain editable.',
      'For every block, attributesJson must be a valid JSON object string containing the attributes for that block. Use "{}" when there are no attributes.',
      'Return a block tree that can render a close visual approximation using the generated CSS and the POC custom block CSS.',
    ].join(' '),
    inputText: [
      `User prompt:\n${prompt}`,
      `Analysis:\n${JSON.stringify(analysis, null, 2)}`,
      `Plan:\n${JSON.stringify(plan, null, 2)}`,
      `Planned custom static block contracts:\n${plannedCustomBlocks || '(none)'}`,
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

function renderCustomBlockContracts(customBlocks) {
  return customBlocks
    .map((block) =>
      [
        `- ${block.name}`,
        `  Reason: ${block.reason}`,
        `  Controls: ${block.controls.join(', ') || 'typed attributes only'}`,
        `  Template: ${block.template.rootTag}.${block.template.rootClass || block.slug} - ${block.template.structure}`,
        `  Allowed attributes: ${block.attributes.map((attribute) => `${attribute.name}:${attribute.type}:${attribute.role}`).join(', ')}`,
      ].join('\n')
    )
    .join('\n');
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
    cards: extractCards(document),
    forms: extractForms(document),
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
    cards: extractCards(node),
    forms: extractForms(node),
  };
}

function extractCards(root) {
  return findElements(root, 'article')
    .map((node) => {
      const heading = findElements(node).find((child) => /^h[1-6]$/.test(child.tagName));
      const paragraph = findElements(node, 'p')[0];
      const link = findElements(node, 'a')[0];
      return {
        className: attr(node, 'class') || '',
        title: heading ? clean(text(heading)) : '',
        text: paragraph ? clean(text(paragraph)) : '',
        url: link ? attr(link, 'href') || '' : '',
        linkText: link ? clean(text(link)) : '',
      };
    })
    .filter((item) => item.title || item.text || item.linkText);
}

function extractForms(root) {
  return findElements(root, 'form')
    .map((form) => ({
      className: attr(form, 'class') || '',
      fields: findElements(form, 'label')
        .map((label) => {
          const control = findElements(label).find((child) => ['input', 'select', 'textarea'].includes(child.tagName));
          if (!control) return null;
          return {
            label: clean(directText(label)) || clean(text(label)).replace(clean(text(control)), '').trim(),
            type: control.tagName === 'input' ? attr(control, 'type') || 'text' : control.tagName,
            name: attr(control, 'name') || slug(clean(directText(label))),
            placeholder: attr(control, 'placeholder') || '',
            options: control.tagName === 'select' ? findElements(control, 'option').map((option) => clean(text(option))).filter(Boolean) : [],
          };
        })
        .filter(Boolean),
      buttonText: clean(text(findElements(form, 'button')[0])),
    }))
    .filter((form) => form.fields.length || form.buttonText);
}

function directText(node) {
  return (node.childNodes || [])
    .filter((child) => typeof child.value === 'string')
    .map((child) => child.value)
    .join(' ');
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
  const state = {
    headings: new Set(),
    paragraphs: new Set(),
    links: new Set(),
    htmlFragments: new Set(),
    repairs: [],
  };

  visitBlocks(blockTree, (block) => {
    const attributes = block.attributes || {};

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

function enforceCustomBlockContracts(blockTree, plan, inventory) {
  const customBlocksByName = new Map(plan.customBlocks.map((block) => [block.name, block]));
  const sectionsByBlockName = new Map((plan.sections || []).filter((section) => section.customBlock).map((section) => [section.customBlock, section]));
  const repairs = [];

  visitBlocks(blockTree, (block) => {
    const customBlock = customBlocksByName.get(block.name);
    if (!customBlock || FIXED_CUSTOM_BLOCKS.includes(block.name)) return;

    const section = sectionsByBlockName.get(block.name);
    const sectionInventory = section ? findInventorySection(inventory, section.sourceSelector || section.id) : null;
    const before = JSON.stringify(block.attributes || {});
    block.attributes = sanitizeGeneratedCustomBlockAttributes(block.attributes || {}, customBlock, sectionInventory);
    const after = JSON.stringify(block.attributes || {});
    if (before !== after) {
      repairs.push({
        block: block.name,
        action: 'enforced-custom-block-contract',
        removedOpaqueAttributes: opaqueCustomBlockAttributesInObject(JSON.parse(before || '{}')),
        allowedAttributes: customBlock.attributes.map((attribute) => attribute.name),
      });
    }
  });

  return {
    repairedBlocks: repairs.length,
    repairs,
  };
}

function sanitizeGeneratedCustomBlockAttributes(attributes, customBlock, sectionInventory) {
  const allowedAttributes = new Map(customBlock.attributes.map((attribute) => [attribute.name, attribute]));
  const sanitized = {};

  for (const [name, value] of Object.entries(attributes || {})) {
    if (name === 'className') {
      sanitized.className = value;
      continue;
    }
    if (!allowedAttributes.has(name) || OPAQUE_CUSTOM_BLOCK_ATTRIBUTES.has(name)) continue;
    sanitized[name] = value;
  }

  for (const attribute of customBlock.attributes) {
    if (hasAttributeValue(sanitized[attribute.name])) continue;
    const value = deriveAttributeValue(attribute, sectionInventory, customBlock);
    if (hasAttributeValue(value)) sanitized[attribute.name] = value;
  }

  return sanitized;
}

function opaqueCustomBlockAttributesInObject(attributes) {
  return Object.keys(attributes || {}).filter((name) => OPAQUE_CUSTOM_BLOCK_ATTRIBUTES.has(name));
}

function hasAttributeValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function deriveAttributeValue(attribute, sectionInventory, customBlock) {
  const role = `${attribute.role || ''} ${attribute.name}`.toLowerCase();
  const fields = sectionInventory ? sectionInventory.editableFields || {} : {};
  const headings = fields.headings || [];
  const paragraphs = fields.paragraphs || [];
  const links = fields.links || [];
  const cards = fields.cards || [];
  const forms = fields.forms || [];

  if (attribute.type === 'array') {
    if (/fields?|form/.test(role)) return forms[0] ? forms[0].fields : [];
    if (/cards?|items?|products?|entries?|repeater|grid|collection/.test(role)) {
      if (cards.length) return cards;
      if (links.length) return links.map((link) => ({ title: link.text, url: link.url }));
      return paragraphs.map((paragraph) => paragraph.content);
    }
    return paragraphs.map((paragraph) => paragraph.content);
  }

  if (attribute.type === 'object') {
    if (/form/.test(role)) return forms[0] || {};
    return {};
  }

  if (attribute.type === 'number') {
    if (/speed|duration|seconds/.test(role)) return 18;
    return 0;
  }

  if (attribute.type === 'boolean') return false;

  if (/eyebrow|kicker|label/.test(role)) {
    const eyebrow = paragraphs.find((paragraph) => /eyebrow|kicker|label/i.test(paragraph.className));
    return eyebrow ? eyebrow.content : '';
  }

  if (/heading|title|headline/.test(role)) {
    return headings[0] ? headings[0].content : '';
  }

  if (/button.*text|cta.*text|submit/.test(role)) {
    if (links[0]) return links[0].text;
    if (forms[0]) return forms[0].buttonText;
    return '';
  }

  if (/url|href|link/.test(role)) {
    return links[0] ? links[0].url : '';
  }

  if (/class/.test(role)) {
    return [customBlock.template.rootClass, customBlock.sourceClassName].filter(Boolean).join(' ');
  }

  const bodyParagraph = paragraphs.find((paragraph) => !/eyebrow|kicker|label/i.test(paragraph.className));
  return bodyParagraph ? bodyParagraph.content : '';
}

function findInventorySection(inventory, expectedSource) {
  return (inventory.sections || []).find((candidate) => matchesSection(candidate, expectedSource));
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
        attributes: [
          { name: 'items', type: 'array', role: 'repeater', source: 'marquee item text' },
          { name: 'speedSeconds', type: 'number', role: 'inspector-control', source: 'animation speed in seconds' },
          { name: 'tone', type: 'string', role: 'style-variant', source: 'visual tone' },
        ],
        template: {
          rootTag: 'section',
          rootClass: 'values-marquee',
          structure: 'Render duplicated editable item text inside a marquee track with speed and tone controls.',
        },
      },
      {
        name: 'poc/studio-inquiry',
        slug: 'studio-inquiry',
        reason: 'Structured form fields, labels, placeholders, and submit button need a coherent editor UI.',
        controls: ['RichText heading fields', 'field list controls', 'button text control', 'core columns layout wrapper'],
        attributes: [
          { name: 'eyebrow', type: 'string', role: 'eyebrow', source: 'section eyebrow' },
          { name: 'heading', type: 'string', role: 'heading', source: 'section heading' },
          { name: 'fields', type: 'array', role: 'form-fields', source: 'field labels, types, placeholders, and options' },
          { name: 'buttonText', type: 'string', role: 'button-text', source: 'submit button text' },
        ],
        template: {
          rootTag: 'section',
          rootClass: 'inquiry',
          structure: 'Render editable intro copy and structured form fields inside a responsive columns layout.',
        },
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
    },
    save: ({ attributes }) =>
      element.createElement(
        'div',
        { className: 'wp-block-button' },
        element.createElement('a', { className: 'wp-block-button__link wp-element-button', href: attributes.url }, element.createElement(element.RawHTML, null, attributes.text || ''))
      ),
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
      attributes: customBlockAttributes(customBlock.name, customBlock),
      save: ({ attributes }) => renderGeneratedCustomBlock(customBlock, attributes),
    });
  }
}

function supportedAssemblyBlockNames(plan) {
  return [...new Set([...BASE_ASSEMBLY_BLOCKS, ...plan.customBlocks.map((block) => block.name)])];
}

function renderGeneratedCustomBlock(customBlock, attributes) {
  const rootTag = customBlock.template.rootTag || 'section';
  const rootClassName = [
    wpBlockClassName(customBlock.name),
    customBlock.template.rootClass,
    customBlock.sourceClassName,
    attributes.className,
  ]
    .filter(Boolean)
    .join(' ');

  if (customBlockLooksFormLike(customBlock)) {
    return renderGeneratedFormCustomBlock(customBlock, attributes, rootTag, rootClassName);
  }

  const children = [];

  for (const attribute of customBlock.attributes) {
    const value = attributes[attribute.name];
    if (!hasAttributeValue(value)) continue;
    const rendered = renderGeneratedCustomBlockAttribute(customBlock, attribute, value, attributes);
    if (rendered) children.push(rendered);
  }

  return element.createElement(rootTag, { className: rootClassName }, ...children);
}

function renderGeneratedFormCustomBlock(customBlock, attributes, rootTag, rootClassName) {
  const introChildren = [];
  const noteChildren = [];

  for (const attribute of customBlock.attributes) {
    const value = attributes[attribute.name];
    if (!hasAttributeValue(value)) continue;
    const role = `${attribute.role || ''} ${attribute.name}`.toLowerCase();

    if (/form-note|note|privacy|disclaimer/.test(role)) {
      noteChildren.push(element.createElement('p', { key: attribute.name, className: `${customBlock.slug}__note` }, element.createElement(element.RawHTML, null, value)));
      continue;
    }

    if (isFormBehaviorAttribute(attribute) || /form-label|form-fields|fields|button/.test(role)) {
      continue;
    }

    const rendered = renderGeneratedCustomBlockAttribute(customBlock, attribute, value, attributes);
    if (rendered) introChildren.push(rendered);
  }

  const formModel = generatedFormModel(customBlock, attributes);
  const form = element.createElement(
    'form',
    {
      key: 'form',
      className: `${customBlock.slug}__form`,
      action: formModel.action,
      method: formModel.method,
    },
    formModel.fields.map((field) => renderField(field)),
    element.createElement('button', { type: 'submit' }, formModel.buttonText)
  );

  return element.createElement(rootTag, { className: rootClassName }, ...introChildren, form, ...noteChildren);
}

function generatedFormModel(customBlock, attributes) {
  const fields = normalizeGeneratedFormFields(customBlock, attributes);
  return {
    action: stringAttribute(attributes.action || attributes.formAction || '#'),
    method: stringAttribute(attributes.method || attributes.formMethod || 'post').toLowerCase() === 'get' ? 'get' : 'post',
    fields,
    buttonText: stringAttribute(attributes.buttonText || attributes.submitText || attributes.ctaText || inferFormSubmitText(customBlock)),
  };
}

function normalizeGeneratedFormFields(customBlock, attributes) {
  if (Array.isArray(attributes.fields) && attributes.fields.length) {
    return attributes.fields.map((field, index) => normalizeGeneratedFormField(customBlock, field, index));
  }

  const label = stringAttribute(attributes.label || attributes.fieldLabel || attributes.emailLabel || inferFormFieldLabel(customBlock));
  const inputName = stringAttribute(attributes.inputName || attributes.fieldName || slug(label));
  const type = stringAttribute(attributes.inputType || attributes.type || inferFormFieldType(customBlock, inputName, label));
  return [
    normalizeGeneratedFormField(customBlock, {
      label,
      type,
      name: inputName,
      placeholder: attributes.placeholder || attributes.emailPlaceholder || '',
      required: attributes.required,
      options: attributes.options || [],
    }),
  ];
}

function normalizeGeneratedFormField(customBlock, field, index = 0) {
  if (!field || typeof field !== 'object') {
    const label = String(field || inferFormFieldLabel(customBlock));
    return {
      label,
      type: inferFormFieldType(customBlock, '', label),
      name: slug(label || `field-${index + 1}`),
      placeholder: '',
      required: false,
      options: [],
    };
  }

  const label = stringAttribute(field.label || field.name || inferFormFieldLabel(customBlock));
  const name = stringAttribute(field.name || field.inputName || slug(label || `field-${index + 1}`));
  const type = stringAttribute(field.type || inferFormFieldType(customBlock, name, label)).toLowerCase();
  return {
    label,
    type: ['email', 'search', 'tel', 'url', 'number', 'date', 'textarea', 'select', 'text'].includes(type) ? type : 'text',
    name,
    placeholder: stringAttribute(field.placeholder || ''),
    required: Boolean(field.required),
    options: Array.isArray(field.options) ? field.options.map(String) : [],
  };
}

function inferFormSubmitText(customBlock) {
  const text = `${customBlock.name} ${customBlock.slug}`.toLowerCase();
  if (/search/.test(text)) return 'Search';
  if (/book|booking|reserve/.test(text)) return 'Book';
  if (/subscribe|signup|newsletter|email|dispatch/.test(text)) return 'Subscribe';
  return 'Submit';
}

function inferFormFieldLabel(customBlock) {
  const text = `${customBlock.name} ${customBlock.slug}`.toLowerCase();
  if (/search/.test(text)) return 'Search';
  if (/email|subscribe|signup|newsletter|dispatch/.test(text)) return 'Email address';
  return 'Name';
}

function inferFormFieldType(customBlock, name, label) {
  const text = `${customBlock.name} ${customBlock.slug} ${name} ${label}`.toLowerCase();
  if (/search/.test(text)) return 'search';
  if (/email|subscribe|signup|newsletter|dispatch/.test(text)) return 'email';
  return 'text';
}

function stringAttribute(value) {
  return typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
}

function renderGeneratedCustomBlockAttribute(customBlock, attribute, value, attributes) {
  const role = `${attribute.role || ''} ${attribute.name}`.toLowerCase();
  const className = `${customBlock.slug}__${slug(attribute.name)}`;

  if (attribute.type === 'array') {
    if (/fields?|form/.test(role)) {
      return element.createElement(
        'form',
        { key: attribute.name, className },
        value.map((field) => renderField(field)),
        element.createElement('button', { type: 'submit' }, attributes.buttonText || attributes.ctaText || 'Submit')
      );
    }

    return element.createElement(
      'div',
      { key: attribute.name, className },
      value.map((item, index) => renderGeneratedCustomBlockItem(customBlock, attribute, item, index))
    );
  }

  if (/inspector|style-variant|control|speed|tone/.test(role)) return null;

  if (/eyebrow|kicker|label/.test(role)) {
    return element.createElement('p', { key: attribute.name, className: ['eyebrow', className].join(' ') }, value);
  }

  if (/heading|title|headline/.test(role)) {
    const level = /hero/.test(customBlock.slug) ? 'h1' : 'h2';
    return element.createElement(level, { key: attribute.name, className }, element.createElement(element.RawHTML, null, value));
  }

  if (/button.*text|cta.*text/.test(role)) {
    if (customBlockHasFormFields(customBlock)) return null;
    const url = attributes.ctaUrl || attributes.buttonUrl || attributes.url || '#';
    return element.createElement('a', { key: attribute.name, className: ['button', className].join(' '), href: url }, value);
  }

  if (/url|href|link/.test(role)) return null;

  return element.createElement('p', { key: attribute.name, className }, element.createElement(element.RawHTML, null, value));
}

function isFormBehaviorAttribute(attribute) {
  const role = `${attribute.role || ''} ${attribute.name || ''}`.toLowerCase();
  return /form-action|form-method|form-input-name|form-placeholder|form-required|input-name|placeholder|required|action|method/.test(role);
}

function renderGeneratedCustomBlockItem(customBlock, attribute, item, index) {
  const className = `${customBlock.slug}__item`;
  if (typeof item === 'string') {
    return element.createElement('span', { key: `${attribute.name}-${index}`, className }, item);
  }

  if (!item || typeof item !== 'object') {
    return null;
  }

  const title = item.title || item.heading || item.name || item.label || '';
  const body = item.text || item.description || item.body || item.content || '';
  const url = item.url || item.href || '';
  const linkText = item.linkText || item.ctaText || '';

  return element.createElement(
    'article',
    { key: `${attribute.name}-${index}`, className },
    title ? element.createElement('h3', null, title) : null,
    body ? element.createElement('p', null, body) : null,
    url && linkText ? element.createElement('a', { href: url }, linkText) : null
  );
}

function renderField(field) {
  if (!field || typeof field !== 'object') {
    return element.createElement('label', { key: String(field || 'field') }, String(field || 'Field'), element.createElement('input', { type: 'text', name: slug(field || 'field') }));
  }

  const id = field.name || slug(field.label || 'field');
  const required = Boolean(field.required);

  if (field.type === 'textarea') {
    return element.createElement(
      'label',
      { key: id },
      field.label,
      element.createElement('textarea', {
        name: id,
        placeholder: field.placeholder,
        required,
      })
    );
  }

  if (field.type === 'select') {
    return element.createElement(
      'label',
      { key: id },
      field.label,
      element.createElement(
        'select',
        { name: id, required },
        (field.options || []).map((option) => element.createElement('option', { key: option }, option))
      )
    );
  }

  return element.createElement(
    'label',
    { key: id },
    field.label,
    element.createElement('input', {
      type: field.type,
      name: id,
      placeholder: field.placeholder,
      required,
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
    const attributes = customBlockAttributes(customBlock.name, customBlock);
    writeJson(`${base}/block.json`, {
      apiVersion: 3,
      name: customBlock.name,
      title: titleCase(customBlock.slug),
      category: customBlockCategory(customBlock),
      attributes,
      supports: generatedCustomBlockSupports(customBlock),
    });
    write(
      `${base}/edit.js`,
      FIXED_CUSTOM_BLOCKS.includes(customBlock.name)
        ? fixedCustomBlockEditSource(customBlock)
        : generatedCustomBlockEditSource(customBlock)
    );
    write(`${base}/save.js`, FIXED_CUSTOM_BLOCKS.includes(customBlock.name) ? fixedCustomBlockSaveSource(customBlock) : generatedCustomBlockSaveSource(customBlock));
    write(`${base}/style.css`, FIXED_CUSTOM_BLOCKS.includes(customBlock.name) ? customBlockCss() : generatedCustomBlockCss(customBlock));
  }
}

function customBlockCategory(customBlock) {
  return customBlockLooksFormLike(customBlock) ? 'forms' : 'design';
}

function generatedCustomBlockSupports(customBlock) {
  return {
    anchor: true,
    align: ['wide', 'full'],
    className: true,
    color: {
      text: true,
      background: true,
      gradients: true,
    },
    spacing: {
      margin: true,
      padding: true,
      blockGap: true,
    },
    typography: {
      fontSize: true,
      lineHeight: true,
    },
    border: {
      color: true,
      radius: true,
      style: true,
      width: true,
    },
    html: false,
    reusable: true,
  };
}

function customBlockAttributes(name, customBlock = null) {
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

  const attributes = {
    className: { type: 'string' },
  };

  for (const attribute of (customBlock && customBlock.attributes) || []) {
    if (OPAQUE_CUSTOM_BLOCK_ATTRIBUTES.has(attribute.name)) continue;
    attributes[attribute.name] = { type: attribute.type };
    if (attribute.type === 'array') attributes[attribute.name].default = [];
    if (attribute.type === 'object') attributes[attribute.name].default = {};
  }

  return attributes;
}

function fixedCustomBlockEditSource(customBlock) {
  return generatedCustomBlockEditSource(customBlock);
}

function fixedCustomBlockSaveSource(customBlock) {
  return generatedCustomBlockSaveSource(customBlock);
}

function generatedCustomBlockEditSource(customBlock) {
  const rootTag = customBlock.template.rootTag || 'section';
  const rootClassName = [wpBlockClassName(customBlock.name), customBlock.template.rootClass, customBlock.sourceClassName].filter(Boolean).join(' ');
  const inspectorControls = customBlock.attributes.map((attribute) => generatedInspectorControlSource(attribute)).filter(Boolean).join('\n\n');
  const canvas = customBlockLooksFormLike(customBlock)
    ? generatedFormEditCanvasSource(customBlock)
    : customBlock.attributes.map((attribute) => generatedCanvasEditElementSource(customBlock, attribute)).filter(Boolean).join('\n\n');

  return `import { InspectorControls, useBlockProps, RichText } from '@wordpress/block-editor';
import { PanelBody, TextControl, ToggleControl } from '@wordpress/components';

export default function Edit({ attributes, setAttributes }) {
  const blockProps = useBlockProps({ className: ${jsString(rootClassName)} });
  const fields = attributes.fields?.length ? attributes.fields : [{ label: attributes.label || ${jsString(inferFormFieldLabel(customBlock))}, type: attributes.inputType || ${jsString(inferFormFieldType(customBlock, '', ''))}, name: attributes.inputName || ${jsString(slug(inferFormFieldLabel(customBlock)))}, placeholder: attributes.placeholder || '', required: !!attributes.required }];
  const updateField = (index, key, value) => {
    const next = [...fields];
    next[index] = { ...next[index], [key]: value };
    setAttributes({ fields: next });
  };

  return (
    <>
      ${inspectorControls ? `<InspectorControls>
        <PanelBody title="Settings">
${indent(inspectorControls, 10)}
        </PanelBody>
      </InspectorControls>` : ''}
      <${rootTag} {...blockProps}>
${indent(canvas || '<div />', 8)}
      </${rootTag}>
    </>
  );
}
`;
}

function generatedInspectorControlSource(attribute) {
  const label = titleCase(slug(attribute.name));
  const role = `${attribute.role || ''} ${attribute.name}`.toLowerCase();

  if (attribute.type === 'array' || attribute.type === 'object') return '';
  if (editorTagNameForAttribute(attribute) && !/url|href|link|action|method|placeholder|required|input-name|style-variant|control|speed|tone/.test(role)) return '';

  if (attribute.type === 'boolean') {
    return `<ToggleControl
  label=${jsString(label)}
  checked={!!attributes.${attribute.name}}
  onChange={(value) => setAttributes({ ${attribute.name}: value })}
/>`;
  }

  if (attribute.type === 'number') {
    return `<TextControl
  type="number"
  label=${jsString(label)}
  value={attributes.${attribute.name} ?? ''}
  onChange={(value) => setAttributes({ ${attribute.name}: Number(value) })}
/>`;
  }

  return `<TextControl
  label=${jsString(label)}
  value={attributes.${attribute.name} || ''}
  onChange={(value) => setAttributes({ ${attribute.name}: value })}
/>`;
}

function generatedCanvasEditElementSource(customBlock, attribute) {
  const role = `${attribute.role || ''} ${attribute.name}`.toLowerCase();
  const className = `${customBlock.slug}__${slug(attribute.name)}`;
  const tagName = editorTagNameForAttribute(attribute);

  if (/inspector|style-variant|control|speed|tone|url|href|link|action|method|placeholder|required|input-name/.test(role)) return '';

  if (attribute.type === 'array') {
    return `{(attributes.${attribute.name} || []).length > 0 && (
  <div className=${jsString(className)}>
    {(attributes.${attribute.name} || []).map((item, index) => (
      <article key={index} className=${jsString(`${customBlock.slug}__item`)}>
        {typeof item === 'string' ? (
          <RichText tagName="span" value={item} allowedFormats={['core/bold', 'core/italic', 'core/link']} onChange={(value) => {
            const next = [...(attributes.${attribute.name} || [])];
            next[index] = value;
            setAttributes({ ${attribute.name}: next });
          }} />
        ) : (
          <>
            <RichText tagName="h3" value={item?.title || item?.heading || ''} allowedFormats={['core/bold', 'core/italic', 'core/link']} onChange={(value) => {
              const next = [...(attributes.${attribute.name} || [])];
              next[index] = { ...item, title: value };
              setAttributes({ ${attribute.name}: next });
            }} />
            <RichText tagName="p" value={item?.text || item?.description || item?.body || ''} allowedFormats={['core/bold', 'core/italic', 'core/link']} onChange={(value) => {
              const next = [...(attributes.${attribute.name} || [])];
              next[index] = { ...item, text: value };
              setAttributes({ ${attribute.name}: next });
            }} />
          </>
        )}
      </article>
    ))}
  </div>
)}`;
  }

  if (!tagName) return '';

  return `<RichText
  tagName=${jsString(tagName)}
  className=${jsString(className)}
  value={attributes.${attribute.name} || ''}
  allowedFormats={['core/bold', 'core/italic', 'core/link']}
  placeholder=${jsString(titleCase(slug(attribute.name)))}
  onChange={(value) => setAttributes({ ${attribute.name}: value })}
/>`;
}

function generatedFormEditCanvasSource(customBlock) {
  const intro = customBlock.attributes
    .filter((attribute) => !isFormBehaviorAttribute(attribute) && !/form-label|form-fields|fields|button|submit|form-note|note|privacy|disclaimer/.test(`${attribute.role || ''} ${attribute.name}`.toLowerCase()))
    .map((attribute) => generatedCanvasEditElementSource(customBlock, attribute))
    .filter(Boolean)
    .join('\n\n');
  const noteAttribute = customBlock.attributes.find((attribute) => /form-note|note|privacy|disclaimer/.test(`${attribute.role || ''} ${attribute.name}`.toLowerCase()));
  const note = noteAttribute
    ? `<RichText
  tagName="p"
  className=${jsString(`${customBlock.slug}__note`)}
  value={attributes.${noteAttribute.name} || ''}
  allowedFormats={['core/bold', 'core/italic', 'core/link']}
  placeholder="Note"
  onChange={(value) => setAttributes({ ${noteAttribute.name}: value })}
/>`
    : '';

  return `${intro}
<form className=${jsString(`${customBlock.slug}__form`)}>
  {fields.map((field, index) => (
    <label key={field.name || index}>
      <RichText
        tagName="span"
        className=${jsString(`${customBlock.slug}__field-label`)}
        value={field.label || ''}
        allowedFormats={['core/bold', 'core/italic']}
        placeholder="Field label"
        onChange={(value) => updateField(index, 'label', value)}
      />
      {field.type === 'textarea' ? (
        <textarea name={field.name || ''} placeholder={field.placeholder || ''} required={!!field.required} disabled />
      ) : field.type === 'select' ? (
        <select name={field.name || ''} required={!!field.required} disabled>
          {(field.options || []).map((option) => <option key={option}>{option}</option>)}
        </select>
      ) : (
        <input type={field.type || 'text'} name={field.name || ''} placeholder={field.placeholder || ''} required={!!field.required} disabled />
      )}
    </label>
  ))}
  <button type="button" disabled>
    <RichText
      tagName="span"
      value={attributes.buttonText || attributes.submitText || attributes.ctaText || ${jsString(inferFormSubmitText(customBlock))}}
      allowedFormats={['core/bold', 'core/italic']}
      placeholder="Button text"
      onChange={(value) => setAttributes({ buttonText: value })}
    />
  </button>
</form>
${note}`.trim();
}

function generatedCustomBlockSaveSource(customBlock) {
  if (customBlockLooksFormLike(customBlock)) {
    return generatedFormCustomBlockSaveSource(customBlock);
  }

  const rootTag = customBlock.template.rootTag || 'section';
  const rootClassName = [wpBlockClassName(customBlock.name), customBlock.template.rootClass, customBlock.sourceClassName].filter(Boolean).join(' ');
  const children = customBlock.attributes.map((attribute) => generatedSaveElementSource(customBlock, attribute)).filter(Boolean).join('\n\n');

  return `import { useBlockProps, RichText } from '@wordpress/block-editor';

function renderItem(item, index) {
  if (typeof item === 'string') {
    return <span key={index}>{item}</span>;
  }

  return (
    <article key={index}>
      {item?.title && <h3>{item.title}</h3>}
      {item?.heading && <h3>{item.heading}</h3>}
      {item?.text && <p>{item.text}</p>}
      {item?.description && <p>{item.description}</p>}
      {item?.url && item?.linkText && <a href={item.url}>{item.linkText}</a>}
    </article>
  );
}

function renderField(field, index) {
  const id = field?.name || \`field-\${index}\`;
  const label = field?.label || id;
  if (field?.type === 'textarea') {
    return <label key={id}>{label}<textarea name={id} placeholder={field?.placeholder || ''} /></label>;
  }
  if (field?.type === 'select') {
    return (
      <label key={id}>{label}<select name={id}>{(field?.options || []).map((option) => <option key={option}>{option}</option>)}</select></label>
    );
  }
  return <label key={id}>{label}<input type={field?.type || 'text'} name={id} placeholder={field?.placeholder || ''} /></label>;
}

export default function save({ attributes }) {
  const blockProps = useBlockProps.save({ className: ${jsString(rootClassName)} });

  return (
    <${rootTag} {...blockProps}>
${indent(children, 6)}
    </${rootTag}>
  );
}
`;
}

function generatedFormCustomBlockSaveSource(customBlock) {
  const rootTag = customBlock.template.rootTag || 'section';
  const rootClassName = [wpBlockClassName(customBlock.name), customBlock.template.rootClass, customBlock.sourceClassName].filter(Boolean).join(' ');
  const intro = customBlock.attributes
    .filter((attribute) => !isFormBehaviorAttribute(attribute) && !/form-label|form-fields|fields|button|submit|form-note|note|privacy|disclaimer/.test(`${attribute.role || ''} ${attribute.name}`.toLowerCase()))
    .map((attribute) => generatedSaveElementSource(customBlock, attribute))
    .filter(Boolean)
    .join('\n\n');
  const noteAttribute = customBlock.attributes.find((attribute) => /form-note|note|privacy|disclaimer/.test(`${attribute.role || ''} ${attribute.name}`.toLowerCase()));
  const note = noteAttribute ? `{attributes.${noteAttribute.name} && <p className=${jsString(`${customBlock.slug}__note`)}>{attributes.${noteAttribute.name}}</p>}` : '';

  return `import { useBlockProps, RichText } from '@wordpress/block-editor';

function fieldName(field, index) {
  return field?.name || field?.inputName || String(field?.label || \`field-\${index + 1}\`).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || \`field-\${index + 1}\`;
}

function renderField(field, index) {
  const name = fieldName(field, index);
  const label = field?.label || name;
  if (field?.type === 'textarea') {
    return <label key={name}>{label}<textarea name={name} placeholder={field?.placeholder || ''} required={!!field?.required} /></label>;
  }
  if (field?.type === 'select') {
    return (
      <label key={name}>{label}<select name={name} required={!!field?.required}>{(field?.options || []).map((option) => <option key={option}>{option}</option>)}</select></label>
    );
  }
  return <label key={name}>{label}<input type={field?.type || 'text'} name={name} placeholder={field?.placeholder || ''} required={!!field?.required} /></label>;
}

export default function save({ attributes }) {
  const blockProps = useBlockProps.save({ className: ${jsString(rootClassName)} });
  const fields = attributes.fields?.length ? attributes.fields : [{
    label: attributes.label || ${jsString(inferFormFieldLabel(customBlock))},
    type: attributes.inputType || ${jsString(inferFormFieldType(customBlock, '', ''))},
    name: attributes.inputName || ${jsString(slug(inferFormFieldLabel(customBlock)))},
    placeholder: attributes.placeholder || '',
    required: !!attributes.required,
  }];

  return (
    <${rootTag} {...blockProps}>
${indent(intro, 6)}
      <form className=${jsString(`${customBlock.slug}__form`)} action={attributes.action || attributes.formAction || '#'} method={attributes.method || attributes.formMethod || 'post'}>
        {fields.map(renderField)}
        <button type="submit">{attributes.buttonText || attributes.submitText || attributes.ctaText || ${jsString(inferFormSubmitText(customBlock))}}</button>
      </form>
${indent(note, 6)}
    </${rootTag}>
  );
}
`;
}

function generatedSaveElementSource(customBlock, attribute) {
  const role = `${attribute.role || ''} ${attribute.name}`.toLowerCase();
  const className = `${customBlock.slug}__${slug(attribute.name)}`;

  if (customBlockLooksFormLike(customBlock) && (isFormBehaviorAttribute(attribute) || /form-label|form-fields|fields|form-note|note|privacy|disclaimer/.test(role))) {
    return '';
  }

  if (attribute.type === 'array') {
    if (/fields?|form/.test(role)) {
      return `{(attributes.${attribute.name} || []).length > 0 && (
  <form className=${jsString(className)}>
    {(attributes.${attribute.name} || []).map(renderField)}
    <button type="submit">{attributes.buttonText || attributes.ctaText || 'Submit'}</button>
  </form>
)}`;
    }

    return `{(attributes.${attribute.name} || []).length > 0 && (
  <div className=${jsString(className)}>
    {(attributes.${attribute.name} || []).map(renderItem)}
  </div>
)}`;
  }

  if (/inspector|style-variant|control|speed|tone/.test(role)) return '';

  if (/url|href|link/.test(role)) return '';

  if (/button.*text|cta.*text/.test(role)) {
    if (customBlockHasFormFields(customBlock)) return '';
    return `{attributes.${attribute.name} && <a className=${jsString(['button', className].join(' '))} href={attributes.ctaUrl || attributes.buttonUrl || attributes.url || '#'}>{attributes.${attribute.name}}</a>}`;
  }

  const tagName = editorTagNameForAttribute(attribute);
  if (tagName) {
    return `{attributes.${attribute.name} && <RichText.Content tagName=${jsString(tagName)} className=${jsString(className)} value={attributes.${attribute.name}} />}`;
  }

  return `{attributes.${attribute.name} && <p className=${jsString(className)}>{attributes.${attribute.name}}</p>}`;
}

function generatedCustomBlockCss(customBlock) {
  const rootClassName = wpBlockClassName(customBlock.name);
  return `.${rootClassName} {
  position: relative;
}

.${rootClassName} .eyebrow,
.${rootClassName} [class$="__eyebrow"] {
  text-transform: uppercase;
}

.${rootClassName} [class$="__items"] {
  display: grid;
  gap: 1rem;
}

.${rootClassName} [class$="__item"] {
  min-width: 0;
}

.${rootClassName} [class$="__form"] {
  display: grid;
  gap: 1rem;
}

.${rootClassName} [class$="__form"] label {
  display: grid;
  gap: 0.5rem;
}

.${rootClassName} [class$="__form"] input,
.${rootClassName} [class$="__form"] select,
.${rootClassName} [class$="__form"] textarea {
  font: inherit;
}
`;
}

function editorTagNameForAttribute(attribute) {
  const role = `${attribute.role || ''} ${attribute.name}`.toLowerCase();
  if (/eyebrow|kicker|label/.test(role)) return 'p';
  if (/heading|title|headline/.test(role)) return 'h2';
  if (/button.*text|cta.*text/.test(role)) return '';
  if (/body|text|description|intro|lede|copy|subtitle/.test(role)) return 'p';
  return '';
}

function customBlockHasFormFields(customBlock) {
  return customBlock.attributes.some((attribute) => /fields?|form/.test(`${attribute.role || ''} ${attribute.name}`.toLowerCase()));
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

function customBlockCss(plan = null) {
  const generatedCss = plan
    ? plan.customBlocks
        .filter((customBlock) => !FIXED_CUSTOM_BLOCKS.includes(customBlock.name))
        .map((customBlock) => generatedCustomBlockCss(customBlock))
        .join('\n')
    : '';

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
.wp-block-poc-studio-inquiry .inquiry-columns { --wp--columns-count: 2; align-items: start; margin: 0; }
${generatedCss}`;
}

function buildReport({ prompt, analysis, plan, assembly, providers, contentRepair, customContractRepair }) {
  return {
    prompt,
    providers,
    contentRepair,
    customContractRepair,
    sectionsAnalyzed: analysis.sections.length,
    sectionStrategies: plan.sections.map((section) => ({
      id: section.id,
      strategy: section.strategy,
      coreAttempt: section.coreAttempt.verdict,
      customBlock: section.customBlock || null,
    })),
    customBlocks: plan.customBlocks.map((block) => ({
      name: block.name,
      slug: block.slug,
      attributes: block.attributes.map((attribute) => `${attribute.name}:${attribute.type}:${attribute.role}`),
      template: block.template,
    })),
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
- Custom blocks: ${report.customBlocks.map((block) => block.name).join(', ')}
- LLM providers: html=${report.providers.html}, plan=${report.providers.plan}, assembly=${report.providers.assembly}
- Content repairs applied: ${report.contentRepair.repairedBlocks}
- Custom contract repairs applied: ${report.customContractRepair.repairedBlocks}

## Section Strategies

${report.sectionStrategies
  .map((section) => `- \`${section.id}\`: ${section.strategy}${section.customBlock ? ` (${section.customBlock})` : ''}\n  - Core attempt: ${section.coreAttempt}`)
  .join('\n')}

## Custom Block Contracts

${report.customBlocks
  .map((block) => `- \`${block.name}\`: ${block.attributes.join(', ') || 'no attributes'}\n  - Template: ${block.template.rootTag}.${block.template.rootClass || block.slug}`)
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

function wpBlockClassName(name) {
  return `wp-block-${String(name).replace('/', '-').replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function jsString(value) {
  return JSON.stringify(String(value));
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
