const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { installPlugin } = require('../../scripts/install-plugin')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'border-collie-install-diagnostics-'))
const repoRoot = path.join(root, 'repo')
const pluginsDir = path.join(root, 'plugins')
const packageDir = path.join(pluginsDir, 'border-collie')
const entryPath = path.join(pluginsDir, 'border-collie.js')
const executableDir = path.join(root, 'bin')
const executable = path.join(executableDir, process.platform === 'win32' ? 'opencode.exe' : 'opencode')
const originalPath = process.env.PATH

fs.mkdirSync(path.join(repoRoot, 'plugin'), { recursive: true })
fs.mkdirSync(path.join(repoRoot, 'guard', 'lib'), { recursive: true })
fs.mkdirSync(path.join(repoRoot, 'events'), { recursive: true })
fs.mkdirSync(path.join(repoRoot, 'pet'), { recursive: true })
fs.mkdirSync(packageDir, { recursive: true })
fs.mkdirSync(executableDir, { recursive: true })
fs.writeFileSync(path.join(repoRoot, 'plugin', 'border-collie.js'), 'export const BorderCollie = async () => ({})\n')
fs.writeFileSync(path.join(repoRoot, 'guard', 'lib', 'session.js'), 'module.exports = {}\n')
fs.writeFileSync(path.join(repoRoot, 'events', 'index.js'), 'module.exports = {}\n')
fs.writeFileSync(path.join(repoRoot, 'pet', 'package.json'), '{}\n')
fs.writeFileSync(entryPath, 'old entry\n')
fs.writeFileSync(path.join(packageDir, 'old-marker'), 'old package\n')
fs.writeFileSync(executable, '#!/bin/sh\nprintf "loader exploded: invalid plugin config\\n" >&2\nexit 19\n')
fs.chmodSync(executable, 0o755)

try {
  process.env.PATH = executableDir + path.delimiter + originalPath
  assert.throws(() => installPlugin({
    repoRoot,
    destDir: pluginsDir,
    ownerConfigDir: path.join(root, 'owner'),
    skipRuntimeSetup: true,
    verifyOpenCode: true,
  }), /loader exploded: invalid plugin config/)
  assert.strictEqual(fs.readFileSync(entryPath, 'utf8'), 'old entry\n')
  assert.strictEqual(fs.readFileSync(path.join(packageDir, 'old-marker'), 'utf8'), 'old package\n')
  process.stdout.write('ok - OpenCode readiness failures preserve the install and expose diagnostics\n')
} finally {
  process.env.PATH = originalPath
  fs.rmSync(root, { recursive: true, force: true })
}
