'use strict';
/**
 * Normalise a provider tool_call into the small shape the policy engine checks.
 * Harnesses name their tools differently (OpenCode, Cline, Aider, VS Code chat),
 * so we classify by name family first and fall back to inspecting arguments.
 */

const path = require('node:path');

const READ_TOOLS = new Set(['read', 'readfile', 'read_file', 'view', 'cat', 'open', 'list', 'ls',
  'glob', 'grep', 'search', 'codesearch', 'find', 'list_dir', 'listdirectory']);
const WRITE_TOOLS = new Set(['write', 'writefile', 'write_file', 'edit', 'str_replace', 'patch',
  'apply_patch', 'create', 'createfile', 'multiedit', 'notebookedit']);
const EXEC_TOOLS = new Set(['bash', 'shell', 'sh', 'exec', 'run', 'run_command', 'terminal',
  'execute_command', 'powershell', 'cmd']);
const NET_TOOLS = new Set(['webfetch', 'web_fetch', 'fetch', 'http', 'httprequest', 'browser',
  'websearch', 'web_search', 'curl', 'download']);

const PATH_KEYS = ['path', 'file_path', 'filePath', 'filename', 'file', 'target', 'dir',
  'directory', 'notebook_path', 'pattern', 'glob'];
const CMD_KEYS = ['command', 'cmd', 'script', 'input', 'code'];
const URL_KEYS = ['url', 'uri', 'endpoint', 'href'];
const MOVE_TOOLS = new Set(['move', 'rename', 'move_file', 'rename_file']);
const MOVE_SOURCE_KEYS = ['source', 'from', 'oldPath', 'old_path'];
const MOVE_DESTINATION_KEYS = ['destination', 'to', 'newPath', 'new_path'];
const MODIFYING_COMMANDS = new Set(['rm', 'mv', 'cp', 'touch', 'mkdir', 'sed', 'tee', 'chmod', 'chown', 'truncate']);
const INLINE_PROGRAM_FLAGS = new Map([
  ['python', new Set(['-c'])],
  ['python3', new Set(['-c'])],
  ['node', new Set(['-e', '--eval'])],
  ['ruby', new Set(['-e'])],
  ['perl', new Set(['-e'])],
  ['php', new Set(['-r'])],
  ['powershell', new Set(['-command', '-c'])],
  ['pwsh', new Set(['-command', '-c'])],
  ['bash', new Set(['-c'])],
  ['sh', new Set(['-c'])],
  ['zsh', new Set(['-c'])],
]);

const URL_RE = /\bhttps?:\/\/[^\s'"`)>\]}]+/gi;
// bare host:port or IP that a command might POST to
const HOSTISH_RE = /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g;

function safeParse(s) {
  if (s == null) return {};
  if (typeof s === 'object') return s;
  try { return JSON.parse(s); } catch { return { _raw: String(s) }; }
}

function collect(obj, keys) {
  const out = [];
  if (!obj || typeof obj !== 'object') return out;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) out.push(v.trim());
    else if (Array.isArray(v)) for (const x of v) if (typeof x === 'string' && x.trim()) out.push(x.trim());
  }
  return out;
}

function pathish(t) {
  if (/^([~/]|\.\.?\/)/.test(t)) return true;
  if (/^[A-Za-z]:[\\/]/.test(t)) return true;
  return t.includes('/') && !t.includes('://');
}

