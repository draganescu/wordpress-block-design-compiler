// `wbdc publish` — package a finished run as a WordPress Playground bundle and
// push it to a dedicated artifact branch on GitHub, printing a
// playground.wordpress.net link anyone can open. The bundle boots the same
// site `wbdc serve` does: theme + shipped plugins + imported pages.
//
// Artifacts live on a branch (raw.githubusercontent.com), not GitHub Releases,
// because Playground fetches the ZIP from the browser and the release CDN
// sends no CORS headers.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { detectSlug } from './serve.mjs';
import { resolveContentModelPlugin } from '../tools/theme/playground.mjs';
import {
    DEFAULT_ARTIFACT_BRANCH,
    parseRepoFromRemote,
    defaultAssetName,
    assertAssetName,
    assertBranchName,
    artifactUrl,
    playgroundUrl,
    bundlePluginNames,
    buildPublishBlueprint,
    parseIndex,
    updateIndex,
    renderArtifactReadme,
    formatBytes,
} from '../tools/theme/playground-publish.mjs';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Commits on the artifact branch are authored by the tool, not whoever ran it;
// the push still goes over the runner's own git credentials.
const GIT_IDENTITY = ['-c', 'user.name=wbdc', '-c', 'user.email=wbdc@users.noreply.github.com'];

export async function runPublish({ workspaceRoot, slug, repo, branch = DEFAULT_ARTIFACT_BRANCH, name, out, dryRun = false, clobber = false, log }) {
    assertBranchName(branch);

    workspaceRoot = path.resolve(workspaceRoot);
    if (!fs.existsSync(workspaceRoot)) throw new Error(`Workspace not found: ${workspaceRoot} (check the --workspace path).`);
    slug = slug || detectSlug(workspaceRoot);
    if (!slug) throw new Error(`No built theme in ${workspaceRoot}/theme — run the pipeline (Stage 2) before publishing.`);

    const themeDir = path.join(workspaceRoot, 'theme', slug);
    if (!fs.existsSync(path.join(themeDir, 'theme.json'))) throw new Error(`theme/${slug}/theme.json not found in ${workspaceRoot}.`);
    const contentDir = path.join(workspaceRoot, 'theme-plugin', `${slug}-content`);
    if (!fs.existsSync(contentDir)) throw new Error(`theme-plugin/${slug}-content not found — the bundle needs the content plugin to import pages.`);
    const blocksDir = path.join(workspaceRoot, 'theme-plugin', `${slug}-blocks`);
    const hasBlocksPlugin = fs.existsSync(blocksDir);
    const contentModel = resolveContentModelPlugin(workspaceRoot);

    const assetName = name || defaultAssetName(slug);
    assertAssetName(assetName);
    const bundlePath = out ? path.resolve(out) : path.join(workspaceRoot, 'reports/publish', assetName);

    log?.step(`publish · packaging "${slug}" for WordPress Playground`);
    buildBundle({ workspaceRoot, slug, themeDir, contentDir, blocksDir, hasBlocksPlugin, contentModel, bundlePath });
    const size = formatBytes(fs.statSync(bundlePath).size);
    log?.info(`bundle: ${bundlePath} (${size})`);
    log?.info(`includes: blueprint.json, site.zip (theme/${slug} + plugins: ${bundlePluginNames({ slug, hasBlocksPlugin, contentModel }).join(', ')})`);

    if (dryRun) {
        log?.ok('dry run: not uploading to GitHub');
        return { bundle: bundlePath, assetName };
    }

    const { repoName, pushUrl } = resolveRepo(repo);
    log?.step(`publish · uploading to ${repoName}@${branch}`);
    publishToBranch({ pushUrl, repoName, branch, bundlePath, assetName, slug, clobber });

    const artifact = artifactUrl(repoName, branch, assetName);
    const playground = playgroundUrl(artifact);
    log?.ok('published');
    log?.info(`artifact:   ${artifact}`);
    log?.info(`playground: ${playground}`);
    return { bundle: bundlePath, assetName, artifactUrl: artifact, playgroundUrl: playground };
}

// Site title priority: the content manifest knows the site's name; the theme
// header is the fallback; the slug never renders unless both are missing.
function resolveSiteTitle({ slug, themeDir, contentDir }) {
    try {
        const manifest = JSON.parse(fs.readFileSync(path.join(contentDir, 'content/manifest.json'), 'utf8'));
        if (manifest.siteTitle) return String(manifest.siteTitle);
    } catch { /* fall through */ }
    const style = fs.readFileSync(path.join(themeDir, 'style.css'), 'utf8');
    const m = /Theme Name:\s*(.+)/.exec(style);
    return m ? m[1].trim() : slug;
}

