#!/usr/bin/env node
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadEnvFiles, readOption, stripOptions } = require('./runtime.cjs');

loadEnvFiles();

const ROOT = __dirname;
const args = process.argv.slice(2);
const visionProvider = readOption(args, ['--vision-provider', '--provider']);
const runArgs = stripOptions(args, ['--vision-provider', '--provider']);
const visionArgs = visionProvider ? [`--provider=${visionProvider}`] : [];

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
