'use strict';

const MINIMUM_OPENCODE_VERSION = '2.0.30';

function assertOpenCodeVersion(value) {
  const version = typeof value === 'string' ? value.trim() : '';
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:\+[^\s]+)?$/.exec(version);
  const supported = match && (Number(match[1]) > 2 || Number(match[1]) === 2 && (Number(match[2]) > 0 || Number(match[3]) >= 30));
  if (supported) return version;
  const remedy = /^v?1\./.test(version)
    ? 'Run opencode upgrade --major to move from OpenCode 1.x to V2.'
    : 'Upgrade OpenCode before installing or loading bordercollie.';
  throw new Error(`bordercollie requires OpenCode ${MINIMUM_OPENCODE_VERSION} or newer. Found: ${version || 'unknown'}. ${remedy}`);
}

module.exports = { MINIMUM_OPENCODE_VERSION, assertOpenCodeVersion };
