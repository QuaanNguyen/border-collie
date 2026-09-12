'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Protocol, deriveDefault } = require('./policy');
const { policyConflicts, resolvePolicy } = require('./policy-resolution');

function protocolPath(workdir) {
  return path.join(workdir, '.opencode', 'protocol.json');
}

function fingerprint(contents) {
  return crypto.createHash('sha256').update(contents).digest('hex');
}

function readProjectProtocol(workdir) {
  const file = protocolPath(workdir);
  if (!fs.existsSync(file)) {
    return { file, fingerprint: fingerprint('missing'), protocol: null, error: null };
  }
  let contents;
  try {
    contents = fs.readFileSync(file, 'utf8');
  } catch (error) {
    return { file, fingerprint: fingerprint(`read-error:${error.message}`), protocol: null, error };
  }
  try {
    const protocol = JSON.parse(contents);
    if (!protocol || Array.isArray(protocol) || typeof protocol !== 'object') {
      throw new Error('project policy must be a JSON object');
    }
    return { file, fingerprint: fingerprint(contents), protocol, error: null };
  } catch (error) {
    return { file, fingerprint: fingerprint(contents), protocol: null, error };
  }
}

function createLiveProtocol(opts = {}) {
  const workdir = opts.workdir || process.cwd();
  const owner = opts.owner || null;
  const ownerTrustedWorkspaceRoots = opts.ownerTrustedWorkspaceRoots || [];
  let lastFingerprint = null;
  let revision = 0;
  let current = null;

  function refresh() {
    const source = readProjectProtocol(workdir);
    if (source.fingerprint === lastFingerprint && current) {
      return { ...current, changed: false };
    }
    lastFingerprint = source.fingerprint;

    if (source.error) {
      current = {
        valid: false,
        revision,
        fingerprint: source.fingerprint,
        protocol: null,
        file: source.file,
        reason: `project Protocol is malformed: ${source.error.message}`,
      };
      return { ...current, changed: true };
    }

    const conflicts = policyConflicts(owner || {}, source.protocol, ownerTrustedWorkspaceRoots);
    if (conflicts.length) {
      current = {
        valid: false,
        revision,
        fingerprint: source.fingerprint,
        protocol: null,
        file: source.file,
        reason: `project Protocol attempts to broaden owner policy for ${conflicts.map((conflict) => conflict.field).join(', ')}`,
        conflicts,
      };
      return { ...current, changed: true };
    }

    const resolved = resolvePolicy(owner, source.protocol);
    const protocol = resolved ? new Protocol(resolved, workdir) : deriveDefault(null, workdir);
    revision += 1;
    current = {
      valid: true,
      revision,
      fingerprint: source.fingerprint,
      protocol,
      file: source.file,
      reason: null,
      conflicts: [],
    };
    return { ...current, changed: true };
  }

  return { refresh, protocolPath: protocolPath(workdir) };
}

module.exports = { createLiveProtocol, protocolPath, readProjectProtocol };
