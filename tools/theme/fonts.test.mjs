import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractGoogleFontsImport, parseFontFaces, fetchThemeFonts } from './fonts.mjs';

const CSS2 = `/* latin */
@font-face { font-family: 'Bodoni Moda'; font-style: italic; font-weight: 400; src: url(https://fonts.gstatic.com/s/a.woff2) format('woff2'); unicode-range: U+0000-00FF; }
@font-face { font-family: 'Archivo'; font-style: normal; font-weight: 300 700; src: url(https://fonts.gstatic.com/s/b.woff2) format('woff2'); }`;

test('extractGoogleFontsImport finds the css2 url', () => {
    const url = extractGoogleFontsImport(`@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@300..700&display=swap');`);
    assert.match(url, /^https:\/\/fonts\.googleapis\.com\/css2\?/);
});

test('parseFontFaces extracts descriptors and urls', () => {
    const faces = parseFontFaces(CSS2);
    assert.equal(faces.length, 2);
    assert.deepEqual(faces[0], { fontFamily: 'Bodoni Moda', fontStyle: 'italic', fontWeight: '400', unicodeRange: 'U+0000-00FF', url: 'https://fonts.gstatic.com/s/a.woff2' });
    assert.equal(faces[1].fontWeight, '300 700');
});

test('fetchThemeFonts downloads files and returns theme.json fontFace entries', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fonts-'));
    const fetchImpl = async (url) => ({
        ok: true,
        text: async () => CSS2,
        arrayBuffer: async () => new TextEncoder().encode(`bin:${url}`).buffer,
    });
    const result = await fetchThemeFonts({
        importUrl: 'https://fonts.googleapis.com/css2?family=X', targetDir: dir, fetchImpl, write: false,
    });
    assert.equal(result.fontFamilies.length, 2);
    const bodoni = result.fontFamilies.find((f) => f.name === 'Bodoni Moda');
    assert.equal(bodoni.fontFace[0].src[0], 'file:./assets/fonts/bodoni-moda-400-italic-0.woff2');
    assert.ok(fs.existsSync(path.join(dir, 'bodoni-moda-400-italic-0.woff2')));
    assert.equal(bodoni.fontFace[0].unicodeRange, 'U+0000-00FF');
});
