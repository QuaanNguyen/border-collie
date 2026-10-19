'use strict';

const { requestFor: expandedRequest, sensitiveRule, defaultPreference, preferenceWithDefaults, inputHash } = require('./request-v3');

const requestVersion = '4-analysis-permission-priority';

function requestFor(scenario) {
  const expanded = expandedRequest(scenario);
  const tools = expanded.tools.map((tool) => {
    if (tool.name !== 'ask_owner') return tool;
    if (!tool.description.endsWith(sensitiveRule)) throw new Error('The complete sensitive rule is missing from the preceding draft');
    return { ...tool, description: tool.description.slice(0, -sensitiveRule.length) + 'Sensitive reads follow the permission and confirmation rule in block_call.' };
  });
  return { version: requestVersion, query: expanded.query, tools };
}

module.exports = { requestVersion, defaultPreference, preferenceWithDefaults, inputHash, requestFor };
