const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn, spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const PET_DIR = path.join(ROOT, 'pet')
const FOCUS_FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'focus-probe')
const POINTER_SOURCE = path.join(__dirname, '..', 'fixtures', 'macos-pointer.swift')
const electronPath = require(path.join(PET_DIR, 'node_modules', 'electron'))
const { buildNativePet } = require('../../scripts/build-native-pet')
const { EventBus } = require('../../events')

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(read, timeoutMs = 10000, label = 'native window state') {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = read()
    if (value) return value
    await delay(50)
  }
  throw new Error(`Timed out waiting for ${typeof label === 'function' ? label() : label}`)
}

function readStatus(statusPath) {
  try {
    return JSON.parse(fs.readFileSync(statusPath, 'utf8'))
  } catch {
    return null
  }
}

function launchElectron(args, options = {}) {
  const env = { ...process.env, ...options.env }
  delete env.ELECTRON_RUN_AS_NODE
  const launchArgs = process.env.CI === 'true' && process.platform === 'linux'
    ? ['--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', ...args]
    : args
  return spawn(electronPath, launchArgs, {
    cwd: options.cwd || ROOT,
    env,
    stdio: 'ignore',
  })
}

function launchNative(executable, args) {
  const child = spawn(executable, args, {
    cwd: PET_DIR,
    stdio: ['pipe', 'ignore', 'pipe'],
  })
  child.diagnostic = ''
  child.stderr.on('data', (chunk) => { child.diagnostic += chunk })
  child.on('error', (error) => { child.diagnostic += error.message })
  return child
}

async function waitForExit(child, timeoutMs = 7000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const exited = await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(timeoutMs).then(() => false),
  ])
  if (exited === false && child.exitCode === null && child.signalCode === null) {
    throw new Error('Timed out waiting for a child process to quit')
  }
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  try {
    await waitForExit(child)
  } catch {
    child.kill('SIGKILL')
    await waitForExit(child, 2000)
  }
}

function compilePointerHelper(tempDir) {
  const executable = path.join(tempDir, 'macos-pointer')
  const result = spawnSync('/usr/bin/xcrun', ['swiftc', POINTER_SOURCE, '-o', executable], {
    encoding: 'utf8',
    timeout: 30000,
  })
  assert.strictEqual(result.status, 0, result.stderr || result.stdout)
  return executable
}

function findWindow(pointerHelper, pid) {
  const result = spawnSync(pointerHelper, ['find', String(pid)], {
    encoding: 'utf8',
    timeout: 3000,
  })
  if (result.status === 3) return null
  assert.strictEqual(result.status, 0, result.stderr || result.stdout)
  return JSON.parse(result.stdout)
}

function findControl(pointerHelper, pid, label) {
  const result = spawnSync(pointerHelper, ['find-control', String(pid), label], {
    encoding: 'utf8',
    timeout: 3000,
  })
  if (result.status === 3) return null
  assert.strictEqual(result.status, 0, result.stderr || result.stdout)
  return JSON.parse(result.stdout)
}

function sendNativeInput(pointerHelper, command, values = []) {
  const result = spawnSync(pointerHelper, [command, ...values.map(String)], {
    encoding: 'utf8',
    timeout: 5000,
  })
  assert.strictEqual(result.status, 0, result.stderr || result.stdout)
}

function frontmostProcess(pointerHelper) {
  const result = spawnSync(pointerHelper, ['frontmost'], { encoding: 'utf8', timeout: 3000 })
  assert.strictEqual(result.status, 0, result.stderr || result.stdout)
  return Number(result.stdout)
}

async function probeReceivedPointer(statusPath, previousCount, timeoutMs = 400) {
  try {
    await waitFor(
      () => readStatus(statusPath)?.pointerDowns > previousCount,
      timeoutMs,
      'the background app to receive a pointer event',
    )
    return true
  } catch {
    return false
  }
}

