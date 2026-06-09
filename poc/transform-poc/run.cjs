#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const parse5 = require('parse5');
const csstree = require('css-tree');
const { loadEnvFiles, resolvePrompt } = require('./runtime.cjs');

const requireFromRoot = createRequire(path.join(process.cwd(), 'package.json'));
const blocks = requireFromRoot('@wordpress/blocks');
const element = requireFromRoot('@wordpress/element');

const ROOT = path.resolve('poc/transform-poc');
const OUT = path.join(ROOT, 'output');

loadEnvFiles();

async function main() {
  resetOutput();
  registerPocBlocks();

  const prompt = await resolvePrompt();

  const mockup = generateMockup(prompt);
  write('mockup/prompt.md', `${prompt}\n`);
  write('mockup/index.html', mockup.html);
  write('mockup/style.css', mockup.css);

  const analysis = analyzeMockup(mockup.html, mockup.css);
  writeJson('analysis/analysis.json', analysis);

  const plan = planBlocks(analysis);
  writeJson('plan/block-implementation-plan.json', plan);

  const assembly = assembleBlocks(plan);
  writeJson('wordpress/block-tree.json', simplifyBlocks(assembly.blockTree));
  write('wordpress/content.html', assembly.blockMarkup);
  writeCustomBlockSource(plan);

  const renderedFragment = stripBlockComments(assembly.blockMarkup);
  const renderedHtml = renderFullHtml({
    title: 'Rendered Blocks - Kiln & Kind',
    css: [mockup.css, customBlockCss()].join('\n\n'),
    body: renderedFragment,
  });
  write('rendered/rendered-fragment.html', renderedFragment);
  write('rendered/rendered-blocks.html', renderedHtml);

  const report = buildReport({ prompt, analysis, plan, assembly });
  writeJson('reports/summary.json', report);
  write('reports/summary.md', renderMarkdownReport(report));

  process.stdout.write(
    JSON.stringify(
      {
        output: OUT,
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
.inquiry-form input, .inquiry-form select { min-height: 44px; border: 1px solid rgba(20,32,29,.24); padding: 0 12px; font: inherit; background: var(--paper); }
@media (max-width: 760px) {
  .hero, .story, .inquiry, .product-grid { grid-template-columns: 1fr; }
  .hero-object { min-height: 360px; }
}
`;

  return { html, css };
}

function analyzeMockup(html, css) {
  const document = parse5.parse(html);
  const sections = findElements(document, 'section').map((section, index) => {
    const className = attr(section, 'class') || '';
    const heading = findElements(section).find((node) => /^h[1-6]$/.test(node.tagName));
    const hasForm = findElements(section, 'form').length > 0;
    const hasMarquee = className.includes('marquee') || findElements(section).some((node) => (attr(node, 'class') || '').includes('marquee-track'));

    return {
      id: attr(section, 'data-section') || attr(section, 'id') || `section-${index + 1}`,
      selector: selector(section),
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

function renderField(field) {
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
    writeJson(`${base}/block.json`, {
      apiVersion: 3,
      name: customBlock.name,
      title: titleCase(customBlock.slug),
      category: customBlock.name.includes('inquiry') ? 'forms' : 'design',
      attributes: customBlock.name.includes('marquee')
        ? {
            items: { type: 'array', default: [] },
            speedSeconds: { type: 'number', default: 18 },
            tone: { type: 'string', default: 'clay' },
          }
        : {
            eyebrow: { type: 'string' },
            heading: { type: 'string' },
            fields: { type: 'array', default: [] },
            buttonText: { type: 'string' },
          },
    });
    write(`${base}/edit.js`, `// POC edit component sketch.\n// Controls: ${customBlock.controls.join(', ')}\n`);
    write(`${base}/save.js`, `// POC save implementation lives in run.cjs for executable comparison.\n`);
    write(`${base}/style.css`, customBlockCss());
  }
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
.wp-block-poc-studio-inquiry .inquiry-columns { --wp--columns-count: 2; align-items: start; margin: 0; }`;
}

function buildReport({ prompt, analysis, plan, assembly }) {
  return {
    prompt,
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
