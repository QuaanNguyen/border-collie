'use strict';

const { createSession } = require('./session');

function createGuardAdapter(options = {}) {
  const session = createSession(options);
  return {
    start() { return session.handle({ kind: 'session.start' }); },
    end() { return session.handle({ kind: 'session.end' }); },
    lifecycle(kind) { return session.handle({ kind }); },
    proposedAction(action) { return session.propose(action); },
    toolResult(result) { return session.handle({ kind: 'tool.after', ...result }); },
    assistantCompletion(completion) { return session.handle({ kind: 'assistant', ...completion }); },
    replacePreference(preference) { session.replacePreference(preference); },
    get preference() { return session.preference; },
  };
}

module.exports = { createGuardAdapter };
