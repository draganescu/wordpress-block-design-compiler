import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WP_VERSION } from './playground.mjs';
import {
    DEFAULT_ARTIFACT_BRANCH,
    parseRepoFromRemote,
    defaultAssetName,
    assertAssetName,
    assertBranchName,
    artifactUrl,
    playgroundUrl,
    buildPublishBlueprint,
    parseIndex,
    updateIndex,
    renderArtifactReadme,
} from './playground-publish.mjs';

test('parseRepoFromRemote handles the github remote URL shapes', () => {
    assert.equal(parseRepoFromRemote('git@github.com:owner/repo.git'), 'owner/repo');
    assert.equal(parseRepoFromRemote('git@github.com:owner/repo'), 'owner/repo');
    assert.equal(parseRepoFromRemote('https://github.com/owner/repo.git'), 'owner/repo');
    assert.equal(parseRepoFromRemote('https://github.com/owner/repo'), 'owner/repo');
    assert.equal(parseRepoFromRemote('ssh://git@github.com/owner/repo.git'), 'owner/repo');
});

test('parseRepoFromRemote returns null for non-github remotes (raw URLs would not resolve)', () => {
    assert.equal(parseRepoFromRemote('git@gitlab.com:owner/repo.git'), null);
    assert.equal(parseRepoFromRemote('https://example.com/owner/repo.git'), null);
    assert.equal(parseRepoFromRemote(''), null);
});

test('defaultAssetName stamps slug and UTC time', () => {
    const now = new Date(Date.UTC(2026, 0, 2, 3, 4, 5));
    assert.equal(defaultAssetName('ladyfactory', now), 'ladyfactory-playground-20260102T030405Z.zip');
});

test('assertAssetName accepts safe zip names and rejects the rest', () => {
    assert.doesNotThrow(() => assertAssetName('lady_factory-1.0.zip'));
    assert.throws(() => assertAssetName('no-extension'));
    assert.throws(() => assertAssetName('-leading-dash.zip'));
    assert.throws(() => assertAssetName('has space.zip'));
    assert.throws(() => assertAssetName('path/../escape.zip'));
});

test('assertBranchName accepts simple names and rejects path tricks', () => {
    assert.doesNotThrow(() => assertBranchName(DEFAULT_ARTIFACT_BRANCH));
    assert.throws(() => assertBranchName(''));
    assert.throws(() => assertBranchName('a/b'));
    assert.throws(() => assertBranchName('a..b'));
    assert.throws(() => assertBranchName('-a'));
    assert.throws(() => assertBranchName('a b'));
});

test('artifactUrl and playgroundUrl compose the share link', () => {
    const raw = artifactUrl('owner/repo', 'playground-artifacts', 'site.zip');
    assert.equal(raw, 'https://raw.githubusercontent.com/owner/repo/playground-artifacts/site.zip');
    assert.equal(playgroundUrl(raw), `https://playground.wordpress.net/?blueprint-url=${encodeURIComponent(raw)}`);
});

