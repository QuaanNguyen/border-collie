#!/usr/bin/env node
'use strict';

const { installPlugin } = require('./install-plugin');

function usage() {
  return `Usage: border-collie <command>

Commands:
  install    Install the Border Collie package for OpenCode
  help       Show this help
`;
}

function main(args = process.argv.slice(2)) {
  const command = args[0];
  if (command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(usage());
    return;
  }
  if (command !== 'install' || args.length !== 1) {
    process.stderr.write(usage());
    process.exitCode = 2;
    return;
  }

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

if (require.main === module) main();

module.exports = { main, usage };
