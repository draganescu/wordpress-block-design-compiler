// Bounded repair loop — the deterministic replacement for the agent's
// open-ended "repair until it looks close". The CLI owns the loop; the model
// only produces one fix per iteration. Stops on the FIRST of:
//
//   PASS     — the gate passed.
//   PLATEAU  — the last two iterations each improved the mismatch metric by
//              less than `plateauDelta` (we are at the harness floor).
//   CAP      — `maxIters` builds without a pass.
//   BLOCKED  — a build threw (e.g. serialize error) or a repair failed and
//              could not be applied.
//
// Mirrors skills/html-to-blocks/references/repair-loop.md so the same stopping
// discipline the skill describes is enforced in code, not left to judgment.

export function isPlateau(metrics, plateauDelta) {
    // Need three data points to see two consecutive improvements.
    if (metrics.length < 3) return false;
    const n = metrics.length;
    const improve1 = metrics[n - 2] - metrics[n - 1]; // most recent improvement
    const improve2 = metrics[n - 3] - metrics[n - 2];
    return improve1 < plateauDelta && improve2 < plateauDelta;
}

// build(iter)  -> { passed: bool, metric: number, report: any }  (may throw)
// repair(report, iter) -> boolean applied  (may throw)
export async function runBoundedLoop({
    maxIters = 6,
    plateauDelta = 0.3,
    build,
    repair,
    log = () => {},
}) {
    const metrics = [];
    let last = null;

    for (let iter = 1; iter <= maxIters; iter++) {
        let result;
        try {
            result = await build(iter);
        } catch (err) {
            log(`build iteration ${iter} threw: ${err.message}`);
            // A serialize/render failure IS the drift to repair. Hand the error to
            // the repair step; if there is no prior result, treat it as blocked.
            result = { passed: false, metric: last ? last.metric : 999, report: { error: err.message }, threw: true };
        }
        last = result;
        metrics.push(result.metric);
        log(`iteration ${iter}: metric=${result.metric} passed=${result.passed}`);

        if (result.passed) {
            return { status: 'passed', iters: iter, metric: result.metric, report: result.report };
        }
        if (iter === maxIters) {
            return { status: 'capped', iters: iter, metric: result.metric, report: result.report };
        }
        if (isPlateau(metrics, plateauDelta)) {
            return { status: 'plateau', iters: iter, metric: result.metric, report: result.report };
        }

        let applied;
        try {
            applied = await repair(result.report, iter);
        } catch (err) {
            log(`repair iteration ${iter} threw: ${err.message}`);
            return { status: 'blocked', iters: iter, metric: result.metric, report: result.report, error: err.message };
        }
        if (!applied) {
            return { status: 'blocked', iters: iter, metric: result.metric, report: result.report, error: 'repair step produced no usable fix' };
        }
    }

    return { status: 'capped', iters: maxIters, metric: last?.metric, report: last?.report };
}

export default runBoundedLoop;
