'use strict';
/**
 * Window sizing, with no Electron in it  -  so it can be tested.
 *
 * Border Collie lives in a screen corner, so growing has to keep the bottom-right
 * corner still. Growing from the top-left would walk the pet off the screen.
 */

const config = require('../events/pet-config.json');
const BASE_W = config.baseWidth;
const BASE_H = config.baseHeight;
const SCALES = config.scales;
const DEFAULT_SCALE = config.defaultScale;

function clampScale(s) {
  const n = Number(s);
  if (!Number.isFinite(n)) return DEFAULT_SCALE;
  return Math.min(SCALES[SCALES.length - 1], Math.max(SCALES[0], n));
}

/** New size at this scale, anchored on the current bottom-right corner. */
function boundsFor(prev, scale) {
  const width = Math.round(BASE_W * scale);
  const height = Math.round(BASE_H * scale);
  return {
    width,
    height,
    x: Math.round(prev.x + prev.width - width),
    y: Math.round(prev.y + prev.height - height),
  };
}

/**
 * Never let it end up off the edge of the display it is on.
 * The outer Math.max matters: if the window is bigger than the work area  -  a
 * small laptop at 2x with the log open  -  the inner clamp alone produces a
 * negative coordinate and pushes Border Collie off the top of the screen.
 */
function keepOnScreen(bounds, area) {
  return {
    width: bounds.width,
    height: bounds.height,
    x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - bounds.width)),
    y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - bounds.height)),
  };
}

function visibleBounds(regions) {
  if (!Array.isArray(regions) || regions.length === 0) return null;
  const valid = regions.filter((region) =>
    Number.isFinite(region?.x) &&
    Number.isFinite(region?.y) &&
    Number.isFinite(region?.width) &&
    Number.isFinite(region?.height) &&
    region.width > 0 &&
    region.height > 0,
  );
  if (valid.length === 0) return null;
  const left = Math.min(...valid.map((region) => region.x));
  const top = Math.min(...valid.map((region) => region.y));
  const right = Math.max(...valid.map((region) => region.x + region.width));
  const bottom = Math.max(...valid.map((region) => region.y + region.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function keepVisibleOnScreen(bounds, area, regions, scale = 1) {
  const visible = visibleBounds(regions);
  if (!visible || !Number.isFinite(scale) || scale <= 0) return keepOnScreen(bounds, area);
  const minX = area.x - visible.x * scale;
  const maxX = area.x + area.width - (visible.x + visible.width) * scale;
  const minY = area.y - visible.y * scale;
  const maxY = area.y + area.height - (visible.y + visible.height) * scale;
  return {
    width: bounds.width,
    height: bounds.height,
    x: Math.round(minX > maxX ? minX : Math.max(minX, Math.min(bounds.x, maxX))),
    y: Math.round(minY > maxY ? minY : Math.max(minY, Math.min(bounds.y, maxY))),
  };
}

function dragOrigin(pointer, grabOffset) {
  const values = [pointer?.x, pointer?.y, grabOffset?.x, grabOffset?.y].map(Number);
  if (!values.every(Number.isFinite)) return null;
  return {
    x: Math.round(values[0] - values[2]),
    y: Math.round(values[1] - values[3]),
  };
}

/**
 * The largest step that actually fits on this display, so scaling up stops at
 * the screen rather than at an arbitrary number. Always returns something.
 */
function fitScale(scale, area) {
  const fits = (s) => BASE_W * s <= area.width && BASE_H * s <= area.height;
  if (fits(scale)) return scale;
  for (let i = SCALES.length - 1; i >= 0; i--) {
    if (SCALES[i] <= scale && fits(SCALES[i])) return SCALES[i];
  }
  return SCALES[0];
}

module.exports = { BASE_W, BASE_H, SCALES, DEFAULT_SCALE,
  clampScale, boundsFor, keepOnScreen, keepVisibleOnScreen, visibleBounds, dragOrigin, fitScale };
