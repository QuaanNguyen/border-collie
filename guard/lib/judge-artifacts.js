'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fileURLToPath } = require('node:url');

const NEEDLE_REPOSITORY = 'https://huggingface.co/Cactus-Compute/needle3/resolve';

const NEEDLE_MANIFEST = Object.freeze({
  revision: '2ae11323dc000f5e70c49f7403efa6af12ba9e67',
  weights: {
    path: 'needle3.cact',
    size: 35335380,
    sha256: 'c9d915eca282ed42d1a09b143b592adb4cc6744ffe2d294adf5cfc5548170c38',
  },
  runners: {
    'darwin-arm64': { path: 'macos-arm64/needle', size: 1089896, sha256: '342fa2c6f140e702354a99c4201c9057535ec908eed35c7382e911a19d1d2724' },
    'linux-x64': { path: 'linux-x86_64/needle', size: 1541680, sha256: 'f38dc4b0345d66b4e385734ad0f12af43ac6e2cfa1752d0795af5c137200c8e4' },
    'linux-arm64': { path: 'linux-arm64/needle', size: 1431816, sha256: '6fc25a97def475e1c7d1933a4a219d4e37076be77974e76dd331d9e0cd97f3cb' },
    'win32-x64': { path: 'windows-x86_64/needle.exe', size: 1563136, sha256: 'e8863ca0c06a47d406777077f1ba728b58e57d77fedff252dbe6827d588acc8c' },
    'win32-arm64': { path: 'windows-arm64/needle.exe', size: 1352704, sha256: '8a333b4829f4a6f230e26ab1998c17ad442a97c650934448db1c63eed91b0cea' },
  },
});

function judgeManifest() {
  const override = process.env.BORDER_COLLIE_JUDGE_MANIFEST;
  if (!override) return NEEDLE_MANIFEST;
  return JSON.parse(fs.readFileSync(override, 'utf8'));
}

function defaultJudgeRoot() {
  if (process.env.BORDER_COLLIE_JUDGE_ROOT) return process.env.BORDER_COLLIE_JUDGE_ROOT;
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'border-collie', 'judge');
  }
  return path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'border-collie', 'judge');
}

function platformKey(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`;
}

function runnerFor(manifest, key = platformKey()) {
  const runner = manifest.runners[key];
  if (!runner) {
    const supported = Object.keys(manifest.runners).join(', ');
    throw new Error(`The Needle Judge has no runner for ${key}. Supported platforms: ${supported}.`);
  }
  return runner;
}

function installedPaths(manifest, root, key = platformKey()) {
  const runner = runnerFor(manifest, key);
  const dir = path.join(root, manifest.revision);
  return {
    dir,
    runner: path.join(dir, path.basename(runner.path)),
    weights: path.join(dir, path.basename(manifest.weights.path)),
  };
}

function sha256File(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.alloc(1024 * 1024);
  try {
    let read;
    while ((read = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, read));
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function matchesArtifact(file, artifact) {
  try {
    return fs.statSync(file).size === artifact.size && sha256File(file) === artifact.sha256;
  } catch {
    return false;
  }
}

function verifyInstalledJudge(manifest = judgeManifest(), root = defaultJudgeRoot(), key = platformKey()) {
  const paths = installedPaths(manifest, root, key);
  const runner = runnerFor(manifest, key);
  if (!matchesArtifact(paths.runner, runner)) return { ready: false, reason: `the Judge runner is missing or does not match its pinned digest at ${paths.runner}`, ...paths };
  if (!matchesArtifact(paths.weights, manifest.weights)) return { ready: false, reason: `the Judge weights are missing or do not match their pinned digest at ${paths.weights}`, ...paths };
  return { ready: true, reason: null, ...paths };
}

function artifactUrl(manifest, artifact) {
  if (artifact.url) return artifact.url;
  return `${NEEDLE_REPOSITORY}/${manifest.revision}/${artifact.path}`;
}

async function download(url, destination) {
  if (url.startsWith('file:')) {
    fs.copyFileSync(fileURLToPath(url), destination);
    return;
  }
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(300000) });
  if (!response.ok) throw new Error(`download of ${url} failed with HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(destination, bytes);
}

async function retrieveArtifact(manifest, artifact, destination) {
  const url = artifactUrl(manifest, artifact);
  await download(url, destination);
  if (!matchesArtifact(destination, artifact)) {
    throw new Error(`${path.basename(artifact.path)} from ${url} does not match its pinned SHA-256 ${artifact.sha256}`);
  }
}

async function retrieveJudge(opts = {}) {
  const manifest = opts.manifest || judgeManifest();
  const root = opts.root || defaultJudgeRoot();
  const key = opts.platformKey || platformKey();
  const runner = runnerFor(manifest, key);
  const existing = verifyInstalledJudge(manifest, root, key);
  if (existing.ready) return { ...existing, reused: true };

  fs.mkdirSync(root, { recursive: true });
  const stage = fs.mkdtempSync(path.join(root, '.stage-'));
  try {
    const stagedRunner = path.join(stage, path.basename(runner.path));
    const stagedWeights = path.join(stage, path.basename(manifest.weights.path));
    await retrieveArtifact(manifest, runner, stagedRunner);
    fs.chmodSync(stagedRunner, 0o755);
    await retrieveArtifact(manifest, manifest.weights, stagedWeights);
    const target = path.join(root, manifest.revision);
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(stage, target);
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
  const installed = verifyInstalledJudge(manifest, root, key);
  if (!installed.ready) throw new Error(installed.reason);
  return { ...installed, reused: false };
}

module.exports = {
  NEEDLE_MANIFEST,
  defaultJudgeRoot,
  judgeManifest,
  platformKey,
  retrieveJudge,
  sha256File,
  verifyInstalledJudge,
};
