const assert = require('assert')
const { createWindowInteraction } = require('../pet/lib/window-interaction')
const { regionsFromAlpha, placeAlphaRegions } = require('../pet/src/hit-regions')
const { parseSizeArgument } = require('../events/size-command')

assert.deepStrictEqual(parseSizeArgument('reset'), { scale: 1, percent: 100 })
assert.deepStrictEqual(parseSizeArgument('115%'), { scale: 1.15, percent: 115 })
assert.strictEqual(parseSizeArgument('120'), null)

const pixels = new Uint8ClampedArray(4 * 3 * 4)
for (const [x, y] of [[0, 0], [1, 0], [0, 1], [3, 2]]) {
  pixels[(y * 4 + x) * 4 + 3] = 255
}
const opaque = regionsFromAlpha(pixels, 4, 3)
assert.strictEqual(opaque.some((region) =>
  2 >= region.x && 2 < region.x + region.width &&
  1 >= region.y && 1 < region.y + region.height), false)
assert.strictEqual(opaque.some((region) =>
  3 >= region.x && 3 < region.x + region.width &&
  2 >= region.y && 2 < region.y + region.height), true)

const reflected = placeAlphaRegions(
  [{ x: 0, y: 0, width: 1, height: 1 }],
  4,
  3,
  { x: 100, y: 200, width: 40, height: 30 },
  true,
)
assert.deepStrictEqual(reflected, [{ x: 130, y: 200, width: 10, height: 10 }])

const calls = []
let cursor = { x: 1250, y: 750 }
let scale = 1
const win = {
  getBounds: () => ({ x: 1000, y: 500, width: 340, height: 380 }),
  isDestroyed: () => false,
  isVisible: () => true,
  setIgnoreMouseEvents: (ignore, options) => calls.push({ ignore, options }),
}
const screen = {
  getCursorScreenPoint: () => cursor,
}

const interaction = createWindowInteraction({
  win,
  screen,
  getScale: () => scale,
  setInterval: () => 1,
  clearInterval: () => {},
})

interaction.updateRegions([{ x: 95, y: 130, width: 150, height: 225 }])
interaction.tick()
assert.deepStrictEqual(calls.at(-1), {
  ignore: true,
  options: { forward: true },
})

cursor = { x: 1170, y: 730 }
interaction.tick()
assert.deepStrictEqual(calls.at(-1), {
  ignore: false,
  options: undefined,
})

cursor = { x: 1335, y: 875 }
interaction.tick()
assert.deepStrictEqual(calls.at(-1), {
  ignore: true,
  options: { forward: true },
})

scale = 2
cursor = { x: 1340, y: 960 }
interaction.tick()
assert.deepStrictEqual(calls.at(-1), {
  ignore: false,
  options: undefined,
})

interaction.updateRegions([{ x: 10, y: 10, width: 20, height: 20 }])
assert.deepStrictEqual(calls.at(-1), {
  ignore: true,
  options: { forward: true },
})

interaction.setDragging(true)
assert.deepStrictEqual(calls.at(-1), {
  ignore: false,
  options: undefined,
})

interaction.setDragging(false)
assert.deepStrictEqual(calls.at(-1), {
  ignore: true,
  options: { forward: true },
})

interaction.stop()
process.stdout.write('ok - only opaque Pet pixels and visible controls receive mouse input\n')
