const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..', '..')

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bordercollie-liveness-'))
  const envKeys = ['BORDERCOLLIE_NO_PET', 'BORDERCOLLIE_OWNER_CONFIG', 'BORDERCOLLIE_EVENTS']
  const previousEnv = new Map(envKeys.map((key) => [key, process.env[key]]))
  try {
    await runScenario(tempDir)
    await runDefaultCompletionScenario(path.join(tempDir, 'default-completion'))
  } finally {
    process.emit('beforeExit')
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

async function runDefaultCompletionScenario(tempDir) {
  const ownerConfigDir = path.join(tempDir, 'owner')
  fs.mkdirSync(ownerConfigDir, { recursive: true })
  fs.writeFileSync(path.join(ownerConfigDir, 'policy.json'), JSON.stringify({
    schema_version: 1,
    setup_package: 'research-safe',
    trusted_workspace_roots: [],
  }))
  process.env.BORDERCOLLIE_NO_PET = '1'
  process.env.BORDERCOLLIE_OWNER_CONFIG = ownerConfigDir

  const client = {
    session: {
      messages: async () => [{
        info: {
          id: 'assistant-finished',
          role: 'assistant',
          finish: 'stop',
          time: { completed: Date.now() },
        },
        parts: [{ text: 'Here is the result.' }],
      }],
    },
  }
  const { Bordercollie } = await import(pathToFileURL(path.join(ROOT, 'plugin', 'bordercollie.js')).href)
  const hooks = await Bordercollie({ client, directory: tempDir })
  await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 'finished-session' } } })
  await new Promise((resolve) => setTimeout(resolve, 25))
  process.stdout.write('ok - a normally completed OpenCode turn settles without injected feedback\n')
}

async function runScenario(tempDir) {
  const ownerConfigDir = path.join(tempDir, 'owner')
  fs.mkdirSync(ownerConfigDir, { recursive: true })
  fs.writeFileSync(path.join(ownerConfigDir, 'policy.json'), JSON.stringify({
    schema_version: 1,
    setup_package: 'research-safe',
    trusted_workspace_roots: [],
    done_criteria: [{
      id: 'output',
      describe: 'output exists',
      claim_verbs: ['fixed'],
      claim_mentions: ['output'],
      checks: [{ type: 'file_exists', path: 'missing-output.txt' }],
    }],
  }))
  process.env.BORDERCOLLIE_NO_PET = '1'
  process.env.BORDERCOLLIE_OWNER_CONFIG = ownerConfigDir

  let messageReads = 0
  let promptCalls = 0
  const promptBodies = []
  const client = {
    session: {
      messages: async () => {
        messageReads += 1
        return [{
          info: { id: `assistant-${messageReads}`, role: 'assistant', finish: 'stop', time: { completed: Date.now() } },
          parts: [{ text: 'I fixed the output.' }],
        }]
      },
      prompt: async (request) => {
        promptCalls += 1
        promptBodies.push(request.body)
        return new Promise(() => {})
      },
    },
  }
  const { Bordercollie } = await import(pathToFileURL(path.join(ROOT, 'plugin', 'bordercollie.js')).href)
  const hooks = await Bordercollie({ client, directory: tempDir })
  await hooks.event({
    event: {
      type: 'message.updated',
      properties: { sessionID: 'session-1' },
    },
  })

  assert.strictEqual(messageReads, 0, 'streaming message updates must not trigger completion review')
  const returned = await Promise.race([
    hooks.event({
      event: {
        type: 'session.idle',
        properties: { sessionID: 'session-1' },
      },
    }).then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 100)),
  ])
  assert.strictEqual(returned, true, 'idle notification must not wait for an injected model turn')
  await hooks.event({
    event: {
      type: 'session.idle',
      properties: { sessionID: 'session-1' },
    },
  })
  await hooks.event({
    event: {
      type: 'session.idle',
      properties: { sessionID: 'session-2' },
    },
  })
  await new Promise((resolve) => setTimeout(resolve, 25))
  assert.strictEqual(messageReads, 2)
  assert.strictEqual(promptCalls, 2, 'completion review must be isolated and single-flight per session')
  assert.ok(promptBodies.every((body) => body.noReply === true), 'completion feedback must not trigger another model turn')

  client.session.prompt = () => {
    throw new Error('synchronous feedback failure')
  }
  client.session.messages = async () => [{
    info: { id: 'assistant-failing-feedback', role: 'assistant', finish: 'stop', time: { completed: Date.now() } },
    parts: [{ text: 'I fixed the output.' }],
  }]
  await hooks.event({
    event: {
      type: 'session.status',
      properties: { sessionID: 'session-3', status: 'busy' },
    },
  })
  const failureReturned = await Promise.race([
    hooks.event({
      event: {
        type: 'session.idle',
        properties: { sessionID: 'session-3' },
      },
    }).then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 100)),
  ])
  assert.strictEqual(failureReturned, true, 'synchronous feedback failures must remain non-blocking')

  const transportBlocker = path.join(tempDir, 'transport-blocker')
  const invalidWorkspace = path.join(tempDir, 'invalid-workspace')
  fs.writeFileSync(transportBlocker, 'not a directory\n')
  fs.mkdirSync(path.join(invalidWorkspace, '.opencode'), { recursive: true })
  fs.writeFileSync(path.join(invalidWorkspace, '.opencode', 'protocol.json'), '{ invalid json\n')

  const hooksWithoutPetDelivery = await Bordercollie({ client: {}, directory: invalidWorkspace })
  await assert.rejects(
    hooksWithoutPetDelivery['tool.execute.before'](
      { tool: 'read', sessionID: 'transport-failure' },
      { args: { path: 'README.md' } },
    ),
    /Guard refused this action/,
  )
  process.stdout.write('ok - streaming responses are not interrupted by completion review\n')
  process.stdout.write('ok - Pet delivery failure does not disable Guard enforcement\n')
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`)
  process.exitCode = 1
})
