// Full Stage-1 pipeline wiring, no LLM and no network: a MockHarness replays the
// known-good fixture-theme block trees as its author output, the editor surface
// is skipped (its scripts are remote), and thresholds are relaxed so build_page
// passes on the first iteration. This proves the order (setup -> analyze -> plan
// -> author -> build -> report), the foundation+fan-out, and the run report.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getHarness } from './harness/index.mjs';
import { runPipeline } from './pipeline.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(ROOT, 'tools/profile/fixture-theme');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wbdc-pipe-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function readTree(page) {
    return JSON.parse(fs.readFileSync(path.join(FIXTURE, `wordpress/pages/${page}.block-tree.json`), 'utf8'));
}

test('stage 1 runs foundation + fan-out with a mock harness and reports both pages passed', async () => {
    const workspace = path.join(tmp, 'run');
    fs.mkdirSync(workspace, { recursive: true });
    // Pre-seed the real custom block so the plan can declare zero custom blocks
    // and the author trees still serialize.
    fs.cpSync(path.join(FIXTURE, 'wordpress/blocks'), path.join(workspace, 'wordpress/blocks'), { recursive: true });

    const css = fs.readFileSync(path.join(FIXTURE, 'wordpress/style.css'), 'utf8');
    const harness = getHarness('mock', {
        responses: {
            'plan:': { sections: [] },
            'author:home': { blockTree: readTree('home'), pageCss: css },
            'author:about': { blockTree: readTree('about'), pageCss: css },
        },
    });

    const options = {
        harness: 'mock', model: undefined, concurrency: 2, maxRepair: 6,
        thresholds: { mismatch: 100, height: 100000 },
        stages: new Set([1]), stage0: 'off', playground: false, compareEditor: false,
        verbose: false, install: false,
    };

    const report = await runPipeline({
        workspaceRoot: workspace,
        brief: 'fixture theme',
        source: path.join(FIXTURE, 'mockup/home.html'),
        options,
        harness,
    });

    assert.equal(report.outcome.pagesTotal, 2);
    assert.equal(report.outcome.pagesPassed, 2);
    assert.equal(report.outcome.allPassed, true);
    assert.equal(report.outcome.complete, true);

    // The author step wrote per-page trees; the run report landed.
    assert.ok(fs.existsSync(path.join(workspace, 'wordpress/pages/home.block-tree.json')));
    assert.ok(fs.existsSync(path.join(workspace, 'wordpress/pages/about.block-tree.json')));
    assert.ok(fs.existsSync(path.join(workspace, 'reports/run-report.json')));

    // Both author judgment calls happened (foundation + fan-out).
    const authored = harness.log.filter((c) => c.id.startsWith('author:')).map((c) => c.id).sort();
    assert.deepEqual(authored, ['author:about', 'author:home']);
});
