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
run(process.execPath, ['--test', 'test/guard/*.test.js', 'test/plugin/*.test.mjs'])

if (process.env.BORDER_COLLIE_SKIP_NATIVE_TESTS !== '1') {
  if (!electronMatchesLock()) {
    run(npm, ['ci'], PET_DIR)
  }
  run(npm, ['run', 'test:e2e'])
} else {
  run(npm, ['run', 'test:e2e:skip-native'])
}

process.stdout.write('complete Border Collie test suite verified\n')
