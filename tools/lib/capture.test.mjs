import test from 'node:test';
import assert from 'node:assert/strict';
import { motionFreezeCss, revealNeutralizeCss } from './capture.mjs';

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
