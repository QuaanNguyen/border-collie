# Animation Assets

Runtime animation frames live in `pet/assets/default-animations/`.

The runtime reads transparent PNG frames from named animation folders through the generated asset manifest and the shared Pet animation contract in `events/pet-config.json`.

Source sheets are build inputs, not runtime assets.

## Runtime Layout

The app uses eight default animation folders.

Each folder contains five transparent PNG frames.

```text
pet/assets/default-animations/
|-- border-collie-normal/
|-- border-collie-dragging/
|-- border-collie-hovering/
|-- border-collie-thinking/
|-- border-collie-suspicious/
|-- border-collie-refused/
|-- border-collie-denied/
`-- border-collie-celebrating/
```

Semantic Pet states map onto named animation tracks in `events/pet-config.json`.
Each track declares one duration for every frame.
Both desktop hosts validate the complete mapping and every referenced asset before the renderer activates it.
The renderer derives the visible frame from elapsed time, so delayed UI work catches up without replaying missed frames or accumulating interval drift.
When the operating system requests reduced motion, the renderer keeps the first frame of the selected track visible and schedules no animation timer.

## Sprite Sheet Guide

Use this guide to create a new animated pet from any subject.

Start with one pixel-art sprite sheet.

Use five columns and eight rows.

Rows must appear in this order:

1. Normal
2. Dragging
3. Hovering
4. Thinking or working
5. Suspicious
6. Refused
7. Denied
8. Celebrating or passing

Each row must have five frames.

Each frame should be clean, centered, readable at pet size, and separated from the background.

The source PNG must include an alpha channel.

Source alpha is authoritative for transparency, including when the artwork contains black or near-black pixels.

Package the sheet from the repository root:

```sh
node scripts/package-animation-assets.js
```

The packaging command:

1. Reads the tracked `960x1536` source sheet as five columns and eight rows.
2. Preserves every pixel that the source alpha channel marks as visible.
3. Crops each cell to its visible bounds.
4. Places each sprite at bottom-center on a `192x208` transparent canvas.
5. Writes the matching runtime animation folders.
6. Records the source checksum, conversion recipe, and per-frame checksums in the runtime manifest.
7. Produces a QA sheet against black, white, checkerboard, and varied-color backgrounds.

The packager uses a small repository-local codec limited to non-interlaced 8-bit RGBA PNG files so contributors can regenerate assets offline without a native image toolchain or another install-time dependency.
The acceptance test decodes PNG data independently from the packager so a shared codec defect cannot make corrupted output validate itself.

Verify:

```sh
node test/animation-assets.test.js
node test/animation-manifest.test.js
node test/animation-player.test.js
node test/run-all-tests.js
```

Keep source sheets and QA artifacts outside `pet/assets/default-animations/` so the installed Pet contains only runtime frames and their manifest.
