import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadDotEnv } from './env.mjs';

function tmpEnvFile(content) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wbdc-env-'));
    const file = path.join(dir, '.env');
    fs.writeFileSync(file, content);
    return file;
}

test('loadDotEnv loads keys from the first existing candidate', (t) => {
    t.after(() => { delete process.env.WBDC_TEST_FILE_KEY; });
    const file = tmpEnvFile('WBDC_TEST_FILE_KEY=from-file\n');
    const loaded = loadDotEnv([path.join(os.tmpdir(), 'wbdc-env-does-not-exist/.env'), file]);
    assert.equal(loaded, file, 'returns the file it loaded');
    assert.equal(process.env.WBDC_TEST_FILE_KEY, 'from-file');
});

test('loadDotEnv never overrides the real environment', (t) => {
    t.after(() => { delete process.env.WBDC_TEST_SHELL_KEY; delete process.env.WBDC_TEST_ONLY_IN_FILE; });
    process.env.WBDC_TEST_SHELL_KEY = 'from-shell';
    loadDotEnv([tmpEnvFile('WBDC_TEST_SHELL_KEY=from-file\nWBDC_TEST_ONLY_IN_FILE=filled-in\n')]);
    assert.equal(process.env.WBDC_TEST_SHELL_KEY, 'from-shell', 'shell value wins');
    assert.equal(process.env.WBDC_TEST_ONLY_IN_FILE, 'filled-in', 'missing keys are filled from the file');
});

test('loadDotEnv stops at the first hit — later candidates never load', (t) => {
    t.after(() => { delete process.env.WBDC_TEST_FIRST; delete process.env.WBDC_TEST_SECOND; });
    const first = tmpEnvFile('WBDC_TEST_FIRST=1\n');
    const second = tmpEnvFile('WBDC_TEST_SECOND=1\n');
    const loaded = loadDotEnv([first, second]);
    assert.equal(loaded, first);
    assert.equal(process.env.WBDC_TEST_FIRST, '1');
    assert.equal(process.env.WBDC_TEST_SECOND, undefined);
});

test('loadDotEnv returns null when no candidate exists', () => {
    assert.equal(loadDotEnv([path.join(os.tmpdir(), 'wbdc-env-nope/.env')]), null);
});
