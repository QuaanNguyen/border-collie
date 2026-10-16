const { contextBridge } = require('electron')
const frame = process.env.BORDERCOLLIE_TEST_FRAME

contextBridge.exposeInMainWorld('bordercollie', {
  config: async () => ({
    animations: {
      calm: {
        frames: [frame, frame, frame, frame, frame],
        frameDurationsMs: [140, 140, 140, 140, 280],
      },
    },
    demo: false,
    dev: false,
    eventsFile: 'probe-events',
  }),
  hide: () => {},
  onDrag: () => {},
  onEvent: () => {},
  onScaled: () => {},
  startDrag: () => {},
  dragTo: () => {},
  endDrag: () => {},
  setHitRegions: () => {},
  setScale: () => {},
})
