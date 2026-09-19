'use strict';

const { createSession } = require('./session');

function createGuardAdapter(options = {}) {
  const session = createSession(options);
  return {
    start() { return session.handle({ kind: 'session.start' }); },
    end() { return session.handle({ kind: 'session.end' }); },
    lifecycle(kind) { return session.handle({ kind }); },
    proposedAction(action) { return session.handle({ kind: 'permission', ...action }); },
    toolResult(result) { return session.handle({ kind: 'tool.after', ...result }); },
    assistantCompletion(completion) { return session.handle({ kind: 'assistant', ...completion }); },
    replaceProtocol(protocol) { session.replaceProtocol(protocol); },
    get protocol() { return session.protocol; },
  };
}

module.exports = { createGuardAdapter };
