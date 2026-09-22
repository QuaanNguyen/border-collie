'use strict';

const { EventBus } = require('../events');

const SCENARIOS = [
  { id: 'thinking', label: 'Working', event: { type: 'thinking', status: 'ok', petState: 'thinking', summary: 'Checking the task' } },
  { id: 'allowed', label: 'Allowed', event: { type: 'action', status: 'allow', petState: 'allowed', tool: 'read', summary: 'Read a project file' } },
  { id: 'refused', label: 'Refused', event: { type: 'excursion', status: 'block', petState: 'denied', tool: 'bash', summary: 'Outside the task', reason: 'The path is not allowed', rule: 'write_paths' } },
  { id: 'complete', label: 'Verified', event: { type: 'verdict', status: 'pass', petState: 'celebrating', summary: 'All checks passed' } },
  { id: 'incomplete', label: 'Not done', event: { type: 'verdict', status: 'fail', petState: 'rejecting', summary: 'Evidence is incomplete', reason: 'Expected output is missing' } },
  { id: 'ask', label: 'Needs review', event: { type: 'ask', status: 'ask', petState: 'asking', summary: 'Human judgment needed', reason: 'The change is ambiguous' } },
  { id: 'error', label: 'Tool error', event: { type: 'toolerror', status: 'error', petState: 'error', summary: 'The command failed' } },
  { id: 'size-115', label: 'Size 115%', event: { type: 'control', status: 'ok', petState: 'calm', summary: 'Pet size 115%', detail: { action: 'size', scale: 1.15, percent: 115 } } },
  { id: 'size-100', label: 'Size 100%', event: { type: 'control', status: 'ok', petState: 'calm', summary: 'Pet size 100%', detail: { action: 'size', scale: 1, percent: 100 } } },
];

function createDevHarness() {
  const bus = new EventBus({ runId: `pet-dev-${process.pid}`, inboxPath: null });
  return {
    scenarios() {
      return SCENARIOS.map(({ id, label }) => ({ id, label }));
    },
    trigger(id) {
      const scenario = SCENARIOS.find((candidate) => candidate.id === id);
      return scenario ? bus.emit(scenario.event) : null;
    },
  };
}

module.exports = { createDevHarness };
