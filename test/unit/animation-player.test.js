'use strict'

const assert = require('node:assert')
const { createAnimationPlayer } = require('../../pet/src/animation-player')

function createClock() {
  let time = 0
  let nextId = 1
  const timers = new Map()
  return {
    now: () => time,
    setTimeout(fn, delay) {
      const id = nextId
      nextId += 1
      timers.set(id, { at: time + delay, fn })
      return id
    },
    clearTimeout(id) {
      timers.delete(id)
    },
    advance(milliseconds) {
      time += milliseconds
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= time)
        .sort((left, right) => left[1].at - right[1].at)
      for (const [id, timer] of due) {
        timers.delete(id)
        timer.fn()
      }
    },
    pending: () => timers.size,
  }
}

function createTarget() {
  return {
    hidden: true,
    src: '',
    removeAttribute(name) {
      if (name === 'src') this.src = ''
    },
  }
}

async function main() {
  const clock = createClock()
  const target = createTarget()
  const player = createAnimationPlayer({
    target,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    loadFrame: async () => {},
  })

  await player.replaceTracks({
    calm: {
      frames: ['calm-1', 'calm-2', 'calm-3'],
      frameDurationsMs: [100, 200, 300],
    },
    allowed: {
      frames: ['allowed-1', 'allowed-2'],
      frameDurationsMs: [80, 120],
    },
  })

  player.play('calm')
  assert.strictEqual(target.src, 'calm-1')
  clock.advance(100)
  assert.strictEqual(target.src, 'calm-2')
  clock.advance(250)
  assert.strictEqual(target.src, 'calm-3')
  clock.advance(250)
  assert.strictEqual(target.src, 'calm-1')

  player.setReducedMotion(true)
  player.play('allowed')
  assert.strictEqual(target.src, 'allowed-1')
  assert.strictEqual(clock.pending(), 0)

  player.setReducedMotion(false)
  assert.strictEqual(clock.pending(), 1)

  await assert.rejects(
    player.replaceTracks({
      calm: {
        frames: ['broken'],
        frameDurationsMs: [0],
      },
    }),
    /duration/,
  )
  player.play('calm')
  assert.strictEqual(target.src, 'calm-1')

  let releaseSlow
  const slow = new Promise((resolve) => { releaseSlow = resolve })
  const racePlayer = createAnimationPlayer({
    target,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    loadFrame: (src) => src === 'slow' ? slow : Promise.resolve(),
  })
  const stale = racePlayer.replaceTracks({
    calm: { frames: ['slow'], frameDurationsMs: [100] },
  })
  const current = racePlayer.replaceTracks({
    calm: { frames: ['current'], frameDurationsMs: [100] },
  })
  assert.strictEqual(await current, true)
  releaseSlow()
  assert.strictEqual(await stale, false)
  racePlayer.play('calm')
  assert.strictEqual(target.src, 'current')

  process.stdout.write('ok - animation playback is time-based, atomic, race-safe, and motion-aware\n')
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`)
  process.exitCode = 1
})
