'use strict';
const { randomUUID } = require('node:crypto');

const SCHEMA_VERSION = 1;

class EventBus {
  constructor(opts = {}) {
    this.runId = opts.runId || `run-${Date.now().toString(36)}-${randomUUID()}`;
    this.seq = 0;
    this.petState = 'calm';
    this.sink = typeof opts.sink === 'function' ? opts.sink : null;
    this.onError = typeof opts.onError === 'function' ? opts.onError : () => {};
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
    if (this.sink) {
      try {
        this.sink(entry);
      } catch (error) {
        this.onError(error);
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
    this.sink = null;
  }
}

module.exports = { EventBus, SCHEMA_VERSION };
