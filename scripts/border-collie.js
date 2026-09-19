#!/usr/bin/env node
'use strict';

const { installPlugin } = require('./install-plugin');
const fs = require('node:fs');
const path = require('node:path');
const { parseSizeArgument } = require('../events/size-command');
const { sendControl } = require('../pet/control');
const { BUILTIN_PROFILES, readConfig, writeConfig, profile } = require('../guard/lib/config');
const { resolveProjectOwnerPolicy } = require('../guard/lib/owner-policy');
const { policyConflicts } = require('../guard/lib/policy-resolution');

function usage() {
  return `Usage: border-collie <command>

Commands:
  install                                  Install the Border Collie package for OpenCode
  profile list                              List built-in and named profiles
  profile show <name>                       Inspect a resolved profile
  profile create <name> --from <preset>     Copy a built-in preset into a named profile
  profile assign <adapter> <profile>        Set an adapter default profile
  project setup [--profile <name>] [--write-path <path>]
  project migrate                           Copy the legacy OpenCode Protocol to Border Collie
  pet size <percent|reset>                  Persist and apply the Pet size
  help                                     Show this help
`;
}

function configOrThrow() {
  const loaded = readConfig();
  if (loaded.error) throw new Error(`Border Collie configuration is invalid: ${loaded.error.message}`);
  return loaded;
}

function optionalValue(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return null;
  if (!args[index + 1]) throw new Error(`${name} needs a value`);
  return args[index + 1];
}

function projectProtocolPath(workdir = process.cwd()) {
  return path.join(workdir, '.border-collie', 'protocol.json');
}

function writeProjectProtocol(protocol, workdir = process.cwd()) {
  const file = projectProtocolPath(workdir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(protocol, null, 2) + '\n');
  fs.renameSync(temp, file);
  return file;
}

function handleProfile(args) {
  const [verb, name] = args;
  const loaded = configOrThrow();
  const config = loaded.config;
  if (verb === 'list' && args.length === 1) {
    for (const preset of Object.keys(BUILTIN_PROFILES)) process.stdout.write(`${preset}\tbuilt-in\n`);
    for (const [customName, custom] of Object.entries(config.profiles)) process.stdout.write(`${customName}\textends ${custom.extends}\n`);
    return;
  }
  if (verb === 'show' && name && args.length === 2) {
    const selected = profile(config, name);
    if (!selected) throw new Error(`unknown profile '${name}'`);
    process.stdout.write(JSON.stringify(selected, null, 2) + '\n');
    return;
  }
  if (verb === 'create' && name) {
    const from = optionalValue(args, '--from');
    const policyText = optionalValue(args, '--policy');
    if (!from || !BUILTIN_PROFILES[from]) throw new Error('profile create requires --from casual, research, or governed');
    if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error('profile names use lowercase letters, digits, and hyphens');
    if (config.profiles[name] || BUILTIN_PROFILES[name]) throw new Error(`profile '${name}' already exists`);
    let policy = {};
    if (policyText) {
      try { policy = JSON.parse(policyText); } catch { throw new Error('--policy must be JSON'); }
    }
    config.profiles[name] = { extends: from, policy };
    writeConfig(config);
    process.stdout.write(`Created profile '${name}' from ${from}.\n`);
    return;
  }
  if (verb === 'assign' && name && args[2] && args.length === 3) {
    const selected = args[2];
    if (!profile(config, selected)) throw new Error(`unknown profile '${selected}'`);
    config.adapters[name] ||= { default_profile: selected, allowed_project_profiles: [selected] };
    config.adapters[name].default_profile = selected;
    if (!config.adapters[name].allowed_project_profiles.includes(selected)) config.adapters[name].allowed_project_profiles.push(selected);
    writeConfig(config);
    process.stdout.write(`${name} now defaults to '${selected}'.\n`);
    return;
  }
  throw new Error('invalid profile command');
}

