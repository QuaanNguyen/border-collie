const fs = require('fs')
const path = require('path')
const { app, BrowserWindow, ipcMain, screen } = require('electron')

const statusPath = process.argv.at(-1)
let win
let pointerDowns = 0
let ready = false

process.on('SIGTERM', () => app.quit())

function writeStatus() {
  fs.writeFileSync(statusPath, JSON.stringify({
    ready,
    focused: win.isFocused(),
    pointerDowns,
    bounds: win.getBounds(),
    workArea: screen.getPrimaryDisplay().workArea,
  }))
}

app.whenReady().then(() => {
  const workArea = screen.getPrimaryDisplay().workArea
  win = new BrowserWindow({
    ...workArea,
    frame: false,
    show: false,
    backgroundColor: '#263238',
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })
  ipcMain.on('focus-probe:pointer', (event) => {
    if (event.sender !== win.webContents) return
    pointerDowns += 1
    writeStatus()
  })
  win.loadURL('data:text/html,<title>Border Collie focus probe</title><body></body>')
  win.on('focus', writeStatus)
  win.on('blur', writeStatus)
  win.once('ready-to-show', () => {
    ready = true
    win.show()
    win.focus()
    writeStatus()
  })
})
