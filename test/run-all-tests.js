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
  'unit/guard-core.test.js',
  'unit/animation-assets.test.js',
  'unit/animation-manifest.test.js',
  'unit/animation-player.test.js',
  'unit/package-surface.test.js',
  'unit/pet-session-behavior.test.js',
  'unit/window-interaction.test.js',
  'integration/install-plugin.test.js',
  'integration/policy-supervisor-workflow.test.js',
  'integration/atomic-install.test.js',
  'integration/install-diagnostics.test.js',
  'integration/full-install.test.js',
  'integration/plugin-liveness.test.js',
  'e2e/opencode-session.test.js',
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
  for (const suite of ['e2e/renderer-events.test.js', 'e2e/pet-window-focus.test.js']) {
    execFileSync(process.execPath, [path.join(__dirname, suite)], {
      cwd: ROOT,
      stdio: 'inherit',
    })
  }
}

process.stdout.write('complete Border Collie test suite verified\n')
