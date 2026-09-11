'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('borderCollie', {
  config: () => ipcRenderer.invoke('borderCollie:config'),
  setHitRegions: (regions, dragRegions) => ipcRenderer.send('borderCollie:hit-regions', regions, dragRegions),
  setScale: (s) => ipcRenderer.send('borderCollie:scale-set', s),
  onScaled: (fn) => ipcRenderer.on('borderCollie:scaled', (_e, pct) => fn(pct)),
  startDrag: (x, y) => ipcRenderer.send('borderCollie:drag-start', x, y),
  dragTo: (x, y) => ipcRenderer.send('borderCollie:drag-to', x, y),
  endDrag: () => ipcRenderer.send('borderCollie:drag-end'),
  onDrag: (fn) => ipcRenderer.on('borderCollie:dragging', (_event, drag) => fn(drag)),
  onEvent: (fn) => ipcRenderer.on('borderCollie:event', (_e, evt) => fn(evt)),
});
