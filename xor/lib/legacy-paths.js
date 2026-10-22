'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const LEGACY_DIRECTORY = '.bordercollie';
const LEGACY_PLUGIN_DIRECTORY = 'bordercollie';
const LEGACY_PLUGIN_ENTRY = 'bordercollie.js';
const OLDER_LEGACY_DIRECTORY = '.border-collie';
const OLDER_LEGACY_PLUGIN_DIRECTORY = 'border-collie';
const OLDER_LEGACY_PLUGIN_ENTRY = 'border-collie.js';

function existingDirectory(canonical, ...fallbacks) {
  if (fs.existsSync(canonical)) return canonical;
  for (const fallback of fallbacks) {
    if (fallback && fs.existsSync(fallback)) return fallback;
  }
  return canonical;
}

function migratePaths(opts = {}) {
  const home = opts.home || os.homedir();
  const workdir = opts.workdir || process.cwd();
  const pairs = [
    [path.join(workdir, LEGACY_DIRECTORY), path.join(workdir, '.xor')],
    [path.join(workdir, OLDER_LEGACY_DIRECTORY), path.join(workdir, '.xor')],
    [path.join(home, '.config', LEGACY_PLUGIN_DIRECTORY), path.join(home, '.config', 'xor')],
    [path.join(home, '.config', OLDER_LEGACY_PLUGIN_DIRECTORY), path.join(home, '.config', 'xor')],
    [path.join(home, '.config', 'opencode', LEGACY_PLUGIN_DIRECTORY), path.join(home, '.config', 'opencode', 'xor')],
    [path.join(home, '.config', 'opencode', OLDER_LEGACY_PLUGIN_DIRECTORY), path.join(home, '.config', 'opencode', 'xor')],
  ].filter(([source]) => fs.existsSync(source));
  for (const [source, destination] of pairs) {
    if (fs.existsSync(destination)) throw new Error(`Both ${source} and ${destination} exist. Resolve them before migration. Nothing was changed.`);
  }
  const moved = [];
  try {
    for (const [source, destination] of pairs) {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.renameSync(source, destination);
      moved.push({ source, destination });
    }
  } catch (error) {
    for (const { source, destination } of moved.reverse()) fs.renameSync(destination, source);
    throw error;
  }
  return { moved };
}

module.exports = {
  LEGACY_DIRECTORY,
  LEGACY_PLUGIN_DIRECTORY,
  LEGACY_PLUGIN_ENTRY,
  OLDER_LEGACY_DIRECTORY,
  OLDER_LEGACY_PLUGIN_DIRECTORY,
  OLDER_LEGACY_PLUGIN_ENTRY,
  existingDirectory,
  migratePaths,
};
