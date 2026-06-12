import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateBlockTheme } from './validate.mjs';
import { scaffoldBlockTheme } from './scaffold.mjs';
import { miniScaffoldArgs, cleanupMini } from './fixtures/mini/scaffold-args.mjs';
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
// Own workspace copy: node --test runs test files in parallel processes, and
// scaffold.test.mjs cleans up fixtures/mini outputs while this file is running.
const MINI = path.join(FIXTURES, 'mini-validate');

function scaffoldMini() {
    fs.rmSync(MINI, { recursive: true, force: true }); // a failed previous run can leave mutated output behind
    fs.cpSync(path.join(FIXTURES, 'mini/wordpress'), path.join(MINI, 'wordpress'), { recursive: true });
    scaffoldBlockTheme(miniScaffoldArgs(MINI));
}

test('validateBlockTheme passes a freshly scaffolded mini theme', () => {
    scaffoldMini();
    const report = validateBlockTheme({ workspaceRoot: MINI, slug: 'mini', write: false });
    assert.deepEqual(report.errors, []);
    assert.equal(report.passed, true);
});

test('validateBlockTheme catches violations', () => {
    scaffoldMini();
    const theme = path.join(MINI, 'theme/mini');
    fs.writeFileSync(path.join(theme, 'parts/orphan.html'), '<!-- wp:not-a-real/block /-->');
    fs.appendFileSync(path.join(theme, 'style.css'), '\n.x{background:url(https://cdn.example.com/x.png)}');
    fs.rmSync(path.join(theme, 'templates/index.html'));
    const report = validateBlockTheme({ workspaceRoot: MINI, slug: 'mini', write: false });
    assert.equal(report.passed, false);
    assert.ok(report.errors.some((e) => e.includes('templates/index.html')));
    assert.ok(report.errors.some((e) => e.includes('not-a-real/block')));
    assert.ok(report.errors.some((e) => e.includes('remote url')));
    cleanupMini(MINI);
    fs.rmSync(MINI, { recursive: true, force: true });
});
