import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { McpToolClient } from './tool-client.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wbdc-tc-test-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('McpToolClient handshakes, calls tools, and propagates errors', async () => {
    const client = new McpToolClient({ onLog: () => {} });
    await client.start();
    try {
        const created = await client.call('create_workspace', { workspaceRoot: tmp, prompt: 'tool client test', force: true });
        assert.ok(created.workspaceRoot);
        assert.ok(fs.existsSync(path.join(tmp, 'mockup/index.html')));

        const analyzed = await client.call('analyze_mockup', { workspaceRoot: tmp });
        assert.equal(analyzed.page, 'index');
        assert.equal(typeof analyzed.selectors, 'number');

        await assert.rejects(() => client.call('nonexistent_tool', {}), /Unknown tool/);
    } finally {
        await client.close();
    }
});
