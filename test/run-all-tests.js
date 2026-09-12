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

const suites = [
  'run-tests.js',
  'install-plugin.test.js',
  'animation-assets.test.js',
  'animation-manifest.test.js',
  'animation-player.test.js',
  'policy-supervisor-workflow.test.js',
  'atomic-install.test.js',
  'install-diagnostics.test.js',
  'full-install.test.js',
  'package-surface.test.js',
  'pet-session-behavior.test.js',
  'plugin-liveness.test.js',
  'opencode-session.test.js',
  'window-interaction.test.js',
]

for (const suite of suites) {
  execFileSync(process.execPath, [path.join(__dirname, suite)], {
    cwd: ROOT,
    stdio: 'inherit',
  })
}

if (process.env.BORDER_COLLIE_SKIP_NATIVE_TESTS !== '1') {
  if (!electronMatchesLock()) {
    execFileSync(npm, ['ci'], { cwd: PET_DIR, stdio: 'inherit' })
  }
  for (const suite of ['renderer-events.test.js', 'pet-window-focus.test.js']) {
    execFileSync(process.execPath, [path.join(__dirname, suite)], {
      cwd: ROOT,
      stdio: 'inherit',
    })
  }
}

process.stdout.write('complete Border Collie test suite verified\n')
