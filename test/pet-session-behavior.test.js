'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { EventBus } = require('../events');
const { createSession } = require('../guard/lib/session');
const { readLiveEvents } = require('../pet/live-events');

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
    await run('a new Pet cannot receive events from an ended plugin session', async () => {
      const previousPipe = new PassThrough();
      const previous = new EventBus({ sink: (event) => previousPipe.write(JSON.stringify(event) + '\n'), runId: 'previous-session' });
      previous.emit({ type: 'action', petState: 'allowed', summary: 'old action' });
      previous.close();
      previousPipe.end();

      const currentPipe = new PassThrough();
      const received = [];
      const reader = readLiveEvents(currentPipe, (event) => received.push(event), () => {});
      try {
        assert.deepStrictEqual(received, []);
        const current = new EventBus({ sink: (event) => currentPipe.write(JSON.stringify(event) + '\n'), runId: 'current-session' });
        current.emit({ type: 'thinking', petState: 'thinking', summary: 'new action' });
        current.close();
        await new Promise((resolve) => setImmediate(resolve));
        assert.deepStrictEqual(received.map((event) => event.runId), ['current-session']);
      } finally {
        reader.close();
        currentPipe.end();
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
