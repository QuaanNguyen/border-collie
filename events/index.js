'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');

const SCHEMA_VERSION = 1;

function watchInbox(inboxPath, onEvent, opts = {}) {
  const interval = opts.interval || 200;
  let offset = Number.isSafeInteger(opts.offset) && opts.offset >= 0 ? opts.offset : 0;
  if (!Number.isSafeInteger(opts.offset)) {
    try { offset = fs.statSync(inboxPath).size; } catch {
    }
  }
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
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      const key = event.runId + ':' + event.seq;
      if (seen.has(key)) continue;
      seen.add(key);
      onEvent(event);
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
    this.runId = opts.runId || `run-${Date.now().toString(36)}-${randomUUID()}`;
    this.seq = 0;
    this.buffer = [];
    this.petState = 'calm';
    this.inboxPath = opts.inboxPath || null;
    this.inboxError = null;
    this.onInboxError = typeof opts.onInboxError === 'function' ? opts.onInboxError : () => {};
    if (this.inboxPath) {
      try {
        fs.mkdirSync(path.dirname(this.inboxPath), { recursive: true });
        this.inbox = fs.openSync(this.inboxPath, 'a');
      } catch (error) {
        this.disableInbox(error);
      }
    }
  }

  disableInbox(error) {
    if (this.inboxError) return;
    this.inboxError = error;
    const inbox = this.inbox;
    this.inbox = null;
    if (inbox != null) {
      try {
        fs.closeSync(inbox);
      } catch {
      }
    }
    try {
      this.onInboxError(error);
    } catch {
    }
  }

  emit(event) {
    const entry = {
      v: SCHEMA_VERSION,
      seq: ++this.seq,
      ts: new Date().toISOString(),
      runId: this.runId,
      type: event.type,
      status: event.status || 'ok',
      petState: event.petState || this.petState,
      tool: event.tool || null,
      summary: event.summary || '',
      reason: event.reason || null,
      rule: event.rule || null,
      detail: event.detail || {},
    };
    this.petState = entry.petState;
    this.buffer.push(entry);
    if (this.buffer.length > 500) this.buffer.shift();
    if (this.inbox != null) {
      try {
        fs.writeSync(this.inbox, JSON.stringify(entry) + '\n');
      } catch (error) {
        this.disableInbox(error);
      }
    }
    return entry;
  }

  state() {
    return {
      runId: this.runId,
      petState: this.petState,
      seq: this.seq,
    };
  }

  close() {
    if (this.inbox != null) {
      const inbox = this.inbox;
      this.inbox = null;
      try {
        fs.closeSync(inbox);
      } catch (error) {
        this.disableInbox(error);
      }
    }
  }
}

module.exports = { EventBus, SCHEMA_VERSION, defaultInboxPath, watchInbox };
