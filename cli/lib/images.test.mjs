// --with-images: placeholder extraction, prompt composition, and the
// workspace generation pass — all offline (the Gemini client is injected).

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractImageSpecs, buildImagePrompt, generateWorkspaceImages } from './images.mjs';
import { Semaphore } from './semaphore.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wbdc-images-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('extractImageSpecs parses the placeholder contract and ignores everything else', () => {
    const html = `
        <img src="images/hero-dog-neon.jpg" alt="A bulldog under neon light" data-image-prompt="bulldog on a leash, neon-lit Berlin street at night" data-image-aspect="16:9">
        <img src='images/plate.png' alt='Ceramic plate' data-image-aspect="1:1">
        <img src="images/hero-dog-neon.jpg" alt="duplicate — deduped">
        <img src="https://example.com/remote.jpg" alt="remote — ignored">
        <img src="logo.svg" alt="not under images/ — ignored">
        <img src="images/bad aspect.jpg" alt="space in name — ignored">
        <img src="images/fallback.jpg" alt="Only alt text here">
    `;
    const specs = extractImageSpecs(html);
    assert.deepEqual(specs.map((s) => s.src), ['images/hero-dog-neon.jpg', 'images/plate.png', 'images/fallback.jpg']);
    assert.equal(specs[0].prompt, 'bulldog on a leash, neon-lit Berlin street at night');
    assert.equal(specs[0].aspect, '16:9');
    assert.equal(specs[1].aspect, '1:1');
    // No data-image-prompt: the alt is the prompt; no aspect: 16:9 default.
    assert.equal(specs[2].prompt, 'Only alt text here');
    assert.equal(specs[2].aspect, '16:9');
});

test('buildImagePrompt appends shared art direction and hard constraints', () => {
    const p = buildImagePrompt(
        { prompt: 'bulldog on a leash', alt: 'x' },
        { artDirection: 'grainy 35mm film, high contrast', mood: 'nocturnal neon' },
    );
    assert.match(p, /^bulldog on a leash\. Style: grainy 35mm film/);
    assert.match(p, /Mood: nocturnal neon/);
    assert.match(p, /No text, no watermarks/);
});

test('generateWorkspaceImages writes each unique file where the placeholder expects it', async () => {
    const workspaceRoot = path.join(tmp, 'ws');
    fs.mkdirSync(path.join(workspaceRoot, 'mockup'), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, 'mockup/index.html'),
        '<img src="images/hero.jpg" alt="Hero" data-image-prompt="a hero photo">'
        + '<img src="images/shared.jpg" alt="Shared">');
    fs.writeFileSync(path.join(workspaceRoot, 'mockup/about.html'),
        '<img src="images/shared.jpg" alt="Shared again">'
        + '<img src="images/broken.jpg" alt="This one fails">');

    const calls = [];
    const ctx = {
        workspaceRoot,
        images: {
            model: 'fake-model',
            generate: async (prompt, aspect) => {
                calls.push({ prompt, aspect });
                if (prompt.startsWith('This one fails')) throw new Error('quota');
                return { data: Buffer.from('jpegbytes'), mimeType: 'image/jpeg', ms: 5 };
            },
        },
        imageSemaphore: new Semaphore(2),
        imageLog: [],
        shared: { imageArt: { mood: 'warm' } },
        log: { ok: () => {}, warn: () => {}, info: () => {} },
    };

    await generateWorkspaceImages(ctx, ['mockup/index.html']);
    await generateWorkspaceImages(ctx, ['mockup/about.html']);

    // shared.jpg generated ONCE across pages; broken.jpg failed without throwing.
    assert.equal(calls.length, 3);
    assert.ok(fs.existsSync(path.join(workspaceRoot, 'mockup/images/hero.jpg')));
    assert.ok(fs.existsSync(path.join(workspaceRoot, 'mockup/images/shared.jpg')));
    assert.ok(!fs.existsSync(path.join(workspaceRoot, 'mockup/images/broken.jpg')));
    // Copies land beside the rendered/editor surfaces for relative resolution.
    assert.ok(fs.existsSync(path.join(workspaceRoot, 'rendered/images/hero.jpg')));
    assert.ok(fs.existsSync(path.join(workspaceRoot, 'editor/images/hero.jpg')));
    // The pass records what happened for timings.json.
    assert.equal(ctx.imageLog.filter((e) => e.ok).length, 2);
    assert.equal(ctx.imageLog.filter((e) => !e.ok).length, 1);
});

test('generateWorkspaceImages is a no-op without an image client', async () => {
    const out = await generateWorkspaceImages({ images: null, shared: {} }, ['mockup/index.html']);
    assert.deepEqual(out, []);
});
