'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { decodePng, encodePng } = require('./lib/png')

const ROOT = path.resolve(__dirname, '..')
const ANIMATIONS = ['normal', 'dragging', 'hovering', 'thinking', 'suspicious', 'refused', 'denied', 'celebrating']
const SOURCE_CELL = { width: 192, height: 192 }
const FRAME = { width: 192, height: 208, bottomPadding: 8 }

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function visibleBounds(image, box) {
  let minX = box.width
  let minY = box.height
  let maxX = -1
  let maxY = -1
  let visiblePixels = 0
  for (let y = 0; y < box.height; y += 1) {
    for (let x = 0; x < box.width; x += 1) {
      const alpha = image.pixels[((box.y + y) * image.width + box.x + x) * 4 + 3]
      if (alpha === 0) continue
      visiblePixels += 1
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  if (maxX < 0 || maxY < 0) throw new Error(`source cell ${box.column + 1},${box.row + 1} is empty`)
  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    visiblePixels,
  }
}

function extractFrame(source, row, column) {
  const box = {
    x: column * SOURCE_CELL.width,
    y: row * SOURCE_CELL.height,
    width: SOURCE_CELL.width,
    height: SOURCE_CELL.height,
    row,
    column,
  }
  const sourceBounds = visibleBounds(source, box)
  if (sourceBounds.width > FRAME.width || sourceBounds.height > FRAME.height - FRAME.bottomPadding) {
    throw new Error(`source cell ${column + 1},${row + 1} does not fit the runtime frame`)
  }

  const destination = {
    x: Math.floor((FRAME.width - sourceBounds.width) / 2),
    y: FRAME.height - FRAME.bottomPadding - sourceBounds.height,
  }
  const pixels = Buffer.alloc(FRAME.width * FRAME.height * 4)
  for (let y = 0; y < sourceBounds.height; y += 1) {
    for (let x = 0; x < sourceBounds.width; x += 1) {
      const sourceOffset = (
        (box.y + sourceBounds.y + y) * source.width +
        box.x + sourceBounds.x + x
      ) * 4
      if (source.pixels[sourceOffset + 3] === 0) continue
      const outputOffset = ((destination.y + y) * FRAME.width + destination.x + x) * 4
      source.pixels.copy(pixels, outputOffset, sourceOffset, sourceOffset + 4)
    }
  }

  return {
    image: { width: FRAME.width, height: FRAME.height, pixels },
    sourceBounds: {
      x: sourceBounds.x,
      y: sourceBounds.y,
      width: sourceBounds.width,
      height: sourceBounds.height,
    },
    destination,
    visiblePixels: sourceBounds.visiblePixels,
  }
}

function backgroundPixel(background, x, y) {
  if (background.type === 'solid') return background.color
  return (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0
    ? [190, 190, 190]
    : [232, 232, 232]
}

function renderQa(frames) {
  const backgrounds = [
    { type: 'solid', color: [0, 0, 0] },
    { type: 'solid', color: [255, 255, 255] },
    { type: 'checker' },
    { type: 'solid', color: [171, 71, 188] },
    { type: 'solid', color: [191, 123, 35] },
    { type: 'solid', color: [90, 198, 192] },
  ]
  const scale = 2
  const cellWidth = FRAME.width / scale
  const cellHeight = FRAME.height / scale
  const panelWidth = cellWidth * 5
  const panelHeight = cellHeight * 8
  const width = panelWidth * 3
  const height = panelHeight * 2
  const pixels = Buffer.alloc(width * height * 4)

  for (let panel = 0; panel < backgrounds.length; panel += 1) {
    const panelX = (panel % 3) * panelWidth
    const panelY = Math.floor(panel / 3) * panelHeight
    const background = backgrounds[panel]
    for (let row = 0; row < 8; row += 1) {
      for (let column = 0; column < 5; column += 1) {
        const frame = frames[row * 5 + column].image
        for (let y = 0; y < cellHeight; y += 1) {
          for (let x = 0; x < cellWidth; x += 1) {
            const sourceOffset = ((y * scale) * FRAME.width + x * scale) * 4
            const alpha = frame.pixels[sourceOffset + 3]
            const backgroundColor = backgroundPixel(background, x + column * cellWidth, y + row * cellHeight)
            const outputX = panelX + column * cellWidth + x
            const outputY = panelY + row * cellHeight + y
            const outputOffset = (outputY * width + outputX) * 4
            for (let channel = 0; channel < 3; channel += 1) {
              pixels[outputOffset + channel] = Math.round(
                (frame.pixels[sourceOffset + channel] * alpha + backgroundColor[channel] * (255 - alpha)) / 255,
              )
            }
            pixels[outputOffset + 3] = 255
          }
        }
      }
    }
  }

  return { width, height, pixels }
}

function packageAnimationAssets(options = {}) {
  const sourcePath = path.resolve(options.sourcePath || path.join(ROOT, 'docs', 'assets', 'border-collie-source.png'))
  const outputDir = path.resolve(options.outputDir || path.join(ROOT, 'pet', 'assets', 'default-animations'))
  const manifestPath = path.resolve(options.manifestPath || path.join(outputDir, 'manifest.json'))
  const qaPath = path.resolve(options.qaPath || path.join(ROOT, 'docs', 'assets', 'border-collie-animation-qa.png'))
  const sourceFile = fs.readFileSync(sourcePath)
  const source = decodePng(sourceFile)
  const expected = {
    width: SOURCE_CELL.width * 5,
    height: SOURCE_CELL.height * ANIMATIONS.length,
  }
  if (source.width !== expected.width || source.height !== expected.height) {
    throw new Error(`expected a ${expected.width}x${expected.height} source sheet, received ${source.width}x${source.height}`)
  }

  const frames = []
  for (let row = 0; row < ANIMATIONS.length; row += 1) {
    const animation = ANIMATIONS[row]
    const directory = path.join(outputDir, `border-collie-${animation}`)
    fs.mkdirSync(directory, { recursive: true })
    for (let column = 0; column < 5; column += 1) {
      const frame = extractFrame(source, row, column)
      const filename = `border-collie-${animation}-${column + 1}.png`
      const filePath = path.join(directory, filename)
      fs.writeFileSync(filePath, encodePng(frame.image))
      frames.push({
        animation,
        index: column + 1,
        file: path.relative(outputDir, filePath).split(path.sep).join('/'),
        sourceCell: { row: row + 1, column: column + 1 },
        sourceBounds: frame.sourceBounds,
        destination: frame.destination,
        visiblePixels: frame.visiblePixels,
        pixelSha256: sha256(frame.image.pixels),
        image: frame.image,
      })
    }
  }

  const manifest = {
    schemaVersion: 1,
    source: {
      file: path.basename(sourcePath),
      sha256: sha256(sourceFile),
      width: source.width,
      height: source.height,
      columns: 5,
      rows: ANIMATIONS.length,
    },
    conversion: {
      transparency: 'source-alpha',
      alignment: 'bottom-center',
      sourceCell: SOURCE_CELL,
      frame: { width: FRAME.width, height: FRAME.height },
      bottomPadding: FRAME.bottomPadding,
      animations: ANIMATIONS,
    },
    frames: frames.map(({ image, ...entry }) => entry),
  }

  fs.mkdirSync(path.dirname(manifestPath), { recursive: true })
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  fs.mkdirSync(path.dirname(qaPath), { recursive: true })
  fs.writeFileSync(qaPath, encodePng(renderQa(frames)))
  return { sourcePath, outputDir, manifestPath, qaPath, frameCount: frames.length }
}

function parseArgs(argv) {
  const values = {}
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!name.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new Error(`expected a value after ${name}`)
    }
    values[name.slice(2)] = value
    index += 1
  }
  return values
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2))
    const result = packageAnimationAssets({
      sourcePath: args.source,
      outputDir: args.output,
      manifestPath: args.manifest,
      qaPath: args.qa,
    })
    process.stdout.write(`packaged ${result.frameCount} animation frames\n`)
    process.stdout.write(`manifest: ${result.manifestPath}\n`)
    process.stdout.write(`qa: ${result.qaPath}\n`)
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}

module.exports = { packageAnimationAssets }
