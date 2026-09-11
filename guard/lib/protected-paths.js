'use strict';
const { globToRe, relToWorkdir } = require('./policy');
const { normalise } = require('./toolcalls');

const DIRECT_WRITE_TOOLS = new Set(['delete', 'remove', 'move', 'rename', 'chmod', 'chown']);

function matches(paths, value, workdir) {
  const { rel, escapes } = relToWorkdir(value, workdir);
  if (escapes) return false;
  return paths.some((pattern) => globToRe(pattern).test(rel));
}

function directWritePaths(tool, args) {
  if (!DIRECT_WRITE_TOOLS.has(String(tool).toLowerCase())) return [];
  return ['path', 'filePath', 'file_path', 'target', 'source', 'destination', 'from', 'to']
    .map((key) => args?.[key])
    .filter((value) => typeof value === 'string' && value.trim());
}

function protectedPathDecision(tool, args, policy, workdir) {
  const call = normalise({ id: 'border-collie', type: 'function', function: { name: tool, arguments: JSON.stringify(args || {}) } });
  const protectedPaths = policy?.protected_paths || [];
  const readProtectedPaths = policy?.read_protected_paths || [];
  const writes = [...call.writePaths, ...directWritePaths(tool, args)];
  if (writes.some((value) => matches(protectedPaths, value, workdir) || matches(readProtectedPaths, value, workdir))) {
    return { rule: 'protected_paths', reason: 'the requested change targets a protected path' };
  }
  if (call.readPaths.some((value) => matches(readProtectedPaths, value, workdir))) {
    return { rule: 'read_protected_paths', reason: 'the requested inspection targets a read-protected path' };
  }
  return null;
}

module.exports = { protectedPathDecision };
