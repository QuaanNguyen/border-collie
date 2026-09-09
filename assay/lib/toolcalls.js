'use strict';
/**
 * Normalise a provider tool_call into the small shape the policy engine checks.
 * Harnesses name their tools differently (OpenCode, Cline, Aider, VS Code chat),
 * so we classify by name family first and fall back to inspecting arguments.
 */

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
    if (c === '\\' && quote !== "'") {
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
    if (c === '\\' && quote !== "'") {
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

function commandEndpoints(command) {
  const readPaths = [];
  const writePaths = [];
  for (const part of splitShellCommands(command)) {
    const tokens = shellTokens(part);
    const start = commandStart(tokens);
    const binary = commandName(tokens[start]);
    const operands = operandTokens(tokens, start + 1);
    for (const token of operands) {
      if (pathish(token)) readPaths.push(token);
    }
    addRedirectWrites(tokens, writePaths);
    if (!MODIFYING_COMMANDS.has(binary)) continue;
    if (binary === 'rm' || binary === 'touch' || binary === 'mkdir' || binary === 'tee' || binary === 'truncate') {
      writePaths.push(...operands);
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
    const tokens = shellTokens(splitShellCommands(out.command)[0] || '');
    out.binary = commandName(tokens[commandStart(tokens)]);
    const endpoints = commandEndpoints(out.command);
    out.readPaths = endpoints.readPaths;
    out.writePaths = endpoints.writePaths;
    out.urls = urlsIn(out.command);
    out.summary = truncate(out.command, 70);
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

module.exports = { normalise, pathsInCommand, urlsIn, truncate,
  READ_TOOLS, WRITE_TOOLS, EXEC_TOOLS, NET_TOOLS };
