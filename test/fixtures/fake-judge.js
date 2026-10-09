'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { platformKey } = require('../../guard/lib/judge-artifacts');

function artifact(file, published) {
  const bytes = fs.readFileSync(file);
  return {
    path: path.basename(published),
    url: pathToFileURL(file).href,
    size: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}

function fakeJudgeManifest(dir, opts = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const runner = path.join(dir, 'needle');
  const weights = path.join(dir, 'needle3.cact');
  fs.writeFileSync(runner, '#!/bin/sh\nexit 0\n');
  fs.writeFileSync(weights, 'fake weights\n');
  const manifest = {
    revision: 'test-revision',
    weights: artifact(weights, 'needle3.cact'),
    runners: { [opts.platform || platformKey()]: artifact(runner, 'needle') },
  };
  if (opts.tamper) fs.writeFileSync(weights, 'tampered weights\n');
  const file = path.join(dir, 'manifest.json');
  fs.writeFileSync(file, JSON.stringify(manifest));
  return { manifest, file };
}

module.exports = { fakeJudgeManifest };
