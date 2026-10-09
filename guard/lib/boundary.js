'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PREFERENCE_RELATIVE_PATH, RETIRED_PROTOCOL_RELATIVE_PATHS } = require('./preference');

const SUBAGENT_TOOLS = new Set(['task', 'subagent']);
const DIRECT_WRITE_TOOLS = new Set(['delete', 'remove', 'move', 'rename', 'chmod', 'chown']);
const DIRECT_WRITE_KEYS = ['path', 'filePath', 'file_path', 'target', 'source', 'destination', 'from', 'to'];
const WORKING_DIRECTORY_KEYS = ['workdir', 'cwd'];
const PROTECTED_RELATIVE_PATHS = [path.posix.dirname(PREFERENCE_RELATIVE_PATH), ...RETIRED_PROTOCOL_RELATIVE_PATHS];
const CASE_INSENSITIVE = process.platform === 'darwin' || process.platform === 'win32';
const STANDARD_STREAMS = new Set(['/dev/null', '/dev/stdin', '/dev/stdout', '/dev/stderr', 'nul']);

function toPosix(value) {
  return String(value).replace(/\\/g, '/');
}

function stringValues(args, keys) {
  return keys.map((key) => args?.[key]).filter((value) => typeof value === 'string' && value.trim());
}

function staticPrefix(raw) {
  const segments = raw.split('/');
  const magic = segments.findIndex((segment) => /[*?[\]{}]/.test(segment));
  return magic < 0 ? raw : segments.slice(0, magic).join('/');
}

function realPathOf(candidate) {
  let current = candidate;
  const rest = [];
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return candidate;
    rest.unshift(path.basename(current));
    current = parent;
  }
  try {
    return path.join(fs.realpathSync.native(current), ...rest);
  } catch {
    return candidate;
  }
}

function comparable(value) {
  return CASE_INSENSITIVE ? value.toLowerCase() : value;
}

function relativeInside(root, target) {
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  return toPosix(relative);
}

function locate(value, workdir) {
  const raw = toPosix(String(value).trim().replace(/^["']|["']$/g, ''));
  if (raw.includes('\0')) return null;
  const expanded = staticPrefix(raw).replace(/^~(?=\/|$)/, toPosix(os.homedir())) || '.';
  const lexical = path.resolve(workdir, expanded);
  const root = realPathOf(path.resolve(workdir));
  const lexicalRelative = relativeInside(path.resolve(workdir), lexical);
  const realRelative = relativeInside(root, realPathOf(lexical));
  if (lexicalRelative === null || realRelative === null) return null;
  return comparable(realRelative);
}

function touchesPreference(relative) {
  return PROTECTED_RELATIVE_PATHS.some((protectedPath) => {
    const target = comparable(protectedPath);
    return relative === '' || relative === target || target.startsWith(`${relative}/`) || relative.startsWith(`${target}/`);
  });
}

function boundaryDecision({ call, workdir }) {
  const tool = String(call.tool).toLowerCase();
  if (SUBAGENT_TOOLS.has(tool)) {
    return {
      rule: 'subagent_dispatch',
      reason: 'a child session cannot carry the folder Preference',
      alternative: 'Do this work in the current session.',
    };
  }
  const filesystemPaths = (values) => values.filter((value) => !STANDARD_STREAMS.has(String(value).trim().toLowerCase()));
  const writes = filesystemPaths([...call.writePaths, ...(DIRECT_WRITE_TOOLS.has(tool) ? stringValues(call.args, DIRECT_WRITE_KEYS) : [])]);
  const reads = filesystemPaths([...call.readPaths, ...stringValues(call.args, WORKING_DIRECTORY_KEYS)]);
  for (const value of [...reads, ...writes]) {
    if (locate(value, workdir) === null) {
      return {
        rule: 'project_folder',
        reason: `${value} is outside the project folder`,
        alternative: `Use a path inside the project folder: ${workdir}`,
      };
    }
  }
  for (const value of writes) {
    if (touchesPreference(locate(value, workdir))) {
      return {
        rule: 'preference',
        reason: `${value} would change the folder Preference`,
        alternative: 'Read the Preference without changing it; only the owner edits it.',
      };
    }
  }
  return null;
}

module.exports = { boundaryDecision };
