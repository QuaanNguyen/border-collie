'use strict';

const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { globToRe } = require('./policy');

function gitBuffer(workdir, args) {
  try {
    return execFileSync('git', args, {
      cwd: workdir,
      encoding: 'buffer',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

function gitText(workdir, args) {
  const output = gitBuffer(workdir, args);
  return output === null ? null : output.toString('utf8');
}

function nulList(output) {
  if (!output) return [];
  return output.toString('utf8').split('\0').filter(Boolean);
}

function fileDigest(file) {
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch {
    return null;
  }
  if (stat.isSymbolicLink()) {
    return `symlink:${fs.readlinkSync(file)}`;
  }
  if (!stat.isFile()) return `other:${stat.mode}`;
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function fileDigests(workdir, files) {
  const result = {};
  for (const relative of files) {
    const digest = fileDigest(path.join(workdir, relative));
    if (digest !== null) result[relative] = digest;
  }
  return result;
}

function stateDigest(state) {
  const values = [
    state.head || '',
    state.branch || '',
    state.stagedDiff || '',
    state.unstagedDiff || '',
    ...state.untracked,
    ...state.ignored,
    ...Object.keys(state.files).sort().map((file) => `${file}\0${state.files[file]}`),
  ];
  return crypto.createHash('sha256').update(values.join('\n')).digest('hex');
}

function captureRepositoryState(workdir, opts = {}) {
  const head = gitText(workdir, ['rev-parse', 'HEAD']);
  if (head === null) {
    return { available: false, reason: 'no Git repository is available' };
  }
  const branch = gitText(workdir, ['branch', '--show-current']);
  const status = gitBuffer(workdir, ['status', '--porcelain=v1', '-z']);
  const stagedDiff = gitText(workdir, ['diff', '--cached', '--binary']);
  const unstagedDiff = gitText(workdir, ['diff', '--binary']);
  const tracked = nulList(gitBuffer(workdir, ['ls-files', '-z']));
  const untracked = nulList(gitBuffer(workdir, ['ls-files', '--others', '--exclude-standard', '-z']));
  const ignored = nulList(gitBuffer(workdir, ['ls-files', '--ignored', '--others', '--exclude-standard', '-z']));
  const ignoredPatterns = opts.ignoredPatterns || [];
  const relevantIgnored = ignoredPatterns.length ? ignored.filter((file) => matches(ignoredPatterns, file)) : [];
  const state = {
    available: status !== null && stagedDiff !== null && unstagedDiff !== null,
    reason: status === null || stagedDiff === null || unstagedDiff === null ? 'Git state could not be captured' : null,
    head: head.trim(),
    branch: branch === null ? '' : branch.trim(),
    status: status === null ? '' : status.toString('base64'),
    stagedDiff: stagedDiff || '',
    unstagedDiff: unstagedDiff || '',
    tracked,
    untracked,
    ignored,
    files: fileDigests(workdir, [...new Set([...tracked, ...untracked, ...relevantIgnored])]),
  };
  state.digest = stateDigest(state);
  return state;
}

function changedPaths(before, after) {
  const paths = new Set([...Object.keys(before.files), ...Object.keys(after.files)]);
  for (const file of before.ignored) if (!after.ignored.includes(file)) paths.add(file);
  for (const file of after.ignored) if (!before.ignored.includes(file)) paths.add(file);
  return [...paths].filter((file) => before.files[file] !== after.files[file]
    || before.ignored.includes(file) !== after.ignored.includes(file)).sort();
}

function matches(patterns, file) {
  return patterns.some((pattern) => globToRe(pattern).test(file));
}

function evaluateRepositoryState(check, before, after) {
  if (!before?.available || !after?.available) {
    return {
      id: check.id || check.type,
      type: check.type,
      pass: false,
      where: [],
      evidence: before?.reason || after?.reason || 'Git state is unavailable',
    };
  }
  const changes = changedPaths(before, after);
  const allowedPaths = check.allowed_paths || [];
  const forbiddenPaths = check.forbidden_paths || [];
  const violations = new Set();
  const reasons = [];
  if (check.require_base_commit === true && before.head !== after.head) {
    reasons.push(`base commit changed from ${before.head} to ${after.head}`);
  }
  if (check.require_worktree_diff === true
    && before.stagedDiff === after.stagedDiff
    && before.unstagedDiff === after.unstagedDiff) {
    reasons.push('worktree diff did not change from the session baseline');
  }
  if (check.require_changes === true && changes.length === 0) {
    reasons.push('no changes since the session baseline');
  }
  const outsideAllowed = allowedPaths.length ? changes.filter((file) => !matches(allowedPaths, file)) : [];
  if (outsideAllowed.length) {
    for (const file of outsideAllowed) violations.add(file);
    reasons.push(`changes outside allowed paths: ${outsideAllowed.join(', ')}`);
  }
  const forbidden = changes.filter((file) => matches(forbiddenPaths, file));
  if (forbidden.length) {
    for (const file of forbidden) violations.add(file);
    reasons.push(`forbidden changes: ${forbidden.join(', ')}`);
  }
  const newUntracked = after.untracked.filter((file) => !before.untracked.includes(file));
  if (check.allow_untracked === false && newUntracked.length) {
    for (const file of newUntracked) violations.add(file);
    reasons.push(`new untracked files: ${newUntracked.join(', ')}`);
  }
  const newIgnored = after.ignored.filter((file) => !before.ignored.includes(file));
  if (check.allow_ignored === false && newIgnored.length) {
    for (const file of newIgnored) violations.add(file);
    reasons.push(`new ignored files: ${newIgnored.join(', ')}`);
  }
  const where = [...violations].sort();
  const pass = reasons.length === 0;
  return {
    id: check.id || check.type,
    type: check.type,
    pass,
    where,
    evidence: pass
      ? `repository state is compliant across ${changes.length} changed path(s)`
      : reasons.join('; '),
  };
}

module.exports = { captureRepositoryState, evaluateRepositoryState, changedPaths };
