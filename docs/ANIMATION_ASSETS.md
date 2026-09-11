# Animation Assets

Runtime animation frames live in `pet/assets/default-animations/`.

The runtime reads transparent PNG frames from named animation folders.

Source sheets are not runtime assets.

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

Guard states map onto those folders in `pet/main.js`.

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

Slice the sheet into runtime frames:

1. Start from a `960x1536` PNG sheet with five columns and eight rows.
2. Treat pure or near-black background pixels as transparent.
3. Crop each cell to the visible sprite.
4. Place each sprite on a `192x208` transparent canvas.
5. Save the result into the matching folder under `pet/assets/default-animations/`.
6. Remove any `.DS_Store` files from the runtime asset folder.

Verify:

```sh
node --check pet/main.js
node test/run-tests.js
```

Keep source sheets outside `pet/assets/default-animations/`.
