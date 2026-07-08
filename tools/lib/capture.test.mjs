import test from 'node:test';
import assert from 'node:assert/strict';
import { motionFreezeCss, revealNeutralizeCss, settleImages } from './capture.mjs';

// A fake page document: `images` mirrors document.images, querySelectorAll
// answers only the img[loading="lazy"] selector settleImages uses.
function fakeDoc(images) {
    return {
        images,
        querySelectorAll: (sel) => (sel === 'img[loading="lazy"]' ? images.filter((i) => i.loading === 'lazy') : []),
    };
}

function fakeImg({ loading = '', complete = false } = {}) {
    const img = {
        loading,
        complete,
        listeners: {},
        addEventListener(type, fn) { (img.listeners[type] ||= []).push(fn); },
        fire(type) { for (const fn of img.listeners[type] || []) fn(); },
    };
    return img;
}

test('settleImages flips lazy images to eager so a no-scroll capture fetches them', async () => {
    // WordPress marks all but the first content images loading="lazy"; a
    // fullPage screenshot never scrolls, so they capture as blank boxes.
    const lazy = fakeImg({ loading: 'lazy', complete: true });
    const eager = fakeImg({ complete: true });
    await settleImages(50, fakeDoc([eager, lazy]));
    assert.equal(lazy.loading, 'eager');
    assert.equal(eager.loading, '');
});

test('settleImages waits for pending images to load or error', async () => {
    const pending = fakeImg({ loading: 'lazy' });
    const failing = fakeImg();
    const doc = fakeDoc([pending, failing]);
    let settled = false;
    const wait = settleImages(5000, doc).then((n) => { settled = true; return n; });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(settled, false);
    pending.fire('load');
    failing.fire('error');
    assert.equal(await wait, 2);
});

test('settleImages gives up at the cap so a dead image cannot hang the capture', async () => {
    const never = fakeImg({ loading: 'lazy' });
    const n = await settleImages(30, fakeDoc([never]));
    assert.equal(n, 1);
});

test('settleImages resolves immediately when every image is already complete', async () => {
    const n = await settleImages(5000, fakeDoc([fakeImg({ complete: true })]));
    assert.equal(n, 0);
});

test('motionFreezeCss fast-forwards animation and disables transition/scroll', () => {
    const css = motionFreezeCss();
    // Entrance animations are snapped to their final (visible) keyframe instead
    // of being frozen hidden at frame 0.
    assert.match(css, /animation-duration:1ms!important/);
    assert.match(css, /animation-fill-mode:forwards!important/);
    assert.match(css, /transition:none!important/);
    assert.match(css, /scroll-behavior:auto!important/);
});

test('revealNeutralizeCss forces reveal/fade bands and the body fade visible', () => {
    const css = revealNeutralizeCss();
    // The body load-fade is forced opaque.
    assert.match(css, /body\{opacity:1!important\}/);
    // Common scroll-reveal conventions are forced to the post-animation state.
    for (const sel of ['.reveal', '.fade-up', '.animate-on-scroll', '.wow', '[data-aos]', '[data-reveal]']) {
        assert.ok(css.includes(sel), `expected reveal-neutralize to cover ${sel}`);
    }
    assert.match(css, /opacity:1!important/);
    assert.match(css, /transform:none!important/);
    // Scoped to reveal/fade/animate names — genuinely-hidden UI is left alone.
    assert.ok(!css.includes('.modal'));
    assert.ok(!css.includes('.drawer'));
});
