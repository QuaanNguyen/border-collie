'use strict';

function normalizeRegions(regions) {
  if (!Array.isArray(regions)) return [];
  return regions.flatMap((region) => {
    const x = Number(region && region.x);
    const y = Number(region && region.y);
    const width = Number(region && region.width);
    const height = Number(region && region.height);
    if (![x, y, width, height].every(Number.isFinite)) return [];
    if (width <= 0 || height <= 0) return [];
    return [{ x, y, width, height }];
  });
}

function contains(regions, point) {
  return regions.some((region) =>
    point.x >= region.x &&
    point.x < region.x + region.width &&
    point.y >= region.y &&
    point.y < region.y + region.height);
}

function createWindowInteraction(options) {
  const win = options.win;
  const screen = options.screen;
  const getScale = options.getScale || (() => 1);
  const setIntervalFn = options.setInterval || setInterval;
  const clearIntervalFn = options.clearInterval || clearInterval;
  const pollIntervalMs = options.pollIntervalMs || 32;
  let regions = [];
  let ignoring = null;
  let dragging = false;

  function apply(ignore) {
    if (ignore === ignoring) return;
    ignoring = ignore;
    if (ignore) win.setIgnoreMouseEvents(true, { forward: true });
    else win.setIgnoreMouseEvents(false);
  }

  function tick() {
    if (win.isDestroyed() || !win.isVisible()) return;
    if (dragging) {
      apply(false);
      return;
    }
    const bounds = win.getBounds();
    const cursor = screen.getCursorScreenPoint();
    const scale = Math.max(0.01, Number(getScale()) || 1);
    const point = {
      x: (cursor.x - bounds.x) / scale,
      y: (cursor.y - bounds.y) / scale,
    };
    apply(!contains(regions, point));
  }

  function updateRegions(next) {
    regions = normalizeRegions(next);
    tick();
  }

  const timer = setIntervalFn(tick, pollIntervalMs);

  return {
    tick,
    updateRegions,
    setDragging(value) {
      dragging = !!value;
      tick();
    },
    stop() {
      clearIntervalFn(timer);
    },
  };
}

module.exports = { normalizeRegions, contains, createWindowInteraction };
