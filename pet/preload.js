'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('borderCollie', {
  config: () => ipcRenderer.invoke('borderCollie:config'),
  quit: () => ipcRenderer.send('borderCollie:quit'),
  hide: () => ipcRenderer.send('borderCollie:hide'),
  open: (url) => ipcRenderer.send('borderCollie:open', url),

  // The window is sized by main, not by CSS: it has to grow the OS window and
  // the zoom factor together, or the pet gets clipped.
  setLogOpen: (open) => ipcRenderer.send('borderCollie:log', open),
  scaleStep: (dir) => ipcRenderer.send('borderCollie:scale-step', dir),
  setScale: (s) => ipcRenderer.send('borderCollie:scale-set', s),
  onScaled: (fn) => ipcRenderer.on('borderCollie:scaled', (_e, pct) => fn(pct)),

  // The OS moves the window through -webkit-app-region, so the renderer never
  // sees a mousemove. Main forwards window moves instead.
  onDrag: (fn) => ipcRenderer.on('borderCollie:dragging', () => fn()),

  // Plugin mode has no port to subscribe to: Guard runs inside the harness and
  // appends to a file, main tails it, and each event arrives here instead.
  onEvent: (fn) => ipcRenderer.on('borderCollie:event', (_e, evt) => fn(evt)),
});
