const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { pathToFileURL } = require('url')
const { spawn } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const PET_DIR = path.join(ROOT, 'pet')
const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'renderer-probe')
const electronPath = require(path.join(PET_DIR, 'node_modules', 'electron'))
const { EventBus } = require('../events')

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function readStatus(statusPath) {
  try {
    return JSON.parse(fs.readFileSync(statusPath, 'utf8'))
  } catch {
    return null
  }
}

async function waitFor(read, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = read()
    if (value) return value
    await delay(25)
  }
  throw new Error('Timed out waiting for the renderer event path')
}

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'border-collie-renderer-'))
  const statusPath = path.join(tempDir, 'status.json')
  const eventPath = path.join(tempDir, 'events.jsonl')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  env.BORDER_COLLIE_TEST_FRAME = pathToFileURL(path.join(
    PET_DIR,
    'assets',
    'default-animations',
    'border-collie-normal',
    'border-collie-normal-1.png',
  )).href

  let diagnostic = ''
  const child = spawn(electronPath, [FIXTURE_DIR, ROOT, statusPath, eventPath], {
    env,
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  child.stderr.on('data', (chunk) => { diagnostic += chunk })

  try {
    let ready
    try {
      ready = await waitFor(() => {
        const current = readStatus(statusPath)
        return current?.ready === true ? current : null
      })
    } catch (error) {
      throw new Error(`${error.message}${diagnostic ? `\n${diagnostic.trim()}` : ''}`)
    }
    assert.ok(ready.leftDragScale < 0, 'leftward dragging must mirror the running animation')
    assert.ok(ready.rightDragScale > 0, 'rightward dragging must keep the running animation facing right')
    assert.strictEqual(ready.dragHeldDuringPause, true, 'the running animation must last until mouse-up')
    assert.strictEqual(ready.dragEnded, true, 'mouse-up must end the running animation')
    const bus = new EventBus({ inboxPath: eventPath, runId: 'renderer-acceptance' })
    bus.emit({
      type: 'excursion',
      status: 'block',
      petState: 'denied',
      summary: 'outside the task',
      reason: 'the path is not allowed',
    })
    bus.close()

    const status = await waitFor(() => {
      const current = readStatus(statusPath)
      return current?.state === 'denied' ? current : null
    })
    assert.strictEqual(status.error, undefined, status.error)
    assert.ok(status.regionCount > 0, 'a real Pet frame must produce interactive alpha regions')
    assert.strictEqual(status.cornerReceivesInput, false, 'transparent image corners must pass input through')
    assert.strictEqual(status.centerReceivesInput, true, 'the visible Pet center must remain interactive')
    assert.strictEqual(status.imageDraggable, true, 'the entire visible Pet image must remain draggable')
    assert.ok(Math.abs(status.horizontalCenterOffset) < 0.01, `Pet image is ${status.horizontalCenterOffset}px off center`)
    assert.strictEqual(status.hasPersistentChrome, false, 'the Pet must not render a tray, counters, or a log')
    assert.strictEqual(status.bubbleVisible, true, 'a denial must show a speech bubble')
    assert.strictEqual(status.bubbleColor, 'rgb(180, 35, 24)', 'denial text must be red')
    assert.ok(status.bubbleRadius >= 14, 'the speech bubble must have soft edges')
    assert.strictEqual(new Set(status.bubbleBorderWidths).size, 1, 'the speech bubble must not have a colored side rail')
    assert.strictEqual(status.eventRunId, 'renderer-acceptance')
    await waitFor(() => child.exitCode !== null)
    assert.strictEqual(child.exitCode, 0)
    process.stdout.write('ok - directional dragging and the clean denial bubble render correctly\n')
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM')
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`)
  process.exitCode = 1
})
