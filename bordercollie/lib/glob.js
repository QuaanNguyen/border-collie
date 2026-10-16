'use strict';

function globToRe(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '/' && glob[i + 1] === '*' && glob[i + 2] === '*') {
      const after = glob[i + 3];
      if (after === undefined) { re += '(?:/.*)?'; i += 2; continue; }
      if (after === '/') { re += '(?:/.*)?/'; i += 3; continue; }
    }
    if (c === '*') {
      if (glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++; }
      else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$');
}

module.exports = { globToRe };
