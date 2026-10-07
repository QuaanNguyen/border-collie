'use strict';
const assert = require('node:assert');
const { createSession } = require('../../guard/lib/session');

async function main() {
  const session = createSession({ workdir: '/work/project', judge: async () => ({ verdict: 'allow' }) });

  for (const [source, destination] of [
    ['safe.md', '../other/out.md'],
    ['../other/in.md', 'safe.md'],
    ['../other/in.md', '../other/out.md'],
  ]) {
    const result = await session.propose({ tool: 'move', args: { source, destination } });
    assert.equal(result.decision, 'disallow', `${source} to ${destination} must be denied`);
    assert.equal(result.events.at(-1).rule, 'project_folder');
  }

  const inside = await session.propose({ tool: 'move', args: { source: 'safe.md', destination: 'docs/safe.md' } });
  assert.equal(inside.decision, 'allow');

  console.log('canonical move endpoints passed');
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
