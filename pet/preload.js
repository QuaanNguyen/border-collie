'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const pendingEvents = [];
let eventHandler = null;

ipcRenderer.on('bordercollie:event', (_event, value) => {
  if (eventHandler) eventHandler(value);
  else pendingEvents.push(value);
});

contextBridge.exposeInMainWorld('bordercollie', {
  config: () => ipcRenderer.invoke('bordercollie:config'),
  devScenarios: () => ipcRenderer.invoke('bordercollie:dev-scenarios'),
  triggerDevEvent: (id) => ipcRenderer.invoke('bordercollie:dev-event', id),
  setHitRegions: (regions, dragRegions) => ipcRenderer.send('bordercollie:hit-regions', regions, dragRegions),
  setScale: (s) => ipcRenderer.send('bordercollie:scale-set', s),
  onScaled: (fn) => ipcRenderer.on('bordercollie:scaled', (_e, pct) => fn(pct)),
  startDrag: (x, y) => ipcRenderer.send('bordercollie:drag-start', x, y),
  dragTo: (x, y) => ipcRenderer.send('bordercollie:drag-to', x, y),
  endDrag: () => ipcRenderer.send('bordercollie:drag-end'),
  onDrag: (fn) => ipcRenderer.on('bordercollie:dragging', (_event, drag) => fn(drag)),
  onEvent: (fn) => {
    eventHandler = fn;
    while (pendingEvents.length) fn(pendingEvents.shift());
  },
});
