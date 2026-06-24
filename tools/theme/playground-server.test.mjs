import test from 'node:test';
import assert from 'node:assert/strict';
import { makeKey, getOrBoot, getEntry, setHashes, touch, stop, stopAll, stopAllSync, startReaper } from './playground-server.mjs';

// A fake child process: alive until kill(), which flips exitCode and fires the
// 'exit' listener so stop()'s await-exit path resolves. pid 0 makes signalProc
// fall back to proc.kill() instead of touching a real process group.
function makeFakeProc() {
    let onExit;
    return {
        exitCode: null,
        signalCode: null,
        pid: 0,
        once(event, cb) { if (event === 'exit') onExit = cb; },
        kill() { this.exitCode = 0; this.signalCode = 'SIGTERM'; onExit?.(); },
    };
}

// A fake booted server with no real child process, port, or network.
function makeBootFn() {
    let calls = 0;
    const bootFn = async () => {
        calls += 1;
        return { proc: makeFakeProc(), base: 'http://127.0.0.1:9999', port: 9999, gateToken: 't', hashes: {} };
    };
    bootFn.calls = () => calls;
    return bootFn;
}

test('warm registry reuses one boot, re-boots after stop and on dead proc', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ status: 200 });
    try {
        const key = makeKey('/ws/site', 'mini');
        const bootFn = makeBootFn();

        const first = await getOrBoot(key, bootFn);
        assert.equal(first.reused, false);
        assert.equal(bootFn.calls(), 1);

        const second = await getOrBoot(key, bootFn);
        assert.equal(second.reused, true);
        assert.equal(bootFn.calls(), 1);
        assert.equal(second.entry, first.entry);

        // after stop the key is gone, so the next call boots fresh
        assert.equal(await stop(key), true);
        assert.equal(await stop(key), false);
        const third = await getOrBoot(key, bootFn);
        assert.equal(third.reused, false);
        assert.equal(bootFn.calls(), 2);

        // a dead process (exitCode set) forces a re-boot even with the key present
        third.entry.proc.exitCode = 137;
        const fourth = await getOrBoot(key, bootFn);
        assert.equal(fourth.reused, false);
        assert.equal(bootFn.calls(), 3);

        await stopAll();
        assert.equal(getEntry(key), undefined);
    } finally {
        globalThis.fetch = realFetch;
    }
});

test('concurrent getOrBoot for the same cold key boots exactly once', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ status: 200 });
    try {
        const key = makeKey('/ws/site', 'race');
        let calls = 0;
        const bootFn = async () => {
            calls += 1;
            await new Promise((r) => setTimeout(r, 10));
            return { proc: makeFakeProc(), base: 'http://127.0.0.1:9999', port: 9999, gateToken: 't', hashes: {} };
        };
        const [a, b] = await Promise.all([getOrBoot(key, bootFn), getOrBoot(key, bootFn)]);
        assert.equal(calls, 1);
        assert.equal(a.entry, b.entry);
        await stopAll();
    } finally {
        globalThis.fetch = realFetch;
    }
});

test('stop awaits the process exit before resolving', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ status: 200 });
    try {
        const key = makeKey('/ws/site', 'exiting');
        const bootFn = makeBootFn();
        const { entry } = await getOrBoot(key, bootFn);
        await stop(key);
        assert.notEqual(entry.proc.exitCode, null); // kill() ran and the proc exited
        assert.equal(getEntry(key), undefined);
    } finally {
        globalThis.fetch = realFetch;
    }
});

test('unhealthy warm server (fetch rejects) forces a re-boot', async () => {
    const realFetch = globalThis.fetch;
    let healthy = true;
    globalThis.fetch = async () => {
        if (!healthy) throw new Error('connection refused');
        return { status: 200 };
    };
    try {
        const key = makeKey('/ws/site', 'wedged');
        const bootFn = makeBootFn();
        await getOrBoot(key, bootFn);
        assert.equal(bootFn.calls(), 1);
        healthy = false;
        const again = await getOrBoot(key, bootFn);
        assert.equal(again.reused, false);
        assert.equal(bootFn.calls(), 2);
        await stopAll();
    } finally {
        globalThis.fetch = realFetch;
    }
});

test('stopAllSync kills every registered server inline (no await)', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ status: 200 });
    try {
        const bootFn = makeBootFn();
        const a = await getOrBoot(makeKey('/ws/a', 'mini'), bootFn);
        const b = await getOrBoot(makeKey('/ws/b', 'mini'), bootFn);
        stopAllSync();
        // both procs killed synchronously and the registry is emptied
        assert.notEqual(a.entry.proc.exitCode, null);
        assert.notEqual(b.entry.proc.exitCode, null);
        assert.equal(getEntry(makeKey('/ws/a', 'mini')), undefined);
        assert.equal(getEntry(makeKey('/ws/b', 'mini')), undefined);
    } finally {
        globalThis.fetch = realFetch;
    }
});

test('setHashes and touch mutate the stored entry', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ status: 200 });
    try {
        const key = makeKey('/ws/site', 'hashed');
        const bootFn = makeBootFn();
        const { entry } = await getOrBoot(key, bootFn);
        setHashes(key, { theme: 'abc' });
        assert.deepEqual(getEntry(key).hashes, { theme: 'abc' });
        entry.lastUsed = 0;
        touch(key);
        assert.ok(getEntry(key).lastUsed > 0);
        await stopAll();
    } finally {
        globalThis.fetch = realFetch;
    }
});

test('startReaper stops entries idle past maxIdleMs and clears its interval', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ status: 200 });
    try {
        const key = makeKey('/ws/site', 'idle');
        const bootFn = makeBootFn();
        const { entry } = await getOrBoot(key, bootFn);
        // backdate lastUsed so it is older than maxIdleMs immediately
        entry.lastUsed = Date.now() - 100000;
        const stopReaper = startReaper(5);
        await new Promise((r) => setTimeout(r, 20));
        stopReaper();
        assert.equal(getEntry(key), undefined);
        await stopAll();
    } finally {
        globalThis.fetch = realFetch;
    }
});
