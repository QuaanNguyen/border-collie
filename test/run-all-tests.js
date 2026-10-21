'use strict';
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const PET_DIR = path.join(ROOT, 'pet')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const electronMarker = path.join(PET_DIR, 'node_modules', 'electron', 'path.txt')
const electronPackage = path.join(PET_DIR, 'node_modules', 'electron', 'package.json')
const lockedElectronVersion = require(path.join(PET_DIR, 'package-lock.json')).packages['node_modules/electron'].version

function electronMatchesLock() {
  if (!fs.existsSync(electronMarker) || !fs.existsSync(electronPackage)) return false
  return require(electronPackage).version === lockedElectronVersion
}

function run(command, args, cwd = ROOT) {
  execFileSync(command, args, { cwd, stdio: 'inherit' })
}

run(npm, ['test'])
const xorTests = fs.existsSync(path.join(ROOT, 'test', 'xor')) ? 'test/xor/*.test.js' : 'test/bordercollie/*.test.js'
run(process.execPath, ['--test', xorTests, 'test/plugin/*.test.mjs'])

if (process.env.XOR_SKIP_NATIVE_TESTS !== '1' && process.env.BORDERCOLLIE_SKIP_NATIVE_TESTS !== '1') {
  if (!electronMatchesLock()) {
    run(npm, ['ci'], PET_DIR)
  }
  run(npm, ['run', 'test:e2e'])
} else {
  run(npm, ['run', 'test:e2e:skip-native'])
}

process.stdout.write('complete xor test suite verified\n')