function splitShellCommands(cmd) {
  const out = [];
  let current = '';
  let quote = null;
  let escaped = false;
  const s = String(cmd || '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const next = s[i + 1];
    if (escaped) {
      current += c;
      escaped = false;
      continue;
    }
    if (process.platform !== 'win32' && c === '\\' && quote !== "'") {
      current += c;
      escaped = true;
      continue;
    }
    if ((c === '"' || c === "'") && !quote) {
      quote = c;
      current += c;
      continue;
    }
    if (c === quote) {
      quote = null;
      current += c;
      continue;
    }
    if (!quote && (c === '\n' || c === ';' || c === '|' || (c === '&' && next === '&'))) {
      if (current.trim()) out.push(current.trim());
      current = '';
      if ((c === '|' && next === '|') || (c === '&' && next === '&')) i++;
      continue;
    }
    current += c;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function shellTokens(cmd) {
  const out = [];
  let current = '';
  let quote = null;
  let escaped = false;
  const s = String(cmd || '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escaped) {
      current += c;
      escaped = false;
      continue;
    }
    if (process.platform !== 'win32' && c === '\\' && quote !== "'") {
      escaped = true;
      continue;
    }
    if ((c === '"' || c === "'") && !quote) {
      quote = c;
      continue;
    }
    if (c === quote) {
      quote = null;
      continue;
    }
    if (!quote && /\s/.test(c)) {
      if (current) out.push(current);
      current = '';
      continue;
    }
    if (!quote && c === '>') {
      if (current) out.push(current);
      if (s[i + 1] === '>') {
        out.push('>>');
        i++;
      } else {
        out.push('>');
      }
      current = '';
      continue;
    }
    current += c;
  }
  if (current) out.push(current);
  return out;
}

function commandName(token) {
  return String(token || '').replace(/^.*[\\/]/, '').replace(/^["']/, '').toLowerCase();
}

function commandStart(tokens) {
  let index = 0;
  while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index])) index++;
  return index;
}

function requiresExactApproval(command) {
  return splitShellCommands(command).some((part) => {
    const tokens = shellTokens(part);
    return tokens.some((token, index) => {
      const flags = INLINE_PROGRAM_FLAGS.get(commandName(token));
      return flags
        ? tokens.slice(index + 1).some((candidate) => flags.has(candidate.toLowerCase()))
        : false;
    });
  });
}

function commandBinaries(command) {
  return splitShellCommands(command).flatMap((part) => {
    const tokens = shellTokens(part);
    const start = commandStart(tokens);
    return tokens[start] ? [commandName(tokens[start])] : [];
  });
}

function operandTokens(tokens, start) {
  const out = [];
  for (let i = start; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token || token === '>' || token === '>>' || token === '<') {
      if (token === '>' || token === '>>' || token === '<') i++;
      continue;
    }
    if (token.startsWith('-')) continue;
    if (/^\d+$/.test(token)) continue;
    out.push(token);
  }
  return out;
}

function addRedirectWrites(tokens, writePaths) {
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if ((token === '>' || token === '>>') && tokens[i + 1]) {
      writePaths.push(tokens[i + 1]);
      i++;
    } else {
      const match = token.match(/^\d*>>?(.+)$/);
      if (match && match[1]) writePaths.push(match[1]);
    }
  }
}

function chmodTargets(operands) {
  if (!operands.length) return [];
  if (/^(\d+|[augo]*[=+-][rwxXstugo,]+)$/.test(operands[0])) return operands.slice(1);
  return operands;
}

function chownTargets(operands) {
  if (operands.length < 2) return operands;
  return operands.slice(1);
}

function expandKnownVariables(command, bindings) {
  let output = '';
  let quote = null;
  for (let index = 0; index < command.length; index++) {
    const character = command[index];
    if (character === '\\' && quote !== "'") {
      output += character + (command[++index] || '');
      continue;
    }
    if ((character === '"' || character === "'") && (!quote || character === quote)) quote = quote ? null : character;
    if (character === '$' && quote !== "'") {
      const match = command.slice(index).match(/^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/);
      if (match && bindings.has(match[1] || match[2])) {
        output += bindings.get(match[1] || match[2]);
        index += match[0].length - 1;
        continue;
      }
    }
    output += character;
  }
  return output;
}

