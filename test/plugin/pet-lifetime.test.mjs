import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { bordercollie } from '../../plugin/bordercollie.js';

test('the backend sends live Pet events without owning a desktop process', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bordercollie-pet-events-'));
  const events = [];
  const previous = process.env.BORDERCOLLIE_NO_PET;
  process.env.BORDERCOLLIE_NO_PET = '1';
  const hooks = await bordercollie({ directory, client: {} }, { petSink: (event) => events.push(event) });
  try {
    await hooks.event({ event: { type: 'session.status', properties: { sessionID: 'one', status: 'busy' } } });
    assert.ok(events.some((event) => event.petState === 'thinking'));
    assert.ok(events.every((event) => event.runId && event.seq > 0));
  } finally {
    hooks.dispose();
    if (previous === undefined) delete process.env.BORDERCOLLIE_NO_PET;
    else process.env.BORDERCOLLIE_NO_PET = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const { startPetCompanion } = await import('../../plugin/tui.mjs');
const { EventEmitter } = await import('node:events');
const { PassThrough } = await import('node:stream');

function terminal(location) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  const received = [];
  child.stdin.on('data', (chunk) => received.push(JSON.parse(chunk.toString())));
  let receive;
  let unsubscribed = 0;
  let launches = 0;
  const context = {
    location,
    client: {
      rpc: () => ({
        events: { on: (name, listener) => {
          assert.equal(name, 'event');
          receive = listener;
          return () => { unsubscribed++; };
        } },
        configuration: async (input, options) => {
          assert.deepEqual(input, {});
          assert.deepEqual(options.location, location);
          assert.ok(options.signal instanceof AbortSignal);
          return { scale: 1.15 };
        },
      }),
    },
  };
  return {
    context, child, received,
    launch: () => { launches++; return child; },
    receive: (event) => receive?.(event),
    unsubscribed: () => unsubscribed,
    launches: () => launches,
  };
}

test('each terminal owns its pipe, filters locations, and closes independently', async () => {
  const previous = process.env.BORDERCOLLIE_NO_PET;
  delete process.env.BORDERCOLLIE_NO_PET;
  const location = { directory: '/workspace/one', workspaceID: 'workspace-one' };
  const first = terminal(location);
  const second = terminal(location);
  const cleanups = [];
  try {
    cleanups.push(await startPetCompanion(first.context, { launch: first.launch }));
    cleanups.push(await startPetCompanion(second.context, { launch: second.launch }));
    assert.equal(first.launches(), 1);
    assert.deepEqual(first.received, [{ type: 'control', detail: { action: 'size', scale: 1.15 } }]);
    const data = { type: 'action', petState: 'allowed', seq: 7 };
    first.receive({ location: { directory: '/workspace/other', workspaceID: 'workspace-one' }, data });
    first.receive({ location: { directory: location.directory, workspaceID: 'workspace-other' }, data });
    assert.equal(first.received.length, 1);
    first.receive({ location, data });
    second.receive({ location, data });
    assert.deepEqual(first.received[1], data);
    cleanups[0]();
    cleanups[0]();
    assert.equal(first.child.stdin.writableEnded, true);
    assert.equal(first.unsubscribed(), 1);
    assert.equal(second.child.stdin.writableEnded, false);
    first.receive({ location, data });
    assert.equal(first.received.length, 2);
    second.receive({ location, data });
    assert.equal(second.received.length, 3);
    second.child.emit('exit');
    assert.equal(second.unsubscribed(), 1);
  } finally {
    for (const cleanup of cleanups) cleanup();
    if (previous === undefined) delete process.env.BORDERCOLLIE_NO_PET;
    else process.env.BORDERCOLLIE_NO_PET = previous;
  }
});

test('a disabled Pet creates no process or subscription', async () => {
  const previous = process.env.BORDERCOLLIE_NO_PET;
  process.env.BORDERCOLLIE_NO_PET = '1';
  const instance = terminal({ directory: '/workspace' });
  try {
    const cleanup = await startPetCompanion(instance.context, { launch: instance.launch });
    cleanup();
    assert.equal(instance.launches(), 0);
    assert.equal(instance.unsubscribed(), 0);
  } finally {
    if (previous === undefined) delete process.env.BORDERCOLLIE_NO_PET;
    else process.env.BORDERCOLLIE_NO_PET = previous;
  }
});
