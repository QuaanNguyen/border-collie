'use strict'
const zlib = require('node:zlib')

const SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex')

function paeth(left, above, upperLeft) {
  const estimate = left + above - upperLeft
  const leftDistance = Math.abs(estimate - left)
  const aboveDistance = Math.abs(estimate - above)
  const upperLeftDistance = Math.abs(estimate - upperLeft)
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left
  if (aboveDistance <= upperLeftDistance) return above
  return upperLeft
}

function decodePng(file) {
  if (!Buffer.isBuffer(file) || file.length < 8 || !file.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error('input must be a PNG buffer')
  }

  let offset = 8
  let width
  let height
  let bitDepth
  let colorType
  let interlace
  const idat = []

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
    if (type === 'IDAT') idat.push(data)
    if (type === 'IEND') break
    offset += length + 12
  }

  if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) {
    throw new Error(`expected a non-interlaced 8-bit RGBA PNG, received ${bitDepth}/${colorType}/${interlace}`)
  }

  const packed = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * 4
  const expectedLength = (stride + 1) * height
  if (packed.length !== expectedLength) {
    throw new Error(`unexpected PNG payload length ${packed.length}, expected ${expectedLength}`)
  }

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
      else throw new Error(`unsupported PNG filter ${filter}`)
      pixels[rowOffset + x] = value & 255
    }
    packedOffset += stride
  }

  return { width, height, pixels }
}

function crcTable() {
  const table = new Uint32Array(256)
  for (let value = 0; value < 256; value += 1) {
    let crc = value
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
    }
    table[value] = crc >>> 0
  }
  return table
}

const CRC_TABLE = crcTable()

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii')
  const payload = Buffer.concat([typeBuffer, data])
  const chunk = Buffer.alloc(data.length + 12)
  chunk.writeUInt32BE(data.length, 0)
  typeBuffer.copy(chunk, 4)
  data.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(payload), data.length + 8)
  return chunk
}

function encodePng(image) {
  const { width, height, pixels } = image
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('PNG dimensions must be positive integers')
  }
  if (!Buffer.isBuffer(pixels) || pixels.length !== width * height * 4) {
    throw new Error(`expected ${width * height * 4} RGBA bytes`)
  }

  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const outputOffset = y * (stride + 1)
    raw[outputOffset] = 0
    pixels.copy(raw, outputOffset + 1, y * stride, (y + 1) * stride)
  }

  return Buffer.concat([
    SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

module.exports = { decodePng, encodePng }