async function findVisiblePetPoint(pointerHelper, statusPath, bounds, expected, diagnostic = () => '') {
  const point = await waitFor(
    () => {
      const point = findControl(pointerHelper, bounds.pid, 'xor sprite')
      if (!point || (expected && Math.hypot(point.x - expected.x, point.y - expected.y) > 2)) return null
      return point
    },
    4000,
    'the visible Pet sprite accessibility frame',
  )
  const previousCount = readStatus(statusPath).pointerDowns
  sendNativeInput(pointerHelper, 'click', [point.x, point.y])
  assert.strictEqual(
    await probeReceivedPointer(statusPath, previousCount),
    false,
    `the visible Pet center must receive pointer input at ${JSON.stringify(point)} inside ${JSON.stringify(bounds)} ${diagnostic()}`,
  )
  return point
}

async function main() {
  if (process.platform !== 'darwin') {
    process.stdout.write('ok - native non-activating Pet acceptance is macOS-only\n')
    return
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xor-focus-'))
  const statusPath = path.join(tempDir, 'focus.json')
  const eventPath = path.join(tempDir, 'events.jsonl')
  const pointerHelper = compilePointerHelper(tempDir)
  const nativePet = buildNativePet(PET_DIR, path.join(tempDir, 'pet-host'))
  let probe
  let pet
  let secondPet
  let devPet

  try {
    probe = launchElectron([`--user-data-dir=${path.join(tempDir, 'focus-user-data')}`, FOCUS_FIXTURE_DIR, statusPath])
    await waitFor(() => {
      const status = readStatus(statusPath)
      return status?.ready === true && status.focused === true ? status : null
    }, 10000, 'the focus probe to become ready')

    pet = launchNative(nativePet, [
      `--pet-dir=${PET_DIR}`,
      '--shortcut=Control+Alt+Shift+9',
    ])

    const initialBounds = await waitFor(
      () => findWindow(pointerHelper, pet.pid),
      10000,
      () => `the Pet window to become visible; exit=${pet.exitCode} signal=${pet.signalCode} ${pet.diagnostic}`,
    )
    assert.strictEqual(pet.exitCode, null, 'Pet should stay running')
    assert.strictEqual(readStatus(statusPath).focused, true, 'opening the Pet must not take focus from the active app')

    const transparentCount = readStatus(statusPath).pointerDowns
    sendNativeInput(pointerHelper, 'click', [initialBounds.x + 5, initialBounds.y + 5])
    await waitFor(
      () => readStatus(statusPath)?.pointerDowns === transparentCount + 1,
      2000,
      'transparent Pet space to pass the click through',
    )
    assert.strictEqual(readStatus(statusPath).focused, true, 'clicking transparent Pet space must preserve focus')

    const initialVisiblePoint = await findVisiblePetPoint(pointerHelper, statusPath, { ...initialBounds, pid: pet.pid }, null, () => pet.diagnostic.slice(-6000))
    assert.strictEqual(
      readStatus(statusPath).focused,
      true,
      `clicking visible Pet pixels must preserve focus; frontmost=${frontmostProcess(pointerHelper)} probe=${probe.pid} pet=${pet.pid}`,
    )

    const sizeBus = new EventBus({ sink: (event) => pet.stdin.write(JSON.stringify(event) + '\n'), runId: 'native-size-command' })
    sizeBus.emit({
      type: 'control',
      status: 'ok',
      petState: 'calm',
      summary: 'Pet size 115%',
      detail: { action: 'size', scale: 1.15, percent: 115 },
    })
    sizeBus.close()
    const scaledBounds = await waitFor(() => {
      const bounds = findWindow(pointerHelper, pet.pid)
      return bounds && bounds.width > initialBounds.width ? bounds : null
    }, 3000, 'the Pet to resize through its control event')
    assert.strictEqual(readStatus(statusPath).focused, true, 'resizing the Pet must preserve focus')
    const scaledTransparentCount = readStatus(statusPath).pointerDowns
    sendNativeInput(pointerHelper, 'click', [scaledBounds.x + 5, scaledBounds.y + 5])
    await waitFor(
      () => readStatus(statusPath)?.pointerDowns === scaledTransparentCount + 1,
      2000,
      'scaled transparent Pet space to pass the click through',
    )
    const scaledVisiblePoint = await findVisiblePetPoint(pointerHelper, statusPath, { ...scaledBounds, pid: pet.pid }, {
      x: scaledBounds.x + (initialVisiblePoint.x - initialBounds.x) * scaledBounds.width / initialBounds.width,
      y: scaledBounds.y + (initialVisiblePoint.y - initialBounds.y) * scaledBounds.height / initialBounds.height,
    }, () => pet.diagnostic.slice(-6000))
    assert.strictEqual(readStatus(statusPath).focused, true, 'clicking scaled visible Pet pixels must preserve focus')
    sendNativeInput(pointerHelper, 'drag', [
      scaledVisiblePoint.x,
      scaledVisiblePoint.y,
      scaledVisiblePoint.x - 28,
      scaledVisiblePoint.y,
    ])
    const draggedBounds = await waitFor(() => {
      const bounds = findWindow(pointerHelper, pet.pid)
      return bounds && bounds.x <= scaledBounds.x - 14 ? bounds : null
    }, 4000, () => `the scaled visible Pet pixels at ${scaledVisiblePoint.x},${scaledVisiblePoint.y} to drag the window from ${JSON.stringify(scaledBounds)} to ${JSON.stringify(findWindow(pointerHelper, pet.pid))}`)
    assert.strictEqual(readStatus(statusPath).focused, true, 'dragging the scaled Pet must preserve focus')

    sendNativeInput(pointerHelper, 'shortcut', [25])
    await waitFor(
      () => findWindow(pointerHelper, pet.pid) === null,
      3000,
      'the Pet to hide through its global shortcut',
    )
    assert.strictEqual(readStatus(statusPath).focused, true, 'hiding the Pet must preserve focus')
    sendNativeInput(pointerHelper, 'shortcut', [25])
    await waitFor(
      () => findWindow(pointerHelper, pet.pid),
      3000,
      'the Pet to reappear through its global shortcut',
    )
    assert.strictEqual(readStatus(statusPath).focused, true, 'restoring the Pet must preserve focus')

    secondPet = launchNative(nativePet, [
      `--pet-dir=${PET_DIR}`,
      '--shortcut=Control+Alt+Shift+R',
    ])
    await waitFor(() => findWindow(pointerHelper, secondPet.pid), 10000, 'the second session Pet to become visible')
    assert.strictEqual(secondPet.exitCode, null, 'a concurrent session must own its live Pet input')
    pet.stdin.end()
    await waitForExit(pet)
    assert.strictEqual(pet.exitCode, 0, 'closing the plugin input must end its Pet')
    assert.strictEqual(secondPet.exitCode, null, 'closing one session must not end another session Pet')
    assert.ok(findWindow(pointerHelper, secondPet.pid), 'the other session Pet must remain visible')
    secondPet.stdin.end()
    await waitForExit(secondPet)
    assert.strictEqual(secondPet.exitCode, 0, 'the second Pet must exit after its own input closes')

    devPet = launchElectron(['.', '--dev'], {
      cwd: PET_DIR,
      env: {
        XOR_EVENTS: eventPath,
        XOR_USER_DATA_DIR: path.join(tempDir, 'dev-user-data'),
      },
    })
    await waitFor(
      () => readStatus(statusPath)?.focused === false,
      10000,
      'the development Pet to take focus',
    )
    assert.strictEqual(devPet.exitCode, null, 'development Pet should stay running')
    assert.ok(draggedBounds.x < initialBounds.x)

    process.stdout.write('ok - native Pet pointer, focus, controls, visibility, drag, and independent session lifecycle verified\n')
  } finally {
    await stopChild(secondPet)
    await stopChild(pet)
    await stopChild(devPet)
    await stopChild(probe)
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`)
  process.exitCode = 1
})