function buildBundle({ workspaceRoot, slug, themeDir, contentDir, blocksDir, hasBlocksPlugin, contentModel, bundlePath }) {
    assertTool('zip');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wbdc-publish-'));
    try {
        // site.zip layout mirrors the blueprint's mv steps exactly.
        const siteDir = path.join(tmp, 'site');
        fs.cpSync(themeDir, path.join(siteDir, 'theme', slug), { recursive: true });
        fs.cpSync(contentDir, path.join(siteDir, 'plugins', `${slug}-content`), { recursive: true });
        if (hasBlocksPlugin) fs.cpSync(blocksDir, path.join(siteDir, 'plugins', `${slug}-blocks`), { recursive: true });
        // Copied under the content-model plugin's slug (not its on-disk dirname)
        // so the activatePlugin path always matches.
        if (contentModel) fs.cpSync(contentModel.dir, path.join(siteDir, 'plugins', contentModel.slug), { recursive: true });

        const stageDir = path.join(tmp, 'bundle');
        fs.mkdirSync(stageDir, { recursive: true });
        const siteTitle = resolveSiteTitle({ slug, themeDir, contentDir });
        const blueprint = buildPublishBlueprint({ slug, siteTitle, hasBlocksPlugin, contentModel });
        fs.writeFileSync(path.join(stageDir, 'blueprint.json'), JSON.stringify(blueprint, null, 2) + '\n');
        run('zip', ['-qr', path.join(stageDir, 'site.zip'), '.'], siteDir);

        fs.mkdirSync(path.dirname(bundlePath), { recursive: true });
        fs.rmSync(bundlePath, { force: true });
        run('zip', ['-qr', bundlePath, '.'], stageDir);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
    if (!fs.existsSync(bundlePath)) throw new Error(`Packaging finished without creating ${bundlePath}`);
}

// The artifact branch lives on the wbdc checkout's own origin unless --repo
// overrides it; either way the raw URL needs a github.com OWNER/REPO.
function resolveRepo(repoFlag) {
    if (repoFlag) {
        if (!/^[^/\s]+\/[^/\s]+$/.test(repoFlag)) throw new Error('--repo must be OWNER/REPO.');
        return { repoName: repoFlag, pushUrl: `git@github.com:${repoFlag}.git` };
    }
    const remote = run('git', ['-C', PLUGIN_ROOT, 'remote', 'get-url', 'origin']).trim();
    const repoName = parseRepoFromRemote(remote);
    if (!repoName) throw new Error(`origin (${remote || 'none'}) is not a github.com remote — pass --repo=OWNER/REPO. Playground can only fetch artifacts from raw.githubusercontent.com.`);
    return { repoName, pushUrl: remote };
}

function publishToBranch({ pushUrl, repoName, branch, bundlePath, assetName, slug, clobber }) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wbdc-publish-git-'));
    try {
        const git = (...args) => run('git', ['-C', tmp, ...args]);
        git('init', '-q');
        git('remote', 'add', 'origin', pushUrl);

        const head = spawnSync('git', ['-C', tmp, 'ls-remote', '--exit-code', '--heads', 'origin', `refs/heads/${branch}`], { encoding: 'utf8' });
        const branchExists = head.status === 0;
        if (branchExists) {
            // Sparse + blobless: pull only the index/README plus a possible
            // same-named asset, never the whole artifact history.
            git('config', 'core.sparseCheckout', 'true');
            fs.writeFileSync(path.join(tmp, '.git/info/sparse-checkout'), `README.md\nindex.json\n${assetName}\n`);
            git('fetch', '-q', '--depth=1', '--filter=blob:none', 'origin', `refs/heads/${branch}`);
            git('checkout', '-q', '-B', branch, 'FETCH_HEAD');
            const existing = spawnSync('git', ['-C', tmp, 'ls-tree', '-r', '--name-only', 'HEAD', '--', assetName], { encoding: 'utf8' });
            if (existing.status === 0 && existing.stdout.trim() !== '' && !clobber) {
                throw new Error(`Artifact ${assetName} already exists on ${branch}. Use --clobber or --name=<other.zip>.`);
            }
        } else {
            git('checkout', '-q', '--orphan', branch);
        }

        fs.copyFileSync(bundlePath, path.join(tmp, assetName));
        const indexPath = path.join(tmp, 'index.json');
        const index = updateIndex(fs.existsSync(indexPath) ? parseIndex(fs.readFileSync(indexPath, 'utf8')) : [], {
            project: slug,
            asset: assetName,
            artifact_url: artifactUrl(repoName, branch, assetName),
            playground_url: playgroundUrl(artifactUrl(repoName, branch, assetName)),
            size_bytes: fs.statSync(bundlePath).size,
            created_at: new Date().toISOString(),
        });
        fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n');
        fs.writeFileSync(path.join(tmp, 'README.md'), renderArtifactReadme(index));

        git('add', 'README.md', 'index.json', assetName);
        git(...GIT_IDENTITY, 'commit', '-q', '-m', `Add Playground artifact ${assetName}`);
        git('push', '-q', 'origin', `HEAD:refs/heads/${branch}`);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

function run(cmd, args, cwd) {
    const res = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
    if (res.error) throw new Error(`${cmd} failed: ${res.error.message}`);
    if (res.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${res.status}):\n${res.stderr || res.stdout}`);
    return res.stdout;
}

function assertTool(bin) {
    const res = spawnSync(bin, ['-v'], { encoding: 'utf8' });
    if (res.error) throw new Error(`${bin} is required to build Playground bundles.`);
}

export default runPublish;
