'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventBus, watchInbox } = require('../events');
const { createSession } = require('../guard/lib/session');

const ROOT = path.resolve(__dirname, '..');

async function run(name, test) {
  try {
    await test();
    process.stdout.write(`ok - ${name}\n`);
  } catch (error) {
    process.stderr.write(`not ok - ${name}\n${error.stack || error}\n`);
    process.exitCode = 1;
  }
}

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'border-collie-session-'));
  try {
    await run('a new Pet only receives events appended after it starts', async () => {
      const inboxPath = path.join(tempDir, 'events.jsonl');
      const previous = new EventBus({ inboxPath, runId: 'previous-session' });
      previous.emit({ type: 'action', petState: 'allowed', summary: 'old action' });
      previous.close();

      const received = [];
      const watcher = watchInbox(inboxPath, (event) => received.push(event), { interval: 5 });
      try {
        assert.deepStrictEqual(received, []);
        const current = new EventBus({ inboxPath, runId: 'current-session' });
        current.emit({ type: 'thinking', petState: 'thinking', summary: 'new action' });
        current.close();
        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.deepStrictEqual(received.map((event) => event.runId), ['current-session']);
      } finally {
        watcher.close();
      }
    });

    await run('completed evidence celebrates without magic completion wording', () => {
      fs.writeFileSync(path.join(tempDir, 'output.txt'), 'ready\n');
      const session = createSession({
        workdir: tempDir,
        protocol: {
          task: 'Produce the output',
          done_criteria: [{
            id: 'output',
            describe: 'output exists',
            claim_verbs: ['fixed'],
            claim_mentions: ['output'],
            checks: [{ type: 'file_exists', path: 'output.txt' }],
          }],
        },
      });
      const result = session.handle({ kind: 'assistant', text: 'The requested work is ready.' });
      assert.ok(result.events.some((event) => (
        event.type === 'verdict'
        && event.status === 'pass'
        && event.petState === 'celebrating'
      )));
    });

    await run('a normally completed agent turn celebrates without configured evidence', () => {
      const session = createSession({ workdir: tempDir, protocol: { task: 'Reply to the user' } });
      const result = session.handle({
        kind: 'assistant',
        text: 'Here is the result.',
        completed: true,
      });
      assert.ok(result.events.some((event) => (
        event.type === 'run'
        && event.status === 'finish'
        && event.petState === 'celebrating'
      )));
    });

    await run('the Pet has no persistent log or status counter UI', () => {
      const html = fs.readFileSync(path.join(ROOT, 'pet', 'src', 'index.html'), 'utf8');
      assert.doesNotMatch(html, /class="tray"|class="counts"|id="log"|id="c-(allow|block|verify|reject)"/);
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main();
