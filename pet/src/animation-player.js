'use strict'

;(function () {
  function normalizeTrack(name, value) {
    if (!value || !Array.isArray(value.frames) || value.frames.length === 0) {
      throw new Error(`animation ${name} must contain frames`)
    }
    if (!value.frames.every((frame) => typeof frame === 'string' && frame.length > 0)) {
      throw new Error(`animation ${name} contains an invalid frame`)
    }
    if (!Array.isArray(value.frameDurationsMs) || value.frameDurationsMs.length !== value.frames.length) {
      throw new Error(`animation ${name} must provide one duration per frame`)
    }
    if (!value.frameDurationsMs.every((duration) => Number.isFinite(duration) && duration > 0 && duration <= 60_000)) {
      throw new Error(`animation ${name} contains an invalid frame duration`)
    }
    return {
      frames: [...value.frames],
      frameDurationsMs: [...value.frameDurationsMs],
    }
  }

  function normalizeTracks(value) {
    if (!value || typeof value !== 'object') throw new Error('animations must be an object')
    const tracks = Object.fromEntries(
      Object.entries(value).map(([name, track]) => [name, normalizeTrack(name, track)]),
    )
    if (!tracks.calm) throw new Error('animations must include calm')
    return tracks
  }

  function browserLoadFrame(src) {
    return new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = resolve
      image.onerror = () => reject(new Error(`could not load animation frame ${src}`))
      image.src = src
    })
  }

  function createAnimationPlayer(options) {
    const target = options.target
    const now = options.now || (() => performance.now())
    const setTimeoutFn = options.setTimeout || setTimeout
    const clearTimeoutFn = options.clearTimeout || clearTimeout
    const loadFrame = options.loadFrame || browserLoadFrame
    let tracks = {}
    let desiredState = null
    let activeTrack = null
    let startedAt = 0
    let timer = null
    let reducedMotion = !!options.reducedMotion
    let loadRequest = 0

    function clearTimer() {
      if (timer == null) return
      clearTimeoutFn(timer)
      timer = null
    }

    function selectedTrack() {
      return tracks[desiredState] || tracks.calm || null
    }

    function draw() {
      timer = null
      const track = activeTrack
      if (!track) {
        target.hidden = true
        target.removeAttribute('src')
        return
      }
      if (reducedMotion) {
        target.src = track.frames[0]
        target.hidden = false
        return
      }
      const total = track.frameDurationsMs.reduce((sum, duration) => sum + duration, 0)
      const elapsed = Math.max(0, now() - startedAt)
      const position = elapsed % total
      let boundary = 0
      let index = 0
      for (; index < track.frames.length; index += 1) {
        boundary += track.frameDurationsMs[index]
        if (position < boundary) break
      }
      target.src = track.frames[Math.min(index, track.frames.length - 1)]
      target.hidden = false
      timer = setTimeoutFn(draw, Math.max(1, boundary - position))
    }

    function restart() {
      clearTimer()
      activeTrack = selectedTrack()
      startedAt = now()
      draw()
    }

    async function replaceTracks(value) {
      const request = loadRequest + 1
      loadRequest = request
      const next = normalizeTracks(value)
      const frames = [...new Set(Object.values(next).flatMap((track) => track.frames))]
      await Promise.all(frames.map((frame) => loadFrame(frame)))
      if (request !== loadRequest) return false
      tracks = next
      restart()
      return true
    }

    function play(state) {
      if (desiredState === state && activeTrack === selectedTrack()) return
      desiredState = state
      restart()
    }

    function setReducedMotion(value) {
      const next = !!value
      if (next === reducedMotion) return
      reducedMotion = next
      restart()
    }

    function stop() {
      clearTimer()
      desiredState = null
      activeTrack = null
      target.hidden = true
      target.removeAttribute('src')
    }

    return { replaceTracks, play, setReducedMotion, stop }
  }

  const interfaceValue = { createAnimationPlayer }
  if (typeof window !== 'undefined') window.BorderCollieAnimation = interfaceValue
  if (typeof module !== 'undefined') module.exports = interfaceValue
})()
