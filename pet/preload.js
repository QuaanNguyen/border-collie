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

const invokeWithFallback = async (primary, fallback, ...args) => {
  try {
    return await ipcRenderer.invoke(primary, ...args);
  } catch (err) {
    if (fallback) return await ipcRenderer.invoke(fallback, ...args);
    throw err;
  }
};

const api = {
  config: () => invokeWithFallback('xor:config', 'bordercollie:config'),
  devScenarios: () => invokeWithFallback('xor:dev-scenarios', 'bordercollie:dev-scenarios'),
  triggerDevEvent: (id) => invokeWithFallback('xor:dev-event', 'bordercollie:dev-event', id),
  setHitRegions: (regions, dragRegions) => {
    ipcRenderer.send('xor:hit-regions', regions, dragRegions);
    ipcRenderer.send('bordercollie:hit-regions', regions, dragRegions);
  },
  setScale: (s) => {
    ipcRenderer.send('xor:scale-set', s);
    ipcRenderer.send('bordercollie:scale-set', s);
  },
  onScaled: (fn) => {
    ipcRenderer.on('xor:scaled', (_e, pct) => fn(pct));
    ipcRenderer.on('bordercollie:scaled', (_e, pct) => fn(pct));
  },
  startDrag: (x, y) => {
    ipcRenderer.send('xor:drag-start', x, y);
    ipcRenderer.send('bordercollie:drag-start', x, y);
  },
  dragTo: (x, y) => {
    ipcRenderer.send('xor:drag-to', x, y);
    ipcRenderer.send('bordercollie:drag-to', x, y);
  },
  endDrag: () => {
    ipcRenderer.send('xor:drag-end');
    ipcRenderer.send('bordercollie:drag-end');
  },
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
