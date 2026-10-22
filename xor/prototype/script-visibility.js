'use strict';

const path = require('node:path');

function substitutionEnd(command, start, backticks) {
  let quote = null;
  let depth = 1;
  for (let index = start; index < command.length; index += 1) {
    const character = command[index];
    if (character === '\\' && quote !== "'") index += 1;
    else if (quote) {
      if (character === quote) quote = null;
    } else if (character === "'" || character === '"') quote = character;
    else if (backticks && character === '`') return index;
    else if (!backticks && character === '(') depth += 1;
    else if (!backticks && character === ')' && --depth === 0) return index;
  }
  return -1;
}

function shellCommands(command) {
  const commands = [];
  const issues = [];
  let words = [];
  let word = '';
  let started = false;
  let quotedWord = false;
  let quote = null;
  let delimiter = null;
  const pending = [];
  const flushWord = () => {
    if (!started) return;
    if (delimiter !== null) {
      pending.push({ text: word, stripTabs: delimiter, quoted: quotedWord });
      delimiter = null;
    } else words.push(word);
    word = '';
    started = false;
    quotedWord = false;
  };
  const flushCommand = () => {
    flushWord();
    if (words.length) commands.push(words);
    words = [];
  };
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (character === '\\' && quote !== "'") {
      if (index + 1 < command.length) {
        index += 1;
        quotedWord = true;
        if (command[index] !== '\n') {
          word += command[index];
          started = true;
        }
      }
    } else if (quote !== "'" && ((character === '$' && command[index + 1] === '(') || character === '`')) {
      const start = index + (character === '`' ? 1 : 2);
      const end = substitutionEnd(command, start, character === '`');
      if (end < 0) return { commands, complete: false, issues: [...issues, 'Unclosed active command substitution'] };
      const nested = shellCommands(command.slice(start, end));
      commands.push(...nested.commands);
      issues.push(...nested.issues);
      if (!nested.complete) issues.push('Unsupported active command substitution');
      word += '$DYNAMIC';
      started = true;
      index = end;
    } else if (quote) {
      if (character === quote) quote = null;
      else word += character;
    } else if (character === "'" || character === '"') {
      quote = character;
      quotedWord = true;
      started = true;
    } else if (character === '#' && !started) {
      const newline = command.indexOf('\n', index);
      index = newline < 0 ? command.length : newline - 1;
    } else if (character === '<' && command[index + 1] === '<') {
      flushWord();
      index += 1;
      delimiter = command[index + 1] === '-';
      if (delimiter) index += 1;
    } else if (character === '<' || character === '>') {
      flushWord();
      words.push(character);
    } else if (';|&()\n'.includes(character)) {
      flushCommand();
      if (character === '\n' && pending.length) {
        for (const document of pending.splice(0)) {
          let matched = false;
          while (index < command.length) {
            const end = command.indexOf('\n', index + 1);
            const line = command.slice(index + 1, end < 0 ? command.length : end);
            index = end < 0 ? command.length : end;
            if (!document.quoted) {
              for (let cursor = 0; cursor < line.length; cursor += 1) {
                if (line[cursor] === '\\') cursor += 1;
                else if (line[cursor] === '`' || line.slice(cursor, cursor + 2) === '$(') issues.push('Active substitution in an unquoted heredoc requires independent visibility review');
              }
            }
            if ((document.stripTabs ? line.replace(/^\t+/, '') : line) === document.text) {
              matched = true;
              break;
            }
          }
          if (!matched) return { commands, complete: false, issues };
        }
      }
    } else if (/\s/.test(character)) flushWord();
    else {
      word += character;
      started = true;
    }
  }
  flushCommand();
  return { commands, complete: !quote && delimiter === null && pending.length === 0, issues };
}

