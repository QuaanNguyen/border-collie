const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'border-collie-liveness-'))
  const envKeys = ['BORDER_COLLIE_NO_PET', 'BORDER_COLLIE_OWNER_CONFIG', 'BORDER_COLLIE_EVENTS']
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
  const eventPath = path.join(tempDir, 'events.jsonl')
  fs.mkdirSync(ownerConfigDir, { recursive: true })
  fs.writeFileSync(path.join(ownerConfigDir, 'policy.json'), JSON.stringify({
    schema_version: 1,
    setup_package: 'research-safe',
    trusted_workspace_roots: [],
  }))
  process.env.BORDER_COLLIE_NO_PET = '1'
  process.env.BORDER_COLLIE_OWNER_CONFIG = ownerConfigDir
  process.env.BORDER_COLLIE_EVENTS = eventPath

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
  const { BorderCollie } = await import(path.join(ROOT, 'plugin', 'border-collie.js'))
  const hooks = await BorderCollie({ client, directory: tempDir })
  await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 'finished-session' } } })
  const events = fs.readFileSync(eventPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  assert.ok(events.some((event) => (
    event.type === 'run'
    && event.status === 'finish'
    && event.petState === 'celebrating'
  )), 'a normally completed OpenCode turn must trigger the celebration animation')
  process.stdout.write('ok - a normally completed OpenCode turn triggers celebration\n')
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
  process.env.BORDER_COLLIE_NO_PET = '1'
  process.env.BORDER_COLLIE_OWNER_CONFIG = ownerConfigDir
  process.env.BORDER_COLLIE_EVENTS = path.join(tempDir, 'events.jsonl')

  let messageReads = 0
  let promptCalls = 0
  const promptBodies = []
  const client = {
    session: {
      messages: async () => {
        messageReads += 1
        return [{
          info: { id: `assistant-${messageReads}`, role: 'assistant', finish: 'stop', time: { completed: Date.now() } },
          parts: [{ text: 'The requested work is ready.' }],
        }]
      },
      prompt: async (request) => {
        promptCalls += 1
        promptBodies.push(request.body)
        return new Promise(() => {})
      },
    },
  }
  const { BorderCollie } = await import(path.join(ROOT, 'plugin', 'border-collie.js'))
  const hooks = await BorderCollie({ client, directory: tempDir })
  const config = {}
  await hooks.config(config)
  assert.match(config.command.size.description, /reset/)
  const sizeParts = []
  const sizeOutput = { parts: sizeParts }
  await hooks['command.execute.before'](
    { command: 'size', sessionID: 'session-1', arguments: '115' },
    sizeOutput,
  )
  assert.equal(sizeOutput.noReply, undefined)
  assert.strictEqual(sizeOutput.parts, sizeParts)
  assert.match(sizeOutput.parts[0].text, /115%/)
  const sizeEvent = fs.readFileSync(process.env.BORDER_COLLIE_EVENTS, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .find((event) => event.type === 'control')
  assert.deepStrictEqual(sizeEvent.detail, { action: 'size', scale: 1.15, percent: 115 })
  const preservedHooks = await BorderCollie({ client: {}, directory: tempDir })
  const existingSize = { template: 'existing', description: 'User-defined size command' }
  const preservedConfig = { command: { size: existingSize } }
  await preservedHooks.config(preservedConfig)
  assert.strictEqual(preservedConfig.command.size, existingSize)
  const preservedOutput = { parts: [] }
  await preservedHooks['command.execute.before'](
    { command: 'size', sessionID: 'session-existing-size', arguments: '115' },
    preservedOutput,
  )
  assert.deepStrictEqual(preservedOutput, { parts: [] })
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
  await hooks.event({
    event: {
      type: 'session.idle',
      properties: { sessionID: 'session-3' },
    },
  })
  await new Promise((resolve) => setTimeout(resolve, 25))
  const recordedEvents = fs.readFileSync(process.env.BORDER_COLLIE_EVENTS, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  assert.ok(
    recordedEvents.some((event) => event.summary === 'Completion feedback could not be recorded'),
    'synchronous feedback failures must remain non-blocking and observable',
  )

  const transportBlocker = path.join(tempDir, 'transport-blocker')
  const invalidWorkspace = path.join(tempDir, 'invalid-workspace')
  fs.writeFileSync(transportBlocker, 'not a directory\n')
  fs.mkdirSync(path.join(invalidWorkspace, '.opencode'), { recursive: true })
  fs.writeFileSync(path.join(invalidWorkspace, '.opencode', 'protocol.json'), '{ invalid json\n')
  process.env.BORDER_COLLIE_EVENTS = path.join(transportBlocker, 'events.jsonl')

  const hooksWithoutPetDelivery = await BorderCollie({ client: {}, directory: invalidWorkspace })
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
