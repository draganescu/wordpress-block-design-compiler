#!/usr/bin/env node
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadEnvFiles, readOption, stripOptions } = require('./runtime.cjs');

loadEnvFiles();

const ROOT = __dirname;
const args = process.argv.slice(2);
const llmProvider = readOption(args, ['--llm-provider']) || process.env.POC_LLM_PROVIDER || 'openai';
const htmlProvider = readOption(args, ['--html-provider']);
const planProvider = readOption(args, ['--plan-provider']);
const assemblyProvider = readOption(args, ['--assembly-provider']);
const visionProvider = readOption(args, ['--vision-provider', '--provider']);
const runArgs = stripOptions(args, ['--vision-provider']);
const visionArgs = [];

if (!htmlProvider) runArgs.push(`--html-provider=${llmProvider}`);
if (!planProvider) runArgs.push(`--plan-provider=${llmProvider}`);
if (!assemblyProvider) runArgs.push(`--assembly-provider=${llmProvider}`);
visionArgs.push(`--provider=${visionProvider || llmProvider}`);

runStep('HTML transform', path.join(ROOT, 'run.cjs'), runArgs);
runStep('Vision comparison', path.join(ROOT, 'vision.cjs'), visionArgs);

function runStep(label, script, stepArgs) {
  const result = spawnSync(process.execPath, [script, ...stepArgs], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.stderr.write(`${label} failed with exit code ${result.status}.\n`);
    process.exit(result.status || 1);
  }
}
