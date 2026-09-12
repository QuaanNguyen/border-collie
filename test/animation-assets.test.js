'use strict'
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const { spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const SOURCE = path.join(ROOT, 'docs', 'assets', 'border-collie-source.png')
const SCRIPT = path.join(ROOT, 'scripts', 'package-animation-assets.js')
const RUNTIME = path.join(ROOT, 'pet', 'assets', 'default-animations')
const QA = path.join(ROOT, 'docs', 'assets', 'border-collie-animation-qa.png')
const GUIDE = path.join(ROOT, 'docs', 'ANIMATION_ASSETS.md')
const SOURCE_SHA256 = '656deba7e0dfe60e516e9e5db6a3247b3fe031038cbf01fec33fd931e6b28cc3'
const ANIMATIONS = ['normal', 'dragging', 'hovering', 'thinking', 'suspicious', 'refused', 'denied', 'celebrating']

function paeth(left, above, upperLeft) {
  const estimate = left + above - upperLeft
  const leftDistance = Math.abs(estimate - left)
  const aboveDistance = Math.abs(estimate - above)
  const upperLeftDistance = Math.abs(estimate - upperLeft)
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left
  if (aboveDistance <= upperLeftDistance) return above
  return upperLeft
}

function decodePng(filePath) {
  const file = fs.readFileSync(filePath)
  assert.strictEqual(file.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  let offset = 8
  let width
  let height
  let bitDepth
  let colorType
  let interlace
  const chunks = []

  while (offset < file.length) {
    const length = file.readUInt32BE(offset)
    const type = file.subarray(offset + 4, offset + 8).toString('ascii')
    const data = file.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    }
    if (type === 'IDAT') chunks.push(data)
    if (type === 'IEND') break
    offset += length + 12
  }

  assert.deepStrictEqual({ bitDepth, colorType, interlace }, { bitDepth: 8, colorType: 6, interlace: 0 })
  const packed = zlib.inflateSync(Buffer.concat(chunks))
  const stride = width * 4
  const pixels = Buffer.alloc(width * height * 4)
  let packedOffset = 0

  for (let y = 0; y < height; y += 1) {
    const filter = packed[packedOffset]
    packedOffset += 1
    const rowOffset = y * stride
    for (let x = 0; x < stride; x += 1) {
      const raw = packed[packedOffset + x]
      const left = x >= 4 ? pixels[rowOffset + x - 4] : 0
      const above = y > 0 ? pixels[rowOffset + x - stride] : 0
      const upperLeft = y > 0 && x >= 4 ? pixels[rowOffset + x - stride - 4] : 0
      let value
      if (filter === 0) value = raw
      else if (filter === 1) value = raw + left
      else if (filter === 2) value = raw + above
      else if (filter === 3) value = raw + Math.floor((left + above) / 2)
      else if (filter === 4) value = raw + paeth(left, above, upperLeft)
      else assert.fail(`unsupported PNG filter ${filter}`)
      pixels[rowOffset + x] = value & 255
    }
    packedOffset += stride
  }

  return { width, height, pixels }
}

function visibleColors(image, box = { x: 0, y: 0, width: image.width, height: image.height }) {
  const counts = new Map()
  for (let y = 0; y < box.height; y += 1) {
    for (let x = 0; x < box.width; x += 1) {
      const offset = ((box.y + y) * image.width + box.x + x) * 4
      const alpha = image.pixels[offset + 3]
      if (alpha === 0) continue
      const key = image.pixels.readUInt32BE(offset)
      counts.set(key, (counts.get(key) || 0) + 1)
    }
  }
  return [...counts].sort((left, right) => left[0] - right[0])
}

function alphaBounds(image) {
  let minX = image.width
  let minY = image.height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.pixels[(y * image.width + x) * 4 + 3] === 0) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  return { minX, minY, maxX, maxY }
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function packageInto(root) {
  const output = path.join(root, 'animations')
  const manifest = path.join(output, 'manifest.json')
  const qa = path.join(root, 'qa.png')
  const result = spawnSync(process.execPath, [
    SCRIPT,
    '--source', SOURCE,
    '--output', output,
    '--manifest', manifest,
    '--qa', qa,
  ], { cwd: ROOT, encoding: 'utf8' })
  assert.strictEqual(result.status, 0, result.stderr)
  return { output, manifest, qa }
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'border-collie-animation-assets-'))
try {
  const guide = fs.readFileSync(GUIDE, 'utf8')
  assert.match(guide, /node scripts\/package-animation-assets\.js/)
  assert.doesNotMatch(guide, /black background pixels as transparent/i)
  assert.match(guide, /source alpha/i)
  assert.strictEqual(sha256(SOURCE), SOURCE_SHA256)
  const first = packageInto(path.join(tempRoot, 'first'))
  const second = packageInto(path.join(tempRoot, 'second'))
  const source = decodePng(SOURCE)
  assert.deepStrictEqual({ width: source.width, height: source.height }, { width: 960, height: 1536 })

  const manifest = JSON.parse(fs.readFileSync(first.manifest, 'utf8'))
  assert.strictEqual(manifest.source.sha256, SOURCE_SHA256)
  assert.strictEqual(manifest.conversion.transparency, 'source-alpha')
  assert.strictEqual(manifest.conversion.alignment, 'bottom-center')
  assert.strictEqual(manifest.conversion.bottomPadding, 8)
  assert.strictEqual(manifest.frames.length, 40)

  for (let row = 0; row < ANIMATIONS.length; row += 1) {
    const animation = ANIMATIONS[row]
    for (let column = 0; column < 5; column += 1) {
      const relative = path.join(`border-collie-${animation}`, `border-collie-${animation}-${column + 1}.png`)
      const generatedPath = path.join(first.output, relative)
      const repeatedPath = path.join(second.output, relative)
      const runtimePath = path.join(RUNTIME, relative)
      const frame = decodePng(generatedPath)
      assert.deepStrictEqual({ width: frame.width, height: frame.height }, { width: 192, height: 208 })
      assert.deepStrictEqual(
        visibleColors(frame),
        visibleColors(source, { x: column * 192, y: row * 192, width: 192, height: 192 }),
        `${animation} frame ${column + 1} must preserve every visible source pixel`,
      )
      const bounds = alphaBounds(frame)
      assert.strictEqual(bounds.maxY, 199, `${animation} frame ${column + 1} must keep an eight-pixel bottom margin`)
      assert.ok(Math.abs(bounds.minX - (191 - bounds.maxX)) <= 1, `${animation} frame ${column + 1} must be horizontally centered`)
      assert.strictEqual(sha256(generatedPath), sha256(repeatedPath), `${relative} must be deterministic`)
      assert.deepStrictEqual(decodePng(runtimePath), frame, `${relative} must match the packaged runtime asset`)
    }
  }

  const qa = decodePng(first.qa)
  assert.deepStrictEqual({ width: qa.width, height: qa.height }, { width: 1440, height: 1664 })
  assert.strictEqual(sha256(first.qa), sha256(second.qa))
  assert.deepStrictEqual(decodePng(QA), qa, 'the checked-in QA artifact must match the packaged frames')
  assert.strictEqual(fs.readFileSync(first.manifest, 'utf8'), fs.readFileSync(path.join(RUNTIME, 'manifest.json'), 'utf8'))
  process.stdout.write('ok - sprite packaging preserves source alpha and visible artwork\n')
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
