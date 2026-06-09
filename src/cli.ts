#!/usr/bin/env node
import process from 'node:process';
import { runFixture } from './fixtures.js';

const HELP = `wp-block-compiler

A staged design-to-WordPress-block compiler.

Usage:
  wp-block-compiler doctor
  wp-block-compiler run-fixture <fixture-path> --out <artifact-dir>
  wp-block-compiler --help
`;

interface ParsedArgs {
  command: string | undefined;
  positional: string[];
  flags: Map<string, string | true>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const positional: string[] = [];
  const flags = new Map<string, string | true>();

  for (let index = 0; index < rest.length; index++) {
    const value = rest[index];
    if (value.startsWith('--')) {
      const name = value.slice(2);
      const next = rest[index + 1];
      if (next && !next.startsWith('--')) {
        flags.set(name, next);
        index++;
      } else {
        flags.set(name, true);
      }
      continue;
    }

    positional.push(value);
  }

  return { command, positional, flags };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.command || args.command === '--help' || args.command === 'help') {
    process.stdout.write(HELP);
    return;
  }

  if (args.command === 'doctor') {
    process.stdout.write(`wp-block-compiler doctor
node: ${process.version}
platform: ${process.platform}
cwd: ${process.cwd()}
`);
    return;
  }

  if (args.command === 'run-fixture') {
    const fixturePath = args.positional[0];
    const outDir = args.flags.get('out');

    if (!fixturePath || typeof outDir !== 'string') {
      throw new Error('Usage: wp-block-compiler run-fixture <fixture-path> --out <artifact-dir>');
    }

    const result = await runFixture({ fixturePath, outDir });
    process.stdout.write(
      JSON.stringify(
        {
          artifactRoot: result.artifactRoot,
          events: result.events.length,
          files: result.files.length,
        },
        null,
        2
      )
    );
    process.stdout.write('\n');
    return;
  }

  throw new Error(`Unknown command: ${args.command}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 1;
});
