'use strict'

const assert = require('node:assert')
const path = require('node:path')
const config = require('../../events/pet-config.json')
const { loadAnimationTracks } = require('../../pet/lib/animation-manifest')

const ROOT = path.resolve(__dirname, '..', '..')
const PET_DIR = path.join(ROOT, 'pet')

const animations = loadAnimationTracks(PET_DIR, config)
assert.deepStrictEqual(Object.keys(animations).sort(), Object.keys(config.stateAnimations).sort())
assert.ok(animations.calm.frames.every((frame) => frame.startsWith('file:')))
assert.strictEqual(animations.calm.frames.length, animations.calm.frameDurationsMs.length)
assert.notStrictEqual(new Set(animations.calm.frameDurationsMs).size, 1)

const brokenDuration = structuredClone(config)
brokenDuration.animationTracks.normal.frameDurationsMs[0] = 0
assert.throws(() => loadAnimationTracks(PET_DIR, brokenDuration), /duration/)

const unknownTrack = structuredClone(config)
unknownTrack.stateAnimations.calm = 'missing'
assert.throws(() => loadAnimationTracks(PET_DIR, unknownTrack), /unknown animation/)

const escapedFolder = structuredClone(config)
escapedFolder.animationTracks.normal.folder = '../outside'
assert.throws(() => loadAnimationTracks(PET_DIR, escapedFolder), /folder/)

process.stdout.write('ok - runtime animation manifest validates every semantic state before activation\n')
