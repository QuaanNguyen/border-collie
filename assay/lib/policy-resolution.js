'use strict';

const NARROWED_LIST_FIELDS = [
  'read_paths',
  'write_paths',
  'allow_commands',
  'command_allowlist',
  'allow_tools',
  'egress',
];

function unique(values) {
  return [...new Set(values)];
}

function subsetPattern(first, second) {
  if (first === second || second === '**' || second === '*') return first;
  if (first === '**' || first === '*') return second;
  if (second.endsWith('/**') && first.startsWith(second.slice(0, -2))) return first;
  if (first.endsWith('/**') && second.startsWith(first.slice(0, -2))) return second;
  return null;
}

function intersectAllowLists(owner, project) {
  const resolved = [];
  for (const ownerValue of owner) {
    for (const projectValue of project) {
      const value = subsetPattern(projectValue, ownerValue);
      if (value !== null) resolved.push(value);
    }
  }
  return unique(resolved);
}

function resolvePolicy(owner, project) {
  if (!project) return owner;
  const resolved = { ...owner };

  for (const field of NARROWED_LIST_FIELDS) {
    if (!Object.hasOwn(project, field)) continue;
    resolved[field] = intersectAllowLists(owner[field] || [], project[field] || []);
  }

  if (Object.hasOwn(project, 'deny_commands')) {
    resolved.deny_commands = unique([...(owner.deny_commands || []), ...(project.deny_commands || [])]);
  }

  if (Object.hasOwn(project, 'allow_ordinary_bash')) {
    resolved.allow_ordinary_bash = owner.allow_ordinary_bash === true && project.allow_ordinary_bash === true;
  }

  for (const field of ['task', 'done_criteria']) {
    if (Object.hasOwn(project, field)) resolved[field] = project[field];
  }

  return resolved;
}

module.exports = { resolvePolicy };
