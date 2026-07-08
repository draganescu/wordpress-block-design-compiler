// Image generation for --with-images: mockups carry <img> placeholders
// (src="images/<name>.jpg" + alt + data-image-prompt), and this pass turns
// each unique placeholder into a real file with the exact name the
// placeholder expects. The client wraps Google's Gemini image models (the
// Nano Banana family) the same way sibling project wpforge does: retries with
// backoff and no opinions about the bytes.

import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_IMAGE_MODEL = 'gemini-3.1-flash-lite-image';

const ASPECTS = new Set(['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '3:2', '2:3']);

// Parse the <img> placeholders out of one mockup document. The contract the
// design prompts ask for: src is workspace-relative "images/<kebab>.jpg",
// alt is the accessible text, data-image-prompt describes subject/setting/
// composition (no style words — art direction is appended for every image),
// data-image-aspect is optional.
export function extractImageSpecs(html) {
    const specs = [];
    const seen = new Set();
    for (const tag of String(html || '').match(/<img\b[^>]*>/gi) || []) {
        const attr = (name) => {
            const m = tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
            return m ? (m[1] ?? m[2] ?? '') : '';
        };
        const src = attr('src');
        if (!/^images\/[a-z0-9][a-z0-9._-]*\.(jpe?g|png|webp)$/i.test(src)) continue;
        if (seen.has(src)) continue;
        seen.add(src);
        const aspect = attr('data-image-aspect');
        specs.push({
            src,
            alt: attr('alt'),
            prompt: attr('data-image-prompt') || attr('alt'),
            aspect: ASPECTS.has(aspect) ? aspect : '16:9',
        });
    }
    return specs;
}

// Compose one placeholder's in-context description with the site design's
// art direction so every image on the site shares one look.
export function buildImagePrompt(spec, art = {}) {
    const parts = [String(spec.prompt || spec.alt || '').trim()];
    if (art.artDirection) parts.push(`Style: ${String(art.artDirection).trim()}`);
    if (art.mood) parts.push(`Mood: ${String(art.mood).trim()}`);
    parts.push('Photographic, natural lighting. No text, no watermarks, no logos, no borders.');
    return parts.filter(Boolean).join('. ').replace(/\.\s*\./g, '.');
}

export function createGeminiImageClient({ apiKey, model = DEFAULT_IMAGE_MODEL }) {
    let aiPromise = null;
    const getAi = () => {
        aiPromise ??= import('@google/genai').then(({ GoogleGenAI }) => new GoogleGenAI({ apiKey }));
        return aiPromise;
    };
    return {
        model,
        // Generate one image; retries transient failures, throws after 3 attempts.
        async generate(prompt, aspectRatio = '16:9') {
            const ai = await getAi();
            let lastErr;
            for (let attempt = 1; attempt <= 3; attempt++) {
                const started = Date.now();
                try {
                    const interaction = await ai.interactions.create({
                        model,
                        input: prompt,
                        response_format: {
                            type: 'image',
                            mime_type: 'image/jpeg',
                            aspect_ratio: aspectRatio,
                            image_size: '1K',
                        },
                    });
                    const image = interaction.output_image;
                    if (!image?.data) throw new Error('no image data in response');
                    return { data: Buffer.from(image.data, 'base64'), mimeType: image.mime_type ?? 'image/jpeg', ms: Date.now() - started };
                } catch (err) {
                    lastErr = err;
                    if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * attempt));
                }
            }
            throw new Error(`image generation failed: ${lastErr?.message || lastErr}`);
        },
    };
}

// Generate every image the given mockup files reference and save each under
// mockup/<src> — the path the placeholder expects — plus copies beside the
// rendered/editor surfaces so relative srcs resolve there too. Cross-page
// dedupe: the same src is generated ONCE per run (shared in-flight map), so
// chrome images and repeated subjects cost one call. Per-image failures warn
// and skip — a missing photo must never fail a page.
export async function generateWorkspaceImages(ctx, relHtmlPaths) {
    if (!ctx.images) return [];
    ctx.shared.imageJobs ??= new Map();

    const specs = [];
    for (const rel of relHtmlPaths) {
        const file = path.join(ctx.workspaceRoot, rel);
        if (!fs.existsSync(file)) continue;
        specs.push(...extractImageSpecs(fs.readFileSync(file, 'utf8')));
    }

    const art = ctx.shared.imageArt || {};

    const jobs = [];
    for (const spec of specs) {
        if (!ctx.shared.imageJobs.has(spec.src)) {
            ctx.shared.imageJobs.set(spec.src, ctx.imageSemaphore.run(async () => {
                const started = Date.now();
                try {
                    const result = await ctx.images.generate(buildImagePrompt(spec, art), spec.aspect);
                    const dest = path.join(ctx.workspaceRoot, 'mockup', spec.src);
                    fs.mkdirSync(path.dirname(dest), { recursive: true });
                    fs.writeFileSync(dest, result.data);
                    // The rendered/editor surfaces reference the same relative
                    // src from their own directories.
                    for (const surface of ['rendered', 'editor']) {
                        const copy = path.join(ctx.workspaceRoot, surface, spec.src);
                        fs.mkdirSync(path.dirname(copy), { recursive: true });
                        fs.copyFileSync(dest, copy);
                    }
                    ctx.log.ok(`image ${spec.src} generated (${spec.aspect}, ${((result.ms) / 1000).toFixed(1)}s)`);
                    ctx.imageLog?.push({ src: spec.src, aspect: spec.aspect, ok: true, elapsedMs: Date.now() - started, model: ctx.images.model });
                    return { src: spec.src, ok: true };
                } catch (err) {
                    ctx.log.warn(`image ${spec.src} failed: ${String(err?.message || err).slice(0, 200)}`);
                    ctx.imageLog?.push({ src: spec.src, aspect: spec.aspect, ok: false, elapsedMs: Date.now() - started, error: String(err?.message || err).slice(0, 300) });
                    return { src: spec.src, ok: false };
                }
            }));
        }
        jobs.push(ctx.shared.imageJobs.get(spec.src));
    }
    return Promise.all(jobs);
}
