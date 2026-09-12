const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const { electronReady, installPlugin, nativePetReady } = require('../../scripts/install-plugin')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'border-collie-full-install-'))
const originalNodeEnv = process.env.NODE_ENV
let result
try {
  process.env.NODE_ENV = 'production'
  result = installPlugin({
    repoRoot: ROOT,
    destDir: path.join(root, 'plugins'),
    ownerConfigDir: path.join(root, 'owner'),
  })
} finally {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = originalNodeEnv
}

assert.strictEqual(process.platform === 'darwin' ? nativePetReady(result.petDir) : electronReady(result.petDir), true)
assert.ok(fs.existsSync(result.dest))
assert.ok(fs.existsSync(path.join(result.packageDir, 'guard', 'lib', 'session.js')))
assert.ok(fs.existsSync(path.join(result.packageDir, 'events', 'index.js')))
assert.ok(fs.existsSync(path.join(result.packageDir, 'pet', 'package.json')))

const emptyBin = path.join(root, 'empty-bin')
const originalPath = process.env.PATH
fs.mkdirSync(emptyBin)
let repeated
try {
  process.env.PATH = emptyBin
  repeated = installPlugin({
    repoRoot: ROOT,
    destDir: path.join(root, 'plugins'),
    ownerConfigDir: path.join(root, 'owner'),
  })
} finally {
  process.env.PATH = originalPath
}
assert.strictEqual(repeated.petRuntimeReused, true)
assert.strictEqual(process.platform === 'darwin' ? nativePetReady(repeated.petDir) : electronReady(repeated.petDir), true)
fs.rmSync(root, { recursive: true, force: true })
process.stdout.write('ok - full install works in production and reuses a ready Pet runtime\n')
