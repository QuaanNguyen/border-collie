'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const pendingEvents = [];
let eventHandler = null;

const onEvent = (_event, value) => {
  if (eventHandler) eventHandler(value);
  else pendingEvents.push(value);
};

ipcRenderer.on('xor:event', onEvent);
ipcRenderer.on('bordercollie:event', onEvent);

const api = {
  config: () => ipcRenderer.invoke('xor:config'),
  devScenarios: () => ipcRenderer.invoke('xor:dev-scenarios'),
  triggerDevEvent: (id) => ipcRenderer.invoke('xor:dev-event', id),
  setHitRegions: (regions, dragRegions) => ipcRenderer.send('xor:hit-regions', regions, dragRegions),
  setScale: (s) => ipcRenderer.send('xor:scale-set', s),
  onScaled: (fn) => {
    ipcRenderer.on('xor:scaled', (_e, pct) => fn(pct));
    ipcRenderer.on('bordercollie:scaled', (_e, pct) => fn(pct));
  },
  startDrag: (x, y) => ipcRenderer.send('xor:drag-start', x, y),
  dragTo: (x, y) => ipcRenderer.send('xor:drag-to', x, y),
  endDrag: () => ipcRenderer.send('xor:drag-end'),
  onDrag: (fn) => {
    ipcRenderer.on('xor:dragging', (_event, drag) => fn(drag));
    ipcRenderer.on('bordercollie:dragging', (_event, drag) => fn(drag));
  },
  onEvent: (fn) => {
    eventHandler = fn;
    while (pendingEvents.length) fn(pendingEvents.shift());
  },
};

contextBridge.exposeInMainWorld('xor', api);
contextBridge.exposeInMainWorld('bordercollie', api);
