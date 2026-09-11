'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

function buildNativePet(petDir, output = path.join(petDir, 'native', 'pet-host')) {
  if (process.platform !== 'darwin') throw new Error('the native Pet host can only be built on macOS')
  const source = path.join(petDir, 'native', 'PetHost.swift')
  if (!fs.existsSync(source)) throw new Error('missing native Pet source at ' + source)
  fs.mkdirSync(path.dirname(output), { recursive: true })
  const moduleCache = fs.mkdtempSync(path.join(os.tmpdir(), 'border-collie-swift-module-cache-'))
  let result
  try {
    result = spawnSync('/usr/bin/xcrun', [
      'swiftc',
      '-parse-as-library',
      '-module-cache-path',
      moduleCache,
      source,
      '-o',
      output,
      '-framework',
      'AppKit',
      '-framework',
      'WebKit',
      '-framework',
      'Carbon',
    ], {
      encoding: 'utf8',
      timeout: 120000,
    })
  } finally {
    fs.rmSync(moduleCache, { recursive: true, force: true })
  }
  if (result.status !== 0) {
    const diagnostic = (result.stderr || result.stdout || result.error?.message || '').trim().slice(-4000)
    throw new Error('native Pet build failed' + (diagnostic ? '\n' + diagnostic : ''))
  }
  fs.chmodSync(output, 0o755)
  return output
}

if (require.main === module) {
  const petArg = process.argv.find((value) => value.startsWith('--pet-dir='))
  const outputArg = process.argv.find((value) => value.startsWith('--output='))
  const petDir = path.resolve(petArg ? petArg.slice('--pet-dir='.length) : path.join(__dirname, '..', 'pet'))
  const output = outputArg ? path.resolve(outputArg.slice('--output='.length)) : undefined
  process.stdout.write(buildNativePet(petDir, output) + '\n')
}

module.exports = { buildNativePet }
