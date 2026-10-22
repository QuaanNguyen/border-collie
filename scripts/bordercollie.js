#!/usr/bin/env node
'use strict';

const { main, usage } = require('./xor');

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  });
}

module.exports = { main, usage };
