const { ipcRenderer } = require('electron')

window.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('pointerdown', () => ipcRenderer.send('focus-probe:pointer'))
})
