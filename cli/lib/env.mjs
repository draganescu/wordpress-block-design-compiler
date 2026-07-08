// .env support: API keys (GEMINI_API_KEY, ...) can live in a .env file instead
// of the shell profile. Node's built-in process.loadEnvFile does the parsing
// and merges per-key with the real environment winning — a variable exported
// in the shell is never overridden by the file. First candidate found wins:
// the directory the CLI is invoked from, then the package root (so a checkout
// keeps its keys next to the code no matter where you run wbdc from).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function loadDotEnv(candidates = [path.resolve(process.cwd(), '.env'), path.join(PACKAGE_ROOT, '.env')]) {
    for (const candidate of new Set(candidates)) {
        if (!fs.existsSync(candidate)) continue;
        process.loadEnvFile(candidate);
        return candidate;
    }
    return null;
}
