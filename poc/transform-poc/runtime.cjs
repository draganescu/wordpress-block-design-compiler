const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const DEFAULT_PROMPT = [
  'Create a polished landing page for a ceramic studio called Kiln & Kind.',
  'It should have a tactile editorial layout, a hero, a product story, an animated maker-values marquee,',
  'a small collection grid, and a workshop inquiry form.',
].join(' ');

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
  hasFlag,
  loadEnvFiles,
  readOption,
  resolvePrompt,
  stripOptions,
};
