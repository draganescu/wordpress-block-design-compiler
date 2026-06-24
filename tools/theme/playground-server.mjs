// tools/theme/playground-server.mjs
// A registry of warm @wp-playground/cli server processes, keyed per
// workspace+slug, held at module scope. The persistent MCP process reuses one
// booted WordPress across repair iterations instead of cold-booting every call.

// Module-scope registry: key -> { proc, port, base, gateToken, hashes, lastUsed }.
// Lives as long as the Node process (the MCP server), so a repair loop's
// successive getOrBoot calls hit the same warm entry.
const registry = new Map();

// In-flight boots, key -> Promise<entry>. The MCP server dispatches messages
// concurrently, so two playground_render calls for the same key can both miss
// the registry; memoizing the boot promise makes the second await the first
// instead of spawning a duplicate CLI on the same port.
const booting = new Map();

// How long the health check waits before giving up on a (possibly wedged)
// warm server and forcing a cold re-boot.
const HEALTH_TIMEOUT_MS = 2000;

// How long stop() waits for a SIGTERM'd process to exit before SIGKILL.
const KILL_TIMEOUT_MS = 5000;

export function makeKey(workspaceRoot, slug) {
    return `${workspaceRoot}::${slug}`;
}

export function getEntry(key) {
    return registry.get(key);
}

export function setHashes(key, hashes) {
    const entry = registry.get(key);
    if (entry) entry.hashes = hashes;
}

export function touch(key) {
    const entry = registry.get(key);
    if (entry) entry.lastUsed = Date.now();
}

// Reuse a warm entry only if its process is still alive (exitCode === null) and
// a quick health probe answers; otherwise boot a fresh one via bootFn. bootFn
// resolves to { proc, port, base, gateToken, hashes }.
export async function getOrBoot(key, bootFn) {
    const existing = registry.get(key);
    if (existing && existing.proc.exitCode === null && (await isHealthy(existing.base))) {
        touch(key);
        return { entry: existing, reused: true };
    }
    // Coalesce concurrent cold boots: the first caller owns the boot promise,
    // the rest await it. The synchronous prefix below (down to booting.set) runs
    // without yielding for a cold key, so a second caller reliably sees it.
    if (booting.has(key)) {
        return { entry: await booting.get(key), reused: false };
    }
    const promise = (async () => {
        const booted = await bootFn();
        const entry = { ...booted, lastUsed: Date.now() };
        registry.set(key, entry);
        return entry;
    })();
    booting.set(key, promise);
    try {
        const entry = await promise;
        return { entry, reused: false };
    } finally {
        booting.delete(key);
    }
}

// Stop the entry's process and drop the key. Returns whether the key existed.
// Awaits the process actually exiting (SIGTERM, then SIGKILL fallback) so a
// caller that reboots on the same machine does not race a still-bound port.
export async function stop(key) {
    const entry = registry.get(key);
    if (!entry) return false;
    registry.delete(key);
    await killProc(entry.proc);
    return true;
}

export async function stopAll() {
    for (const key of [...registry.keys()]) {
        await stop(key);
    }
}

// Synchronous best-effort teardown for the process 'exit' event, where the loop
// cannot await: SIGKILL every warm process inline. Without this, an async loop
// only kills the first entry before the event handler returns (microtasks never
// run on 'exit'), orphaning the rest.
export function stopAllSync() {
    for (const entry of registry.values()) {
        try { signalProc(entry.proc, 'SIGKILL'); } catch { /* already gone */ }
    }
    registry.clear();
}

// Periodically evict entries idle longer than maxIdleMs. The timer is unref'd so
// it never keeps the process alive; the returned function clears it.
export function startReaper(maxIdleMs) {
    const timer = setInterval(() => {
        const cutoff = Date.now() - maxIdleMs;
        for (const [key, entry] of [...registry.entries()]) {
            if (entry.lastUsed < cutoff) stop(key);
        }
    }, maxIdleMs);
    timer.unref?.();
    return () => clearInterval(timer);
}

// A warm server can wedge (e.g. PHP fatal) while the process stays alive; a
// short-timeout fetch distinguishes "reusable" from "must re-boot". redirect
// 'manual' mirrors waitForServer so a 302 home redirect counts as healthy.
async function isHealthy(base) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    try {
        const res = await fetch(base, { redirect: 'manual', signal: controller.signal });
        return res.status < 500;
    } catch {
        return false;
    } finally {
        clearTimeout(timer);
    }
}

// SIGTERM the process, wait for it to exit, SIGKILL if it overstays. Resolves
// only once the process is gone so the port is free for a same-machine reboot.
function killProc(proc) {
    if (!proc || proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve();
    return new Promise((resolve) => {
        let timer;
        proc.once('exit', () => { clearTimeout(timer); resolve(); });
        timer = setTimeout(() => {
            try { signalProc(proc, 'SIGKILL'); } catch { /* already gone */ }
        }, KILL_TIMEOUT_MS);
        timer.unref?.();
        try { signalProc(proc, 'SIGTERM'); } catch { resolve(); }
    });
}

// Signal the whole process group when the child was spawned detached, so the
// real @wp-playground/cli process dies with its npx wrapper; fall back to
// signalling the wrapper alone if the group send fails.
function signalProc(proc, signal) {
    if (proc.pid) {
        try { process.kill(-proc.pid, signal); return; } catch { /* not a group leader */ }
    }
    proc.kill(signal);
}
