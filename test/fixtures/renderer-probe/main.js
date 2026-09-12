const fs = require('fs')
const path = require('path')
const { app, BrowserWindow, ipcMain } = require('electron')

const root = process.argv.at(-3)
const statusPath = process.argv.at(-2)
const eventPath = process.argv.at(-1)
const frame = process.env.BORDER_COLLIE_TEST_FRAME
const { watchInbox } = require(path.join(root, 'events'))
let watcher

function writeStatus(status) {
  fs.writeFileSync(statusPath, JSON.stringify(status))
}

async function rendererStatus(win) {
  return win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const deadline = Date.now() + 3000
      const read = () => {
        const image = document.getElementById('animation')
        if (!image.hidden && image.complete && image.naturalWidth) {
          const regions = window.BorderCollieHitRegions.imageHitRegions(image)
          const rect = image.getBoundingClientRect()
          const transform = getComputedStyle(image).transform
          const contains = (point) => regions.some((region) =>
            point.x >= region.x && point.x < region.x + region.width &&
            point.y >= region.y && point.y < region.y + region.height
          )
          resolve({
            state: window.__borderCollie.rendered(),
            regionCount: regions.length,
            horizontalScale: transform === 'none' ? 1 : new DOMMatrix(transform).a,
            horizontalCenterOffset: rect.x + rect.width / 2 - window.innerWidth / 2,
            cornerReceivesInput: contains({ x: rect.x + 1, y: rect.y + 1 }),
            centerReceivesInput: contains({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }),
            imageDraggable: typeof window.borderCollie.startDrag === 'function',
            hasPersistentChrome: Boolean(document.querySelector('.tray, .counts, .log')),
            bubbleVisible: !document.getElementById('bubble').hidden,
            bubbleColor: getComputedStyle(document.getElementById('bubble-text')).color,
            bubbleRadius: parseFloat(getComputedStyle(document.getElementById('bubble')).borderRadius),
            bubbleBorderWidths: [
              getComputedStyle(document.getElementById('bubble')).borderTopWidth,
              getComputedStyle(document.getElementById('bubble')).borderRightWidth,
              getComputedStyle(document.getElementById('bubble')).borderBottomWidth,
              getComputedStyle(document.getElementById('bubble')).borderLeftWidth,
            ],
          })
          return
        }
        if (Date.now() >= deadline) {
          resolve({ state: window.__borderCollie.rendered(), regionCount: 0 })
          return
        }
        setTimeout(read, 25)
      }
      read()
    })
  `)
}

async function waitForState(win, state) {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    const status = await rendererStatus(win)
    if (status.state === state) return status
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`renderer did not reach ${state}`)
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

process.on('SIGTERM', () => app.quit())

app.whenReady().then(async () => {
  ipcMain.handle('borderCollie:config', () => ({
    animations: {
      calm: {
        frames: [frame, frame, frame, frame, frame],
        frameDurationsMs: [140, 140, 140, 140, 280],
      },
      allowed: {
        frames: [frame, frame, frame, frame, frame],
        frameDurationsMs: [140, 140, 140, 140, 280],
      },
      denied: {
        frames: [frame, frame, frame, frame, frame],
        frameDurationsMs: [140, 140, 140, 140, 280],
      },
    },
    dev: false,
    eventsFile: eventPath,
  }))
  for (const channel of ['borderCollie:hit-regions', 'borderCollie:scale-set']) {
    ipcMain.on(channel, () => {})
  }

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(root, 'pet', 'preload.js'),
    },
  })

  try {
    await win.loadFile(path.join(root, 'pet', 'src', 'index.html'))
    await rendererStatus(win)
    win.webContents.send('borderCollie:dragging', { phase: 'start', deltaX: 0 })
    win.webContents.send('borderCollie:dragging', { phase: 'move', deltaX: -24 })
    const leftDrag = await waitForState(win, 'drag')
    await delay(600)
    const heldDrag = await rendererStatus(win)
    win.webContents.send('borderCollie:dragging', { phase: 'move', deltaX: 24 })
    const rightDrag = await waitForState(win, 'drag')
    win.webContents.send('borderCollie:dragging', { phase: 'end', deltaX: 0 })
    await delay(50)
    const endedDrag = await rendererStatus(win)
    watcher = watchInbox(eventPath, async (event) => {
      try {
        win.webContents.send('borderCollie:event', event)
        const status = await waitForState(win, event.petState)
        writeStatus({
          ...status,
          ready: true,
          eventRunId: event.runId,
          leftDragScale: leftDrag.horizontalScale,
          rightDragScale: rightDrag.horizontalScale,
          dragHeldDuringPause: heldDrag.state === 'drag',
          dragEnded: endedDrag.state !== 'drag',
        })
        watcher.close()
        app.quit()
      } catch (error) {
        writeStatus({ error: error.message })
        app.quit()
      }
    }, { interval: 25 })
    writeStatus({
      ready: true,
      leftDragScale: leftDrag.horizontalScale,
      rightDragScale: rightDrag.horizontalScale,
      dragHeldDuringPause: heldDrag.state === 'drag',
      dragEnded: endedDrag.state !== 'drag',
    })
  } catch (error) {
    writeStatus({ error: error.message })
    app.quit()
  }
})

app.on('will-quit', () => {
  if (watcher) watcher.close()
})
