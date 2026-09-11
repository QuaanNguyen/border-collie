'use strict'

const { scales } = require('./pet-config.json')

function parseSizeArgument(value) {
  const text = String(value || '').trim().toLowerCase()
  if (text === 'reset') return { scale: 1, percent: 100 }
  const match = /^(\d+(?:\.\d+)?)%?$/.exec(text)
  if (!match) return null
  const percent = Number(match[1])
  const scale = percent / 100
  if (!scales.includes(scale)) return null
  return { scale, percent }
}

module.exports = { parseSizeArgument }
