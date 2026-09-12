const assert = require('assert')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const { installPlugin } = require('../../scripts/install-plugin')

function runOpenCode(args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.platform === 'win32' ? 'opencode.exe' : 'opencode', args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let killTimer
    let settleTimer
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    const clearTimers = () => {
      clearTimeout(timer)
      clearTimeout(killTimer)
      clearTimeout(settleTimer)
    }
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      killTimer = setTimeout(() => {
        child.kill('SIGKILL')
        settleTimer = setTimeout(() => {
          clearTimers()
          reject(new Error(`OpenCode did not exit after timeout\n${stderr}`))
        }, 1000)
      }, 1000)
    }, options.timeoutMs)
    child.once('error', (error) => {
      clearTimers()
      reject(error)
    })
    child.once('exit', (code, signal) => {
      clearTimers()
      resolve({ code, signal, stdout, stderr })
    })
  })
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'border-collie-opencode-session-'))
  const configRoot = path.join(root, 'config')
  const configDir = path.join(configRoot, 'opencode')
  const dataRoot = path.join(root, 'data')
  const cacheRoot = path.join(root, 'cache')
  const ownerConfigDir = path.join(root, 'owner')
  const eventPath = path.join(root, 'events.jsonl')
  const modelRequests = []
  fs.mkdirSync(configDir, { recursive: true })
  fs.mkdirSync(ownerConfigDir, { recursive: true })
  fs.writeFileSync(path.join(ownerConfigDir, 'policy.json'), JSON.stringify({
    schema_version: 1,
    setup_package: 'custom',
    trusted_workspace_roots: [],
    done_criteria: [{
      id: 'output',
      describe: 'output exists',
      claim_verbs: ['fixed'],
      claim_mentions: ['output'],
      checks: [{ type: 'file_exists', path: path.join(root, 'missing-output.txt') }],
    }],
  }))

  const server = http.createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      const modelRequest = JSON.parse(body)
      modelRequests.push(modelRequest)
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      const created = Math.floor(Date.now() / 1000)
      const isTitleRequest = modelRequest.messages.some((message) =>
        message.role === 'system' && message.content.includes('title generator'))
      const isResizeRequest = modelRequest.messages.some((message) =>
        message.role === 'user' && message.content === 'Border Collie size set to 115%.')
      const conversationNumber = modelRequests.filter((candidate) => {
        const messages = JSON.stringify(candidate.messages)
        return !messages.includes('title generator') && !candidate.messages.some((message) =>
          message.role === 'user' && message.content === 'Border Collie size set to 115%.')
      }).length
      const content = isTitleRequest
        ? 'Completion observation test'
        : isResizeRequest
          ? 'Pet resized.'
        : conversationNumber === 1
          ? 'The requested work is ready.'
          : 'pong'
      const chunks = [
        { id: 'chatcmpl-border-collie', object: 'chat.completion.chunk', created, model: 'echo', choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] },
        { id: 'chatcmpl-border-collie', object: 'chat.completion.chunk', created, model: 'echo', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
      ]
      for (const chunk of chunks) response.write(`data: ${JSON.stringify(chunk)}\n\n`)
      response.end('data: [DONE]\n\n')
    })
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  try {
    const port = server.address().port
    fs.writeFileSync(path.join(configDir, 'opencode.json'), JSON.stringify({
      model: 'mock/echo',
      provider: {
        mock: {
          npm: '@ai-sdk/openai-compatible',
          name: 'Border Collie local test model',
          options: {
            apiKey: 'local-test',
            baseURL: `http://127.0.0.1:${port}/v1`,
          },
          models: {
            echo: {
              name: 'Echo',
              limit: { context: 8000, output: 1000 },
            },
          },
        },
      },
    }))

    process.env.XDG_CONFIG_HOME = configRoot
    process.env.XDG_DATA_HOME = dataRoot
    process.env.XDG_CACHE_HOME = cacheRoot
    process.env.BORDER_COLLIE_NO_PET = '1'
    process.env.BORDER_COLLIE_OWNER_CONFIG = ownerConfigDir
    process.env.BORDER_COLLIE_EVENTS = eventPath

    installPlugin({
      repoRoot: ROOT,
      destDir: path.join(configDir, 'plugins'),
      ownerConfigDir,
      verifyOpenCode: true,
    })

    const resize = await runOpenCode(
      ['run', '--command', 'size', '-m', 'mock/echo', '--format', 'json', '115'],
      { cwd: root, env: { ...process.env }, timeoutMs: 15000 },
    )
    assert.strictEqual(resize.signal, null, 'OpenCode size command timed out')
    assert.strictEqual(resize.code, 0, resize.stderr)
    assert.match(resize.stdout, /Pet resized\./)
    const resizeRequests = modelRequests.filter((request) => request.messages.some((message) =>
      message.role === 'user' && message.content === 'Border Collie size set to 115%.') && !request.messages.some((message) =>
      message.role === 'system' && message.content.includes('title generator')))
    assert.strictEqual(resizeRequests.length, 1, 'OpenCode must dispatch the custom size command once')
    const resizeEvent = fs.readFileSync(eventPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
      .find((event) => event.type === 'control' && event.detail?.action === 'size')
    assert.deepStrictEqual(resizeEvent.detail, { action: 'size', scale: 1.15, percent: 115 })
    fs.writeFileSync(eventPath, '')

    const started = Date.now()
    const first = await runOpenCode(
      ['run', '-m', 'mock/echo', '--format', 'json', 'Produce the output'],
      { cwd: root, env: { ...process.env }, timeoutMs: 15000 },
    )
    const completionObserved = await waitFor(() => {
      if (!fs.existsSync(eventPath)) return false
      const events = fs.readFileSync(eventPath, 'utf8')
      return events.includes('"type":"verdict"') && events.includes('"status":"fail"')
    })
    fs.writeFileSync(path.join(root, 'missing-output.txt'), 'ready\n')
    const second = await runOpenCode(
      ['run', '--continue', '-m', 'mock/echo', '--format', 'json', 'Reply with pong again'],
      { cwd: root, env: { ...process.env }, timeoutMs: 15000 },
    )
    const elapsedMs = Date.now() - started

    assert.strictEqual(first.signal, null, 'first OpenCode turn timed out')
    assert.strictEqual(first.code, 0, first.stderr)
    assert.match(first.stdout, /"text":"The requested work is ready\."/)
    assert.strictEqual(completionObserved, true)
    assert.strictEqual(second.signal, null, 'post-idle OpenCode turn timed out')
    assert.strictEqual(second.code, 0, second.stderr)
    assert.match(second.stdout, /"text":"pong"/)
    let completionAccepted
    try {
      completionAccepted = await waitFor(() => {
        const events = fs.readFileSync(eventPath, 'utf8')
        return events.includes('"type":"verdict"')
          && events.includes('"status":"pass"')
          && events.includes('"petState":"celebrating"')
      })
    } catch (error) {
      throw new Error(`${error.message}\n${fs.readFileSync(eventPath, 'utf8')}`)
    }
    assert.strictEqual(completionAccepted, true)
    const conversationRequests = modelRequests.filter((request) => !request.messages.some((message) =>
      message.role === 'system' && message.content.includes('title generator')) &&
      !request.messages.some((message) => message.role === 'user' && message.content === 'Border Collie size set to 115%.'))
    assert.strictEqual(conversationRequests.length, 2, 'completion feedback must not recursively start a model turn')
    assert.match(JSON.stringify(conversationRequests[1]), /Guard did not accept this as done/)
    assert.ok(elapsedMs < 15000, `OpenCode response took ${elapsedMs}ms`)
    process.stdout.write(`ok - installed OpenCode completion feedback stayed responsive and non-recursive in ${elapsedMs}ms\n`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    fs.rmSync(root, { recursive: true, force: true })
  }
}

async function waitFor(read, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (read()) return true
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('Timed out waiting for completion observation')
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`)
  process.exitCode = 1
})
