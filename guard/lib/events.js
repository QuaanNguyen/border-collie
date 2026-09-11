'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const SCHEMA_VERSION = 1;

function watchInbox(inboxPath, onEvent, opts = {}) {
  const interval = opts.interval || 200;
  let offset = 0;
  let carry = '';
  const seen = new Set();

  function drain() {
    if (!fs.existsSync(inboxPath)) {
      offset = 0;
      carry = '';
      seen.clear();
      return;
    }
    const stat = fs.statSync(inboxPath);
    if (stat.size < offset) {
      offset = 0;
      carry = '';
      seen.clear();
    }
    if (stat.size === offset) return;
    const fd = fs.openSync(inboxPath, 'r');
    const buf = Buffer.alloc(stat.size - offset);
    fs.readSync(fd, buf, 0, buf.length, offset);
    fs.closeSync(fd);
    offset = stat.size;
    const chunk = carry + buf.toString('utf8');
    const pieces = chunk.split('\n');
    carry = pieces.pop() || '';
    for (const line of pieces) {
      if (!line.trim()) continue;
      let e;
      try { e = JSON.parse(line); } catch { continue; }
      const key = e.runId + ':' + e.seq;
      if (seen.has(key)) continue;
      seen.add(key);
      onEvent(e);
    }
  }

  drain();
  const timer = setInterval(drain, interval);
  return { close() { clearInterval(timer); } };
}

function defaultInboxPath() {
  return path.join(os.homedir(), '.border-collie', 'events.jsonl');
}

class EventBus {
  constructor(opts = {}) {
    this.runId = opts.runId || `run-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`;
    this.seq = 0;
    this.buffer = [];
    this.petState = 'calm';

    this.inboxPath = opts.inboxPath || null;
    if (this.inboxPath) {
      fs.mkdirSync(path.dirname(this.inboxPath), { recursive: true });
      this.inbox = fs.createWriteStream(this.inboxPath, { flags: 'a' });
    }
  }

  emit(evt) {
    const e = {
      v: SCHEMA_VERSION,
      seq: ++this.seq,
      ts: new Date().toISOString(),
      runId: this.runId,
      type: evt.type,
      status: evt.status || 'ok',
      petState: evt.petState || this.petState,
      tool: evt.tool || null,
      summary: evt.summary || '',
      reason: evt.reason || null,
      rule: evt.rule || null,
      detail: evt.detail || {},
    };

    this.petState = e.petState;

    this.buffer.push(e);
    if (this.buffer.length > 500) this.buffer.shift();
    if (this.inbox) this.inbox.write(JSON.stringify(e) + '\n');
    return e;
  }

  state() {
    return {
      runId: this.runId,
      petState: this.petState,
      seq: this.seq,
    };
  }

  close() {
    if (this.inbox) this.inbox.end();
  }
}

module.exports = { EventBus, SCHEMA_VERSION, defaultInboxPath, watchInbox };
