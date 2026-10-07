#!/usr/bin/env node
'use strict';

const { installPlugin } = require('./install-plugin');
const { migrate } = require('./migrate');
const { parseSizeArgument } = require('../events/size-command');
const { sendControl } = require('../pet/control');
const { readConfig, writeConfig } = require('../guard/lib/config');

function usage() {
  return `Usage: bdc <command>

Commands:
  install                    Bind the OpenCode plugin and retrieve the Needle Judge
  migrate                    Move this folder from the retired Protocol and profiles to a Preference
  pet size <percent|reset>   Persist and apply the Pet size
  help                       Show this help
`;
}

async function handlePet(args) {
  if (args[0] !== 'size' || !args[1] || args.length !== 2) throw new Error('pet size needs reset or a supported percentage');
  const size = parseSizeArgument(args[1]);
  if (!size) throw new Error('supported sizes are 60, 75, 90, 100, 115, 135, 160, and 200');
  const loaded = readConfig();
  if (loaded.error) throw new Error(`Border Collie configuration is invalid: ${loaded.error.message}`);
  loaded.config.pet.scale = size.scale;
  writeConfig(loaded.config);
  const applied = await sendControl({ action: 'size', scale: size.scale });
  process.stdout.write(`Pet size set to ${size.percent}%. ${applied ? 'The active Pet resized.' : 'It will apply to the next Pet session.'}\n`);
}

function handleMigrate() {
  const report = migrate();
  process.stdout.write(report.wrotePreference
    ? `Wrote the Preference at ${report.preferenceFile}${report.carriedDoneCriteria ? ` with ${report.carriedDoneCriteria} done criteria from the retired Protocol` : ''}.\n`
    : `Kept the Preference at ${report.preferenceFile}.\n`);
  for (const file of report.removed) process.stdout.write(`Removed ${file}.\n`);
  if (report.configFile) process.stdout.write(`Removed retired profiles from ${report.configFile}; Pet size was kept.\n`);
  if (!report.removed.length && !report.configFile) process.stdout.write('No retired Protocol or profile files were found.\n');
}

async function handleInstall() {
  console.log('Installing Border Collie into OpenCode global plugins…');
  const result = await installPlugin({ verifyOpenCode: true });
  console.log('Plugin entry:  ' + result.dest);
  console.log('Package:       ' + result.packageDir + '  (guard + pet)');
  console.log('Pet runtime:   ' + (
    process.platform === 'darwin'
      ? result.petDir + '/native/pet-host'
      : result.petDir + '/node_modules'
  ));
  console.log('Judge:         ' + result.judgeDir + (result.judgeReused ? '  (already verified)' : ''));
  console.log('Done. Open any project with: opencode <path>');
}

async function main(args = process.argv.slice(2)) {
  const command = args[0];
  if (command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(usage());
    return;
  }
  if (command === 'pet') return handlePet(args.slice(1));
  if (command === 'migrate' && args.length === 1) return handleMigrate();
  if (command === 'install' && args.length === 1) return handleInstall();
  throw new Error(usage());
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  });
}

module.exports = { main, usage };