function commandEndpoints(command) {
  const readPaths = [];
  const writePaths = [];
  const deletePaths = [];
  const sharedMachineActions = [];
  let environmentDisclosure = false;
  const bindings = new Map();
  for (const part of splitShellCommands(command)) {
    const tokens = shellTokens(expandKnownVariables(part, bindings));
    if (tokens.length && tokens.every((token) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(token))) {
      for (const token of tokens) {
        const [name, value] = [token.slice(0, token.indexOf('=')), token.slice(token.indexOf('=') + 1)];
        if (/^[A-Za-z0-9_./:-]+$/.test(value)) bindings.set(name, value);
        else bindings.delete(name);
      }
      continue;
    }
    let start = commandStart(tokens);
    let binary = commandName(tokens[start]);
    if (binary === 'env') {
      start++;
      while (start < tokens.length) {
        const token = tokens[start];
        if (['-u', '--unset', '-C', '--chdir'].includes(token)) {
          if ((token === '-C' || token === '--chdir') && tokens[start + 1]) readPaths.push(tokens[start + 1]);
          start += 2;
        }
        else if (token.startsWith('--chdir=')) {
          readPaths.push(token.slice('--chdir='.length));
          start++;
        }
        else if (token.startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) start++;
        else break;
      }
      environmentDisclosure ||= start >= tokens.length;
      binary = commandName(tokens[start]);
    }
    environmentDisclosure ||= binary === 'printenv';
    const operands = operandTokens(tokens, start + 1);
    const inlineFlags = INLINE_PROGRAM_FLAGS.get(binary);
    const programArguments = new Set();
    for (let index = start + 1; index < tokens.length; index++) {
      if (inlineFlags?.has(tokens[index])) programArguments.add(tokens[index + 1]);
    }
    if (binary === 'awk') {
      const program = tokens.slice(start + 1).find((token, index, all) => !token.startsWith('-') && all[index - 1] !== '-v' && all[index - 1] !== '-F');
      if (program) programArguments.add(program);
    }
    for (const token of operands) {
      if (programArguments.has(token)) continue;
      if (pathish(token)) readPaths.push(token);
    }
    addRedirectWrites(tokens, writePaths);
    if (binary === 'find') {
      let index = start + 1;
      while (['-H', '-L', '-P'].includes(tokens[index])) index++;
      const roots = [];
      while (index < tokens.length && !/^(?:-|!|\()/.test(tokens[index])) roots.push(tokens[index++]);
      if (!roots.length) roots.push('.');
      readPaths.push(...roots);
      const executesWrite = tokens.some((token, position) => ['-exec', '-execdir', '-ok', '-okdir'].includes(token) && MODIFYING_COMMANDS.has(commandName(tokens[position + 1])));
      if (tokens.includes('-delete') || executesWrite) {
        writePaths.push(...roots);
        deletePaths.push(...roots);
      }
      for (const flag of ['-fprint', '-fprint0', '-fprintf', '-fls']) {
        const position = tokens.indexOf(flag);
        if (position >= 0 && tokens[position + 1]) writePaths.push(tokens[position + 1]);
      }
    }
    if (binary === 'git') {
      let index = start + 1;
      let directory = '.';
      while (index < tokens.length && tokens[index].startsWith('-')) {
        if (tokens[index] === '-C' && tokens[index + 1]) {
          directory = path.isAbsolute(tokens[index + 1]) ? tokens[index + 1] : path.join(directory, tokens[index + 1]);
          readPaths.push(directory);
          index += 2;
        } else if (tokens[index] === '-c') index += 2;
        else index++;
      }
      if (tokens[index] === 'clean') {
        const argumentsAfter = tokens.slice(index + 1);
        const dryRun = argumentsAfter.some((token) => token === '--dry-run' || /^-[^-]*n/.test(token));
        const targets = [];
        for (let position = 0; position < argumentsAfter.length; position++) {
          const token = argumentsAfter[position];
          if (token === '-e' || token === '--exclude') position++;
          else if (!token.startsWith('-')) targets.push(path.isAbsolute(token) ? token : path.join(directory, token));
        }
        if (!targets.length) targets.push(directory);
        readPaths.push(...targets);
        if (!dryRun) {
          writePaths.push(...targets);
          deletePaths.push(...targets);
        }
      }
    }
    if (binary === 'scancel') sharedMachineActions.push(`cancel scheduled jobs: ${part}`);
    if (!MODIFYING_COMMANDS.has(binary)) continue;
    if (binary === 'rm' || binary === 'touch' || binary === 'mkdir' || binary === 'tee' || binary === 'truncate') {
      writePaths.push(...operands);
      if (binary === 'rm') deletePaths.push(...operands);
    } else if (binary === 'mv') {
      if (operands.length > 1) {
        readPaths.push(...operands.slice(0, -1));
        writePaths.push(...operands);
      }
    } else if (binary === 'cp') {
      if (operands.length > 1) {
        readPaths.push(...operands.slice(0, -1));
        writePaths.push(operands[operands.length - 1]);
      }
    } else if (binary === 'chmod') {
      writePaths.push(...chmodTargets(operands));
    } else if (binary === 'chown') {
      writePaths.push(...chownTargets(operands));
    } else if (binary === 'sed') {
      writePaths.push(...operands.filter(pathish));
    }
  }
  return {
    readPaths: [...new Set(readPaths)],
    writePaths: [...new Set(writePaths)],
    deletePaths: [...new Set(deletePaths)],
    environmentDisclosure,
    sharedMachineActions,
  };
}

/** Pull anything that looks like a filesystem path out of a shell command. */
function pathsInCommand(cmd) {
  const out = [];
  for (const part of splitShellCommands(cmd)) {
    const tokens = shellTokens(part);
    for (const t of tokens) {
      if (!t || t.startsWith('-')) continue;
      if (URL_RE.test(t)) { URL_RE.lastIndex = 0; continue; }
      URL_RE.lastIndex = 0;
      if (pathish(t)) out.push(t);
    }
  }
  return out;
}

function urlsIn(text) {
  const s = String(text || '');
  const urls = s.match(URL_RE) || [];
  URL_RE.lastIndex = 0;
  const hosts = s.match(HOSTISH_RE) || [];
  HOSTISH_RE.lastIndex = 0;
  // only treat a bare IP as egress if it appears near a network verb
  const netty = /\b(curl|wget|nc|ncat|netcat|ssh|scp|rsync|ftp|telnet|invoke-webrequest|iwr)\b/i.test(s);
  return urls.concat(netty ? hosts : []);
}

function patchEffects(args) {
  if (typeof args.patchText !== 'string') return { effectError: 'patch needs complete patchText' };
  const lines = args.patchText.replace(/\r\n/g, '\n').split('\n');
  if (lines[0] !== '*** Begin Patch' || lines.at(-1)?.trim() !== '*** End Patch' && lines.at(-2)?.trim() !== '*** End Patch') return { effectError: 'patch envelope is incomplete' };
  const readPaths = [];
  const writePaths = [];
  const deletePaths = [];
  for (const line of lines) {
    const match = line.match(/^\*\*\* (Add File|Update File|Delete File|Move to): (.+)$/);
    if (!match) continue;
    const [, operation, target] = match;
    writePaths.push(target);
    if (operation === 'Update File' || operation === 'Delete File') readPaths.push(target);
    if (operation === 'Delete File') deletePaths.push(target);
  }
  return writePaths.length ? { readPaths, writePaths, deletePaths } : { effectError: 'patch contains no recognized file operations' };
}

/**
 * @returns {{id,name,kind,readPaths,writePaths,command,binary,urls,args,summary}}
 */
function normalise(toolCall) {
  const fn = toolCall.function || {};
  const rawName = String(fn.name || toolCall.name || 'unknown');
  const name = rawName.toLowerCase().replace(/[^a-z_]/g, '');
  const args = safeParse(fn.arguments ?? toolCall.arguments ?? toolCall.input);

  const out = {
    id: toolCall.id || null,
    name: rawName,
    kind: 'other',
    readPaths: [],
    writePaths: [],
    command: null,
    binary: null,
    binaries: [],
    requiresExactApproval: false,
    urls: [],
    args,
    summary: rawName,
  };

  const declaredPaths = collect(args, PATH_KEYS);
  const declaredCmds = collect(args, CMD_KEYS);
  const declaredUrls = collect(args, URL_KEYS);

  if (EXEC_TOOLS.has(name) || (declaredCmds.length && !READ_TOOLS.has(name) && !WRITE_TOOLS.has(name))) {
    out.kind = 'exec';
    out.command = declaredCmds[0] || declaredPaths[0] || '';
    out.binaries = commandBinaries(out.command);
    out.binary = out.binaries[0] || null;
    out.requiresExactApproval = requiresExactApproval(out.command);
    const endpoints = commandEndpoints(out.command);
    out.readPaths = endpoints.readPaths;
    out.writePaths = endpoints.writePaths;
    out.deletePaths = endpoints.deletePaths;
    out.environmentDisclosure = endpoints.environmentDisclosure;
    out.sharedMachineActions = endpoints.sharedMachineActions;
    out.urls = urlsIn(out.command);
    out.summary = truncate(out.command, 70);
  } else if (name === 'patch' || name === 'apply_patch') {
    out.kind = 'write';
    Object.assign(out, patchEffects(args));
  } else if (name === 'worktree_remove') {
    out.kind = 'write';
    if (typeof args.directory !== 'string' || !args.directory.trim()) out.effectError = 'worktree_remove needs its recorded directory';
    else {
      out.readPaths = [args.directory];
      out.writePaths = [args.directory];
      out.deletePaths = [args.directory];
    }
  } else if (name === 'worktree_create') {
    out.kind = 'write';
    out.effectError = 'worktree_create destination depends on project configuration and cannot be verified before this call';
  } else if (name === 'worktree_list') {
    out.kind = 'read';
    out.readPaths = ['.git/worktrees'];
  } else if (MOVE_TOOLS.has(name)) {
    out.kind = 'write';
    out.readPaths = collect(args, MOVE_SOURCE_KEYS);
    out.writePaths = collect(args, MOVE_DESTINATION_KEYS);
    out.summary = `${rawName} ${truncate(out.readPaths[0] || '', 24)} -> ${truncate(out.writePaths[0] || '', 24)}`.trim();
  } else if (WRITE_TOOLS.has(name)) {
    out.kind = 'write';
    out.writePaths = declaredPaths;
    out.readPaths = declaredPaths;
    out.summary = `${rawName} ${truncate(declaredPaths[0] || '', 50)}`.trim();
  } else if (NET_TOOLS.has(name)) {
    out.kind = 'net';
    out.urls = declaredUrls.concat(urlsIn(JSON.stringify(args)));
    out.summary = `${rawName} ${truncate(out.urls[0] || '', 50)}`.trim();
  } else if (READ_TOOLS.has(name)) {
    out.kind = 'read';
    out.readPaths = declaredPaths;
    out.summary = `${rawName} ${truncate(declaredPaths[0] || '', 50)}`.trim();
  } else {
    // Unknown tool: be conservative and inspect everything it declared.
    out.readPaths = declaredPaths;
    out.urls = declaredUrls.concat(urlsIn(JSON.stringify(args)));
    if (declaredCmds.length) { out.kind = 'exec'; out.command = declaredCmds[0]; }
    out.summary = `${rawName} ${truncate(declaredPaths[0] || declaredUrls[0] || '', 40)}`.trim();
  }

  return out;
}

function truncate(s, n) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

const SEARCH_TOOLS = new Set(['grep', 'search', 'codesearch']);

function proposedCall(tool, args) {
  const call = normalise({ id: 'bordercollie', type: 'function', function: { name: tool, arguments: JSON.stringify(args || {}) } });
  const searchedPaths = collect(call.args, ['path', 'directory', 'dir']);
  return {
    tool: call.name,
    args: call.args,
    kind: call.kind,
    summary: call.summary,
    readPaths: SEARCH_TOOLS.has(String(tool).toLowerCase()) ? searchedPaths : call.readPaths,
    writePaths: call.writePaths,
    urls: [...new Set(call.urls)],
    deletePaths: call.deletePaths || [],
    environmentDisclosure: call.environmentDisclosure || false,
    sharedMachineActions: call.sharedMachineActions || [],
    effectError: call.effectError || null,
  };
}

module.exports = { normalise, pathsInCommand, proposedCall, urlsIn, truncate,
  READ_TOOLS, WRITE_TOOLS, EXEC_TOOLS, NET_TOOLS };
