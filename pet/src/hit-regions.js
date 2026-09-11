"use strict";

function regionsFromAlpha(pixels, width, height, threshold = 8) {
  const regions = [];
  const active = new Map();

  for (let y = 0; y < height; y += 1) {
    const runs = [];
    let start = null;
    for (let x = 0; x <= width; x += 1) {
      const opaque = x < width && pixels[(y * width + x) * 4 + 3] >= threshold;
      if (opaque && start === null) start = x;
      if (!opaque && start !== null) {
        runs.push({ x: start, width: x - start });
        start = null;
      }
    }

    const next = new Map();
    for (const run of runs) {
      const key = `${run.x}:${run.width}`;
      const previous = active.get(key);
      if (previous) {
        previous.height += 1;
        next.set(key, previous);
      } else {
        const region = { x: run.x, y, width: run.width, height: 1 };
        regions.push(region);
        next.set(key, region);
      }
    }
    active.clear();
    for (const [key, region] of next) active.set(key, region);
  }

  return regions;
}

function placeAlphaRegions(regions, sourceWidth, sourceHeight, rect, reflected = false) {
  const scale = Math.min(rect.width / sourceWidth, rect.height / sourceHeight);
  const renderedWidth = sourceWidth * scale;
  const renderedHeight = sourceHeight * scale;
  const offsetX = rect.x + (rect.width - renderedWidth) / 2;
  const offsetY = rect.y + (rect.height - renderedHeight) / 2;
  return regions.map((region) => ({
    x: offsetX + (reflected ? sourceWidth - region.x - region.width : region.x) * scale,
    y: offsetY + region.y * scale,
    width: region.width * scale,
    height: region.height * scale,
  }));
}

function imageHitRegions(image, threshold = 8) {
  if (!image || image.hidden || !image.complete || !image.naturalWidth || !image.naturalHeight) return [];
  const rect = image.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return [];

  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  return placeAlphaRegions(
    regionsFromAlpha(pixels, canvas.width, canvas.height, threshold),
    canvas.width,
    canvas.height,
    rect,
    image.classList.contains("facing-left"),
  );
}

const hitRegions = { regionsFromAlpha, placeAlphaRegions, imageHitRegions };

if (typeof module !== "undefined" && module.exports) module.exports = hitRegions;
if (typeof window !== "undefined") window.BorderCollieHitRegions = hitRegions;
