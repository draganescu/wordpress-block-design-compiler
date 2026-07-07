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
//   SKIPPED  — `shouldRepair` declined to chase this metric (too far from the
//              gate for a repair round to plausibly close the distance).
//
// With `snapshot`/`restore` provided, the loop also keeps the best iteration:
// a repair that made things WORSE never becomes the final state — the
// best-seen artifacts are put back and rebuilt before the loop reports.
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
// shouldRepair(result, iter) -> boolean — false ends the loop as 'skipped'
// snapshot() -> opaque state capturing the artifacts the last build measured
// restore(state) -> put those artifacts back (enables keep-best)
export async function runBoundedLoop({
    maxIters = 6,
    plateauDelta = 0.3,
    build,
    repair,
    shouldRepair = null,
    snapshot = null,
    restore = null,
    log = () => {},
}) {
    const metrics = [];
    let last = null;
    let best = null; // { metric, state } — best non-passing build seen so far

    // Keep-best: when the loop ends on a metric worse than the best iteration,
    // restore the best artifacts and rebuild so the workspace, the report, and
    // the on-disk render artifacts all describe the same (best) state.
    const finish = async (status, iter, result, extra = {}) => {
        // A threw final build means the last repair left broken artifacts —
        // always restore then, regardless of the carried-over metric.
        if (restore && best && result && (result.threw || best.metric < result.metric)) {
            log(`keep-best: restoring iteration with metric=${best.metric} (final was ${result.metric})`);
            try {
                await restore(best.state);
                const rebuilt = await build(iter);
                return {
                    status: rebuilt.passed ? 'passed' : status,
                    iters: iter, metric: rebuilt.metric, report: rebuilt.report, restored: true, ...extra,
                };
            } catch (err) {
                log(`keep-best restore failed: ${err.message}`);
            }
        }
        return { status, iters: iter, metric: result?.metric, report: result?.report, ...extra };
    };

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
        if (snapshot && !result.threw && (best === null || result.metric < best.metric)) {
            try { best = { metric: result.metric, state: await snapshot() }; }
            catch (err) { log(`snapshot failed: ${err.message}`); }
        }
        if (iter === maxIters) {
            return finish('capped', iter, result);
        }
        if (isPlateau(metrics, plateauDelta)) {
            return finish('plateau', iter, result);
        }
        if (shouldRepair && !shouldRepair(result, iter)) {
            log(`repair skipped: metric=${result.metric} too far from the gate`);
            return finish('skipped', iter, result, { error: 'repair skipped (metric too far from the gate to chase)' });
        }

        let applied;
        try {
            applied = await repair(result.report, iter);
        } catch (err) {
            log(`repair iteration ${iter} threw: ${err.message}`);
            return finish('blocked', iter, result, { error: err.message });
        }
        if (!applied) {
            return finish('blocked', iter, result, { error: 'repair step produced no usable fix' });
        }
    }

    return finish('capped', maxIters, last);
}

export default runBoundedLoop;
