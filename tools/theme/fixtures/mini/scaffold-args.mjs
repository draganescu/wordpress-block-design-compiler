// tools/theme/fixtures/mini/scaffold-args.mjs — shared scaffold args + cleanup for mini-fixture tests.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MINI_DIR = path.dirname(fileURLToPath(import.meta.url));

export function miniScaffoldArgs(workspaceRoot = MINI_DIR) {
    return {
        workspaceRoot, slug: 'mini', name: 'Mini', description: 'Test theme',
        tokenMap: { colors: { '#112233': 'brand' }, fontSizes: {}, spacing: { 'clamp(10px,2vh,20px)': '30' }, custom: { '--pad': 'pad' } },
        themeSettings: {
            color: { palette: [{ slug: 'brand', color: '#112233', name: 'Brand' }, { slug: 'paper', color: '#FFEEDD', name: 'Paper' }] },
            spacing: { spacingSizes: [{ slug: '30', size: 'clamp(10px,2vh,20px)', name: 'Section' }] },
            custom: { pad: 'clamp(10px,2vh,20px)' },
        },
        themeStyles: { color: { background: 'var(--wp--preset--color--paper)' } },
        fontFamilies: [{ name: 'Georgia', slug: 'georgia', fontFamily: 'Georgia, serif', fontFace: [] }],
        customCss: '.topbar { position: fixed; top: 0; padding: var(--pad); }',
        parts: [
            { slug: 'topbar', area: 'header', tagName: 'header', source: { page: 'home', index: 0 } },
            { slug: 'sitefoot', area: 'footer', tagName: 'footer', source: { page: 'home', index: 2 } },
        ],
        templates: { index: [
            { type: 'part', slug: 'topbar', tagName: 'header' },
            { type: 'post-content' },
            { type: 'part', slug: 'sitefoot', tagName: 'footer' },
        ] },
        pages: [
            { page: 'home', slug: 'home', title: 'Home', front: true, template: '', stripIndexes: [0, 2] },
            { page: 'about', slug: 'about', title: 'About', front: false, template: '', stripIndexes: [0, 2] },
        ],
        mediaMap: {},
    };
}

export function cleanupMini(workspaceRoot = MINI_DIR) {
    fs.rmSync(path.join(workspaceRoot, 'theme'), { recursive: true, force: true });
    fs.rmSync(path.join(workspaceRoot, 'theme-plugin'), { recursive: true, force: true });
}
