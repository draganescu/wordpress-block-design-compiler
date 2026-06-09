const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const DEFAULT_PROMPT = [
  'Create a polished landing page for a ceramic studio called Kiln & Kind.',
  'It should have a tactile editorial layout, a hero, a product story, an animated maker-values marquee,',
  'a small collection grid, and a workshop inquiry form.',
].join(' ');

const DEFAULT_OPENAI_TEXT_MODEL = 'gpt-4.1';
const OPENAI_TIMEOUT_MS = 120000;

function loadEnvFiles() {
  const candidates = [
    path.resolve('.env'),
    path.resolve('.env.local'),
    path.resolve('poc/transform-poc/.env'),
    path.resolve('poc/transform-poc/.env.local'),
  ];

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    const values = parseEnvFile(fs.readFileSync(filePath, 'utf8'));
    for (const [key, value] of Object.entries(values)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

function parseEnvFile(content) {
  const values = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    values[match[1]] = unquoteEnvValue(match[2]);
  }

  return values;
}

function unquoteEnvValue(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed.replace(/\s+#.*$/, '');
}

async function resolvePrompt({ defaultPrompt = DEFAULT_PROMPT } = {}) {
  const args = process.argv.slice(2);
  const promptFile = readOption(args, ['--prompt-file']) || process.env.POC_PROMPT_FILE;
  if (promptFile) {
    return fs.readFileSync(path.resolve(promptFile), 'utf8').trim();
  }

  const cliPrompt = readOption(args, ['--prompt']);
  if (cliPrompt) return cliPrompt.trim();

  if (process.env.POC_PROMPT) {
    return process.env.POC_PROMPT.trim();
  }

  if (hasFlag(args, ['--default-prompt', '--no-interactive']) || process.env.CI || !process.stdin.isTTY) {
    return defaultPrompt;
  }

  return askForPrompt(defaultPrompt);
}

async function askForPrompt(defaultPrompt) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await new Promise((resolve) => {
      rl.question(`Design prompt for transform POC\nPress enter for the default Kiln & Kind fixture.\n> `, resolve);
    });
    return answer.trim() || defaultPrompt;
  } finally {
    rl.close();
  }
}

function readOption(args, names) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    for (const name of names) {
      if (arg === name) {
        return args[index + 1];
      }
      if (arg.startsWith(`${name}=`)) {
        return arg.slice(name.length + 1);
      }
    }
  }

  return null;
}

function hasFlag(args, names) {
  return args.some((arg) => names.includes(arg));
}

function resolveProvider({ stage, fallback = 'deterministic', args = process.argv.slice(2) }) {
  const stageValue = readOption(args, [`--${stage}-provider`]);
  const llmValue = readOption(args, ['--llm-provider']);
  const providerValue = readOption(args, ['--provider']);
  const envStageName = `POC_${stage.toUpperCase().replace(/-/g, '_')}_PROVIDER`;
  const requested = stageValue || llmValue || providerValue || process.env[envStageName] || process.env.POC_LLM_PROVIDER || fallback;

  if (requested === 'auto') {
    return process.env.OPENAI_API_KEY ? 'openai' : fallback;
  }

  if (['deterministic', 'openai', 'off'].includes(requested)) {
    return requested;
  }

  throw new Error(`Unsupported ${stage} provider "${requested}". Use deterministic, openai, auto, or off.`);
}

function assertOpenAiReady(label = 'OpenAI provider') {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(`${label} requires OPENAI_API_KEY in the process environment or a local env file.`);
  }
}

async function callOpenAiJson({ instructions, inputText, schema, schemaName, strict = true, model = process.env.OPENAI_TEXT_MODEL || DEFAULT_OPENAI_TEXT_MODEL }) {
  assertOpenAiReady('OpenAI LLM stage');

  const response = await fetchWithTimeout(`${process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'}/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      store: false,
      instructions,
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: inputText }],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: schemaName,
          strict,
          schema,
        },
      },
    }),
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI request failed with ${response.status}: ${responseText}`);
  }

  const responseJson = JSON.parse(responseText);
  return JSON.parse(extractOpenAiOutputText(responseJson));
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

function stripOptions(args, names) {
  const stripped = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const matchingName = names.find((name) => arg === name || arg.startsWith(`${name}=`));
    if (!matchingName) {
      stripped.push(arg);
      continue;
    }
    if (arg === matchingName) {
      index += 1;
    }
  }
  return stripped;
}

module.exports = {
  DEFAULT_PROMPT,
  assertOpenAiReady,
  callOpenAiJson,
  hasFlag,
  loadEnvFiles,
  readOption,
  resolvePrompt,
  resolveProvider,
  stripOptions,
};
