'use strict';
const assert = require('node:assert');
const { createSession } = require('../assay/lib/session');

const session = createSession({
  workdir: '/work/project',
  protocol: { read_paths: ['**'], write_paths: ['**'], allow_commands: [] },
});

function move(source, destination) {
  return {
    id: 'move',
    type: 'function',
    function: { name: 'move', arguments: JSON.stringify({ source, destination }) },
  };
}

for (const [source, destination] of [
  ['safe.md', '../other/out.md'],
  ['../other/in.md', 'safe.md'],
  ['../other/in.md', '../other/out.md'],
]) {
  const result = session.handle({ kind: 'permission', action: 'move', toolCall: move(source, destination) });
  assert.ok(result.deny, `${source} to ${destination} must be denied`);
}

console.log('canonical move endpoints passed');
