import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CommandLog } from './command-log.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wbdc-cmdlog-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('CommandLog writes verbatim tool and claude entries', () => {
    const file = path.join(dir, 'commands.log');
    const cl = new CommandLog(file);

    const toolLine = cl.tool('build_page', { workspaceRoot: '/ws', page: 'index' });
    assert.match(toolLine, /tool build_page/);

    const claudeLine = cl.claude({
        id: 'author:index', attempt: 1,
        argv: ['-p', '--output-format', 'json', '--allowedTools', '', '--append-system-prompt', 'be terse'],
        prompt: 'author the tree',
    });
    assert.match(claudeLine, /\$ claude -p …/);
    cl.result('author:index', { ok: true, costUsd: 0.12, elapsedMs: 42000 });

    const text = fs.readFileSync(file, 'utf8');
    // Verbatim: the tool name + full args, and the full claude argv + stdin prompt.
    assert.match(text, /TOOL build_page/);
    assert.match(text, /"page": "index"/);
    assert.match(text, /\$ claude -p --output-format json/);
    assert.match(text, /--append-system-prompt 'be terse'/); // empty allowedTools quoted, arg preserved
    assert.match(text, /author the tree/);
    assert.match(text, /result author:index: ok · \$0\.1200/);
});

test('CommandLog disabled when file is null', () => {
    const cl = new CommandLog(null);
    assert.doesNotThrow(() => cl.tool('x', {}));
    assert.equal(cl.enabled, false);
});
