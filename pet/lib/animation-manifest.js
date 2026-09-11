'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`could not read animation manifest ${file}: ${error.message}`)
  }
}

function validDurations(name, durations) {
  if (!Array.isArray(durations) || durations.length === 0) {
    throw new Error(`animation ${name} must provide frame durations`)
  }
  if (!durations.every((duration) => Number.isFinite(duration) && duration > 0 && duration <= 60_000)) {
    throw new Error(`animation ${name} contains an invalid frame duration`)
  }
}

function safeFolder(name, folder) {
  if (typeof folder !== 'string' || folder.length === 0 || path.basename(folder) !== folder || folder === '.' || folder === '..') {
    throw new Error(`animation ${name} contains an invalid folder`)
  }
}

function loadAnimationTracks(petDirectory, config) {
  if (!config || config.schemaVersion !== 1) throw new Error('unsupported Pet configuration')
  if (!config.animationTracks || typeof config.animationTracks !== 'object') {
    throw new Error('Pet configuration must define animation tracks')
  }
  if (!config.stateAnimations || typeof config.stateAnimations !== 'object' || !config.stateAnimations.calm) {
    throw new Error('Pet configuration must map the calm state')
  }

  const assetRoot = path.resolve(petDirectory, 'assets', 'default-animations')
  const manifest = readJson(path.join(assetRoot, 'manifest.json'))
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.frames)) {
    throw new Error('unsupported runtime animation manifest')
  }

  const tracks = {}
  for (const [name, track] of Object.entries(config.animationTracks)) {
    safeFolder(name, track?.folder)
    validDurations(name, track?.frameDurationsMs)
    const entries = manifest.frames
      .filter((frame) => frame.animation === name)
      .sort((left, right) => left.index - right.index)
    if (entries.length !== track.frameDurationsMs.length) {
      throw new Error(`animation ${name} frame and duration counts differ`)
    }
    const frames = entries.map((entry, offset) => {
      if (entry.index !== offset + 1 || typeof entry.file !== 'string') {
        throw new Error(`animation ${name} contains an invalid frame index`)
      }
      if (path.posix.dirname(entry.file) !== track.folder) {
        throw new Error(`animation ${name} frame is outside its configured folder`)
      }
      const file = path.resolve(assetRoot, entry.file)
      if (!file.startsWith(`${assetRoot}${path.sep}`) || !fs.statSync(file).isFile()) {
        throw new Error(`animation ${name} contains an unavailable frame`)
      }
      return pathToFileURL(file).href
    })
    tracks[name] = { frames, frameDurationsMs: [...track.frameDurationsMs] }
  }

  return Object.fromEntries(Object.entries(config.stateAnimations).map(([state, animation]) => {
    if (!tracks[animation]) throw new Error(`state ${state} refers to unknown animation ${animation}`)
    return [state, {
      frames: [...tracks[animation].frames],
      frameDurationsMs: [...tracks[animation].frameDurationsMs],
    }]
  }))
}

module.exports = { loadAnimationTracks }