test('buildPublishBlueprint stages the bundle and replays the serve activation steps', () => {
    const bp = buildPublishBlueprint({
        slug: 'ladyfactory',
        siteTitle: 'LadyFactory',
        hasBlocksPlugin: true,
        contentModel: { slug: 'lady-cpts', prefix: 'lady_cpts' },
    });

    assert.equal(bp.landingPage, '/');
    assert.equal(bp.login, true);
    assert.equal(bp.preferredVersions.wp, WP_VERSION);

    const steps = bp.steps;
    assert.deepEqual(steps[0], { step: 'setSiteOptions', options: { blogname: 'LadyFactory' } });
    assert.deepEqual(steps[1], { step: 'mkdir', path: '/wordpress/wp-content/wbdc-bundle' });
    assert.deepEqual(steps[2], {
        step: 'unzip',
        zipFile: { resource: 'bundled', path: '/site.zip' },
        extractToPath: '/wordpress/wp-content/wbdc-bundle',
    });
    assert.deepEqual(steps[3], {
        step: 'mv',
        fromPath: '/wordpress/wp-content/wbdc-bundle/theme/ladyfactory',
        toPath: '/wordpress/wp-content/themes/ladyfactory',
    });
    // One mv per shipped plugin, in activation order: content-model, blocks, content.
    const moved = steps.filter((s) => s.step === 'mv' && s.toPath.startsWith('/wordpress/wp-content/plugins/'))
        .map((s) => s.toPath.split('/').pop());
    assert.deepEqual(moved, ['lady-cpts', 'ladyfactory-blocks', 'ladyfactory-content']);

    // The activation/import tail is exactly the serve blueprint's step list.
    const activated = steps.filter((s) => s.step === 'activatePlugin').map((s) => s.pluginPath);
    assert.deepEqual(activated, ['lady-cpts/lady-cpts.php', 'ladyfactory-blocks/ladyfactory-blocks.php', 'ladyfactory-content/ladyfactory-content.php']);
    assert.deepEqual(steps.filter((s) => s.step === 'activateTheme'), [{ step: 'activateTheme', themeFolderName: 'ladyfactory' }]);
    const php = steps.filter((s) => s.step === 'runPHP').map((s) => s.code);
    assert.equal(php.length, 2);
    assert.match(php[0], /lady_cpts_import_seed_content\(\)/);
    assert.match(php[1], /ladyfactory_content_import_pages\(\)/);
});

test('buildPublishBlueprint without extras ships only theme + content plugin', () => {
    const bp = buildPublishBlueprint({ slug: 'lady', siteTitle: 'Lady', hasBlocksPlugin: false, contentModel: null });
    const moved = bp.steps.filter((s) => s.step === 'mv' && s.toPath.startsWith('/wordpress/wp-content/plugins/'))
        .map((s) => s.toPath.split('/').pop());
    assert.deepEqual(moved, ['lady-content']);
    const activated = bp.steps.filter((s) => s.step === 'activatePlugin').map((s) => s.pluginPath);
    assert.deepEqual(activated, ['lady-content/lady-content.php']);
    assert.equal(bp.steps.filter((s) => s.step === 'runPHP').length, 1);
});

test('parseIndex degrades malformed content to an empty list', () => {
    assert.deepEqual(parseIndex('not json'), []);
    assert.deepEqual(parseIndex('{"an":"object"}'), []);
    assert.deepEqual(parseIndex('[{"asset":"a.zip"}, "junk", 3]'), [{ asset: 'a.zip' }]);
});

test('updateIndex prepends and replaces a same-asset entry', () => {
    const index = [{ asset: 'a.zip', n: 1 }, { asset: 'b.zip' }];
    const next = updateIndex(index, { asset: 'a.zip', n: 2 });
    assert.deepEqual(next, [{ asset: 'a.zip', n: 2 }, { asset: 'b.zip' }]);
    assert.deepEqual(updateIndex([], { asset: 'c.zip' }), [{ asset: 'c.zip' }]);
});

test('renderArtifactReadme renders a table row per entry and escapes pipes', () => {
    const md = renderArtifactReadme([{
        project: 'lady|factory',
        asset: 'lady.zip',
        artifact_url: 'https://raw.example/lady.zip',
        playground_url: 'https://playground.wordpress.net/?blueprint-url=x',
        size_bytes: 2048,
        created_at: '2026-01-02T03:04:05Z',
    }]);
    assert.match(md, /\| Project \| Created \| ZIP \| Playground \| Size \|/);
    assert.match(md, /lady\\\|factory/);
    assert.match(md, /\[lady\.zip\]\(https:\/\/raw\.example\/lady\.zip\)/);
    assert.match(md, /\[Open\]\(https:\/\/playground\.wordpress\.net\/\?blueprint-url=x\)/);
    assert.match(md, /2\.00 KB/);

    assert.match(renderArtifactReadme([]), /_none_/);
});
