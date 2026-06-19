import test from 'node:test';
import assert from 'node:assert/strict';
import { motionFreezeCss, revealNeutralizeCss } from './capture.mjs';

test('motionFreezeCss disables animation/transition/scroll', () => {
    const css = motionFreezeCss();
    assert.match(css, /animation:none!important/);
    assert.match(css, /transition:none!important/);
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