function handleProject(args) {
  const [verb] = args;
  if (verb === 'setup') {
    const selected = optionalValue(args, '--profile');
    const writePaths = [];
    for (let index = 0; index < args.length; index += 1) if (args[index] === '--write-path') {
      if (!args[index + 1]) throw new Error('--write-path needs a value');
      writePaths.push(args[index + 1]);
    }
    const protocol = {};
    if (selected) protocol.profile = selected;
    if (writePaths.length) protocol.write_paths = writePaths;
    const owner = resolveProjectOwnerPolicy('opencode', selected || null);
    if (!owner.active) throw new Error(owner.reason);
    const missing = (owner.profile?.required_project_fields || []).filter((field) => !Object.hasOwn(protocol, field));
    if (missing.length) throw new Error(`${owner.profile.name} requires a human project scope for ${missing.join(', ')}`);
    const conflicts = policyConflicts(owner.protocol, protocol);
    if (conflicts.length) throw new Error(`project Protocol broadens ${conflicts.map((conflict) => conflict.field).join(', ')}`);
    const file = writeProjectProtocol(protocol);
    process.stdout.write(`Wrote ${file}.\n`);
    return;
  }
  if (verb === 'migrate' && args.length === 1) {
    const source = path.join(process.cwd(), '.opencode', 'protocol.json');
    const target = projectProtocolPath();
    if (!fs.existsSync(source)) throw new Error(`no legacy Protocol exists at ${source}`);
    if (fs.existsSync(target)) throw new Error(`canonical Protocol already exists at ${target}`);
    let protocol;
    try { protocol = JSON.parse(fs.readFileSync(source, 'utf8')); } catch { throw new Error('legacy Protocol is malformed'); }
    if (Object.hasOwn(protocol, 'allow_commands')) delete protocol.allow_commands;
    const owner = resolveProjectOwnerPolicy('opencode', protocol.profile || null);
    if (!owner.active) throw new Error(owner.reason);
    const project = { ...protocol };
    delete project.profile;
    const conflicts = policyConflicts(owner.protocol, project);
    if (conflicts.length) throw new Error(`legacy Protocol broadens ${conflicts.map((conflict) => conflict.field).join(', ')}`);
    const file = writeProjectProtocol(protocol);
    process.stdout.write(`Copied legacy Protocol to ${file}. The old file was not changed.\n`);
    return;
  }
  throw new Error('invalid project command');
}

async function handlePet(args) {
  if (args[0] !== 'size' || !args[1] || args.length !== 2) throw new Error('pet size needs reset or a supported percentage');
  const size = parseSizeArgument(args[1]);
  if (!size) throw new Error('supported sizes are 60, 75, 90, 100, 115, 135, 160, and 200');
  const loaded = configOrThrow();
  loaded.config.pet.scale = size.scale;
  writeConfig(loaded.config);
  const applied = await sendControl({ action: 'size', scale: size.scale });
  process.stdout.write(`Pet size set to ${size.percent}%. ${applied ? 'The active Pet resized.' : 'It will apply to the next Pet session.'}\n`);
}

async function main(args = process.argv.slice(2)) {
  const command = args[0];
  if (command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(usage());
    return;
  }
  if (command === 'profile') return handleProfile(args.slice(1));
  if (command === 'project') return handleProject(args.slice(1));
  if (command === 'pet') return handlePet(args.slice(1));
  if (command !== 'install' || args.length !== 1) throw new Error(usage());

  console.log('Installing Border Collie into OpenCode global plugins…');
  const result = installPlugin({ verifyOpenCode: true });
  console.log('Plugin entry:  ' + result.dest);
  console.log('Package:       ' + result.packageDir + '  (guard + pet)');
  console.log('Pet runtime:   ' + (
    process.platform === 'darwin'
      ? result.petDir + '/native/pet-host'
      : result.petDir + '/node_modules'
  ));
  console.log('Owner policy:  ' + result.ownerPolicyPath);
  console.log('Done. Open any project with: opencode <path>');
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  });
}

module.exports = { main, usage, projectProtocolPath };
