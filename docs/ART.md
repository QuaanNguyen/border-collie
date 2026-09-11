# Pet Art

Runtime animation frames live in `pet/assets/default-animations/`.

Each animation folder contains five transparent PNG frames.

The Pet hosts load those frames through the generated runtime manifest.

The shared Pet animation contract in `events/pet-config.json` maps semantic states onto named tracks and per-frame durations.
The renderer preloads a complete valid replacement before activating it, ignores stale asynchronous loads, derives frames from elapsed time, and respects reduced motion.

Replace art by updating the tracked source sheet and running the deterministic packaging command.

Use `docs/ANIMATION_ASSETS.md` for the source layout, packaging, and QA workflow.
