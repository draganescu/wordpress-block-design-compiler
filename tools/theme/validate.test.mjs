import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateBlockTheme } from './validate.mjs';
import { scaffoldBlockTheme } from './scaffold.mjs';
import { PLUGIN_ROOT } from '../lib/workspace.mjs';
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

test('validateBlockTheme resolves template-part refs with nested attrs and flags missing payloads', () => {
    scaffoldMini();
    const theme = path.join(MINI, 'theme/mini');
    // Nested attr objects: a regex stopping at the first "}" would truncate the
    // JSON and crash instead of producing a report.
    fs.writeFileSync(path.join(theme, 'templates/page-styled.html'), [
        '<!-- wp:template-part {"slug":"topbar","style":{"spacing":{"margin":{"top":"0"}}}} /-->',
        '<!-- wp:post-content {"layout":{"type":"default"}} /-->',
        '<!-- wp:template-part {"slug":"missing-part","style":{"spacing":{"margin":{"top":"0"}}}} /-->',
        '',
    ].join('\n'));
    fs.rmSync(path.join(MINI, 'theme-plugin/mini-content/content/about.html'));
    const report = validateBlockTheme({ workspaceRoot: MINI, slug: 'mini', write: false });
    assert.equal(report.passed, false);
    assert.ok(report.errors.some((e) => e.includes('unresolved template-part ref missing-part')));
    assert.ok(!report.errors.some((e) => e.includes('unresolved template-part ref topbar')));
    assert.ok(report.errors.some((e) => e.includes('content payload missing for about')));
});

test('validateBlockTheme works from a checkout path containing spaces', () => {
    scaffoldMini();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wbdc space '));
    try {
        fs.cpSync(path.join(PLUGIN_ROOT, 'tools'), path.join(root, 'tools'), { recursive: true });
        fs.symlinkSync(path.join(PLUGIN_ROOT, 'node_modules'), path.join(root, 'node_modules'));
        const script = [
            `import { validateBlockTheme } from ${JSON.stringify(pathToFileURL(path.join(root, 'tools/theme/validate.mjs')).href)};`,
            `const report = validateBlockTheme({ workspaceRoot: ${JSON.stringify(MINI)}, slug: 'mini', write: false });`,
            'console.log(JSON.stringify(report));',
        ].join('\n');
        const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
        const report = JSON.parse(stdout.trim().split('\n').pop());
        assert.deepEqual(report.errors, []);
        assert.equal(report.passed, true);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
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
