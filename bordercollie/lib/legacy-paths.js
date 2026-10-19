'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const LEGACY_DIRECTORY = '.border-collie';
const LEGACY_PLUGIN_DIRECTORY = 'border-collie';
const LEGACY_PLUGIN_ENTRY = 'border-collie.js';

function existingDirectory(canonical, legacy) {
  return !fs.existsSync(canonical) && fs.existsSync(legacy) ? legacy : canonical;
}

function migratePaths(opts = {}) {
  const home = opts.home || os.homedir();
  const workdir = opts.workdir || process.cwd();
  const pairs = [
    [path.join(workdir, LEGACY_DIRECTORY), path.join(workdir, '.bordercollie')],
    [path.join(home, '.config', LEGACY_PLUGIN_DIRECTORY), path.join(home, '.config', 'bordercollie')],
    [path.join(home, '.config', 'opencode', LEGACY_PLUGIN_DIRECTORY), path.join(home, '.config', 'opencode', 'bordercollie')],
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

module.exports = { LEGACY_DIRECTORY, LEGACY_PLUGIN_DIRECTORY, LEGACY_PLUGIN_ENTRY, existingDirectory, migratePaths };