function invokedScripts(command) {
  const parsed = shellCommands(command);
  const scripts = [];
  const unsupported = [...parsed.issues];
  for (const words of parsed.commands) {
    let index = 0;
    while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index] || '')) index += 1;
    const executable = words[index] || '';
    if (/[$`]/.test(executable)) unsupported.push('Dynamic executable requires independent visibility review');
    if (/^(?:if|then|elif|while|until|do|for|case|!)$/.test(executable) && words.slice(index + 1).some((item) => /\.(?:sh|py|js)$/.test(item))) unsupported.push('Unsupported script invocation inside shell control flow');
    if (/^(?:env|sudo|timeout|nice|command|exec|nohup)$/.test(path.posix.basename(executable)) && words.slice(index + 1).some((item) => /\.(?:sh|py|js)$/.test(item))) unsupported.push(`Unsupported script execution wrapper ${executable}`);
    const interpreter = /^(?:bash|sh|python3?|node)$/.test(path.posix.basename(executable));
    if (interpreter && (words[index + 1] || '').startsWith('-') && words.slice(index + 2).some((item) => /\.(?:sh|py|js)(?:\s|$)/.test(item))) unsupported.push(`Unsupported script interpreter options ${executable}`);
    const input = words.indexOf('<', index + 1);
    const candidate = interpreter ? (words[index + 1] === '<' ? words[input + 1] : words[index + 1]) : executable;
    if (interpreter && typeof candidate === 'string' && /[$`]/.test(candidate)) unsupported.push(`Dynamic script path requires independent visibility review ${executable}`);
    if (typeof candidate !== 'string' || !/\.(?:sh|py|js)$/.test(candidate) || /[$`<>\n]/.test(candidate)) continue;
    if (interpreter || candidate.includes('/')) scripts.push(candidate);
  }
  return { paths: [...new Set(scripts)], complete: parsed.complete, unsupported };
}

function scriptBodies(message) {
  const text = message.replace(/\\n/g, '\n');
  const bodies = [];
  const fences = /(^|\n)[ \t]*```([^\n]*)\n([\s\S]*?)\n[ \t]*```/g;
  let match;
  let end = 0;
  while ((match = fences.exec(text))) {
    bodies.push({ prefix: text.slice(end, match.index), contents: match[3], language: match[2].trim() });
    end = fences.lastIndex;
  }
  const remaining = bodies.length ? '' : text;
  const shebang = /(^|\n)[ \t]*(#![^\n]+\n[\s\S]*)/.exec(remaining);
  if (shebang) bodies.push({ prefix: text.slice(0, shebang.index), contents: shebang[2], language: 'shebang' });
  return bodies;
}

function scriptVisibility(command, message) {
  if (typeof command !== 'string' || typeof message !== 'string') return { paths: [], issues: [] };
  const invocation = invokedScripts(command);
  const bodies = scriptBodies(message);
  const issues = [...invocation.unsupported];
  if (invocation.paths.length && !invocation.complete) issues.push('Unsupported or incomplete shell structure around a script invocation');
  for (const script of invocation.paths) {
    const matching = bodies.filter((body) => {
      const names = [...body.prefix.matchAll(/`([^`\n]+\.(?:sh|py|js))`|"([^"\n]+\.(?:sh|py|js))"|'([^'\n]+\.(?:sh|py|js))'|([^\s`"'<>():,]+\.(?:sh|py|js))\b/g)].map((item) => item.slice(1).find(Boolean));
      const name = names.at(-1);
      return name ? (name === script || (!name.includes('/') && name === path.posix.basename(script) && invocation.paths.filter((item) => path.posix.basename(item) === name).length === 1)) : invocation.paths.length === 1 && bodies.length === 1;
    });
    if (matching.length !== 1) {
      issues.push(`Missing or ambiguous visible contents for invoked script ${script}`);
      continue;
    }
    const body = matching[0];
    const executable = body.contents.split('\n').filter((line) => line.trim() && !/^\s*(?:#|\/\/)/.test(line));
    if (!executable.length || (!body.language && !/^\s*#!/.test(body.contents)) || !/^(?:shebang|sh|bash|shell|zsh|python|python3|py|javascript|js|node)?$/.test(body.language) || /(?:^\s*(?:\.{3}|…)\s*$|\b(?:omitted|truncated|redacted|placeholder)\b)/im.test(body.contents)) issues.push(`Missing executable or complete visible contents for invoked script ${script}`);
  }
  return { paths: invocation.paths, issues };
}

module.exports = { scriptVisibility };
