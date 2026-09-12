const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { installPlugin, replaceInstallation } = require('../scripts/install-plugin')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'border-collie-atomic-install-'))
const repoRoot = path.join(root, 'repo')
const pluginsDir = path.join(root, 'plugins')
const ownerConfigDir = path.join(root, 'owner')
const packageDir = path.join(pluginsDir, 'border-collie')
const entryPath = path.join(pluginsDir, 'border-collie.js')

fs.mkdirSync(path.join(repoRoot, 'plugin'), { recursive: true })
fs.mkdirSync(path.join(repoRoot, 'guard', 'lib'), { recursive: true })
fs.mkdirSync(path.join(repoRoot, 'events'), { recursive: true })
fs.mkdirSync(path.join(repoRoot, 'pet'), { recursive: true })
fs.mkdirSync(packageDir, { recursive: true })
fs.writeFileSync(path.join(repoRoot, 'plugin', 'border-collie.js'), 'export const BorderCollie = async () => ({})\n')
fs.writeFileSync(path.join(repoRoot, 'guard', 'lib', 'session.js'), 'module.exports = {}\n')
fs.writeFileSync(path.join(repoRoot, 'events', 'index.js'), 'module.exports = {}\n')
fs.writeFileSync(path.join(repoRoot, 'pet', 'package.json'), JSON.stringify({
  name: 'failing-pet-install',
  version: '1.0.0',
  scripts: { install: 'node -e "process.exit(23)"' },
}))
fs.writeFileSync(path.join(repoRoot, 'pet', 'package-lock.json'), JSON.stringify({
  name: 'failing-pet-install',
  version: '1.0.0',
  lockfileVersion: 3,
  requires: true,
  packages: {
    '': {
      name: 'failing-pet-install',
      version: '1.0.0',
      hasInstallScript: true,
    },
  },
}))
fs.writeFileSync(entryPath, 'old entry\n')
fs.writeFileSync(path.join(packageDir, 'old-marker'), 'old package\n')

assert.throws(() => installPlugin({ repoRoot, destDir: pluginsDir, ownerConfigDir }))
assert.strictEqual(fs.readFileSync(entryPath, 'utf8'), 'old entry\n')
assert.strictEqual(fs.readFileSync(path.join(packageDir, 'old-marker'), 'utf8'), 'old package\n')

const verificationRoot = path.join(root, 'verification')
const verificationPackage = path.join(verificationRoot, 'border-collie')
const verificationEntry = path.join(verificationRoot, 'border-collie.js')
fs.mkdirSync(verificationPackage, { recursive: true })
fs.writeFileSync(path.join(verificationPackage, 'new-marker'), 'new package\n')
fs.writeFileSync(verificationEntry, 'new entry\n')
assert.throws(() => replaceInstallation({
  stagePackage: verificationPackage,
  stageEntry: verificationEntry,
  packageDir,
  entry: entryPath,
  pluginsDir,
  verify: () => { throw new Error('OpenCode readiness failed') },
}))
assert.strictEqual(fs.readFileSync(entryPath, 'utf8'), 'old entry\n')
assert.strictEqual(fs.readFileSync(path.join(packageDir, 'old-marker'), 'utf8'), 'old package\n')
fs.rmSync(root, { recursive: true, force: true })
process.stdout.write('ok - a failed staged install preserves the working plugin\n')
