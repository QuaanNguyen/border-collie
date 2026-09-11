# How Codex Implements Terminal Pets

## Scope

This note traces the pet implementation present in the public `openai/codex` repository at commit [`4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042`](https://github.com/openai/codex/tree/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042), checked on 2026-09-11.
The implementation exposed by that repository is the Rust terminal UI implementation under `codex-rs/tui/src/pets`.
Its catalog says it was ported from the Codex App avatar catalog, so the public code is useful evidence for the asset and animation contract but is not the Codex Desktop renderer itself.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/catalog.rs#L1-L1)

## Executive summary

Codex implements a pet as a local normalized model backed by one fixed-size sprite atlas, named animation tracks, and extracted per-frame PNG files.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/model.rs#L32-L72)
Built-in atlases are downloaded on demand from an OpenAI CDN into a versioned cache, while custom pets remain user-owned under `$CODEX_HOME/pets/<id>` with a legacy `$CODEX_HOME/avatars/<id>` fallback.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/mod.rs#L1-L14)
The TUI renders the selected frame after Ratatui has drawn the ordinary interface, using either the Kitty graphics protocol, an iTerm2 Kitty local-file variant, or Sixel.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/app.rs#L953-L999) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/image_protocol.rs#L26-L31)
Task lifecycle events select semantic animation tracks such as `running`, `waiting`, `review`, and `failed`; frame choice is derived from elapsed time, and the frame scheduler wakes the TUI exactly at the next boundary.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/ambient.rs#L46-L90) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/ambient.rs#L196-L212)
The selected pet is persisted as `[tui].pet` only after the asset and model load succeeds, and disabling pets persists the sentinel value `disabled`.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/app/pets.rs#L105-L120) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/app/pets.rs#L134-L170)

## End-to-end flow

1. `/pets` opens a searchable picker and `/pet` is accepted as an alias; `/pets <id>` selects directly, while `disable`, `hide`, `off`, `none`, and related synonyms disable the feature.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/slash_command.rs#L54-L63) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/chatwidget/slash_dispatch.rs#L1008-L1019)
2. The picker combines eight built-in pets, a synthetic disable item, and valid custom manifests discovered under `$CODEX_HOME`; it sorts by display name but pins the disable item first.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/catalog.rs#L25-L74) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/picker.rs#L46-L60) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/picker.rs#L138-L194)
3. Moving the selection starts an asynchronous preview load; monotonically wrapping request IDs make stale preview completions harmless.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/picker.rs#L62-L75) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/chatwidget/pets.rs#L228-L289)
4. Confirming a pet shows a loading popup, downloads a built-in atlas if necessary, parses and validates the pet, slices its frame cache, and returns an `AmbientPet` through an app event.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/app/pets.rs#L78-L103) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/mod.rs#L57-L93)
5. Only a successful load is written to configuration; a failure leaves the previous setting intact and produces a user-visible error.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/app/pets.rs#L134-L170)
6. On later startup, a configured pet is restored asynchronously, and a failed restore warns without replacing the saved setting.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/chatwidget/constructor.rs#L88-L98) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/app/pets.rs#L175-L195)
7. Before every draw, the pet schedules the next frame deadline; after the ordinary TUI frame is drawn, Codex emits the terminal image at the computed screen position.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/chatwidget.rs#L1195-L1203) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/app.rs#L966-L999)

An unset `[tui].pet` means no ambient pet is loaded.
The picker still preselects `codex` as a suggested first choice without marking it active.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/chatwidget/pets.rs#L6-L22) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/picker.rs#L39-L52)

## Module ownership

| Module | Responsibility |
| --- | --- |
| `pets/mod.rs` | Public TUI-facing facade, asset-aware load orchestration, and protocol-independent image replacement and clearing.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/mod.rs#L18-L93) |
| `pets/catalog.rs` | Built-in metadata and the default atlas geometry.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/catalog.rs#L10-L23) |
| `pets/asset_pack.rs` | Built-in CDN download, validation, and atomic cache installation.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/asset_pack.rs#L27-L97) |
| `pets/model.rs` | Selector resolution, custom manifest parsing, validation, and animation normalization.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/model.rs#L74-L111) |
| `pets/frames.rs` | Row-major atlas slicing into PNG frames.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/frames.rs#L11-L52) |
| `pets/ambient.rs` | Semantic state, elapsed-time animation, size and layout, and draw requests.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/ambient.rs#L126-L175) |
| `pets/image_protocol.rs` | Terminal capability detection, Kitty commands, Sixel cache preparation, and resizing.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/image_protocol.rs#L112-L195) |
| `pets/sixel.rs` | A narrow in-house RGBA-to-Sixel encoder.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/sixel.rs#L1-L40) |
| `pets/picker.rs` and `pets/preview.rs` | Picker contents, actions, asynchronous side-preview state, and preview placeholder rendering.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/picker.rs#L39-L135) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/preview.rs#L22-L78) |
| `chatwidget/pets.rs` and `app/pets.rs` | Widget lifecycle, suppression, state updates, async coordination, error policy, and config persistence.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/chatwidget/pets.rs#L62-L213) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/app/pets.rs#L22-L76) |

## Asset acquisition and caches

The built-in catalog contains Codex, Dewey, Fireball, Rocky, Seedy, Stacky, BSOD, and Null Signal.
Each entry names a versioned WebP atlas file ending in `spritesheet-v4.webp`.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/catalog.rs#L25-L74)

Built-in files are fetched from `https://persistent.oaistatic.com/codex/pets/v1/<filename>` and stored at `$CODEX_HOME/cache/tui-pets/v1/assets/<filename>`.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/asset_pack.rs#L27-L35) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/asset_pack.rs#L99-L107)
The downloader requires HTTPS, applies a 60-second timeout and a 4 MiB limit, and enforces the size limit both from `Content-Length` and while streaming chunks.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/asset_pack.rs#L29-L31) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/asset_pack.rs#L109-L151)
Downloaded bytes go to a UUID-named staging file, are decoded to validate geometry, and are atomically renamed into place.
The collision path accepts a valid file installed concurrently by another process.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/asset_pack.rs#L61-L96)
The cache check is structural rather than a signed or hard-coded digest check: it asks the image decoder for dimensions and requires exactly `1536x1872`.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/asset_pack.rs#L165-L179) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/catalog.rs#L10-L15)

After model loading, the atlas is sliced into `frame_000.png`, `frame_001.png`, and so on, in row-major order.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/frames.rs#L11-L47)
The frame-cache path is `$CODEX_HOME/cache/tui-pets/frame-cache/<normalized-pet-id>/<sha256-and-geometry>/frames`.
The hash covers the atlas bytes, and the key also includes frame width, frame height, columns, and rows, so either art or grid changes produce a distinct frame cache.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/model.rs#L102-L110) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/ambient.rs#L146-L165)
If any expected frame is absent, Codex deletes matching stale frame files and regenerates the full set.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/frames.rs#L14-L49)
Sixel output has its own versioned cache below the same pet cache directory and is keyed by source frame stem, target height, and Sixel cache version.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/image_protocol.rs#L20-L24) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/image_protocol.rs#L285-L309)

## Custom pet format

A custom pet normally lives at `$CODEX_HOME/pets/<folder>/pet.json` next to its sprite atlas.
The loader also supports `$CODEX_HOME/avatars/<folder>/avatar.json` for legacy compatibility and explicit directory or manifest paths for local iteration.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/model.rs#L185-L230)

The JSON shape accepted by the loader is equivalent to:

```json
{
  "id": "chefito",
  "displayName": "Chefito",
  "description": "A tiny recipe-loving chef",
  "spritesheetPath": "spritesheet.webp",
  "frame": {
    "width": 192,
    "height": 208,
    "columns": 8,
    "rows": 9
  },
  "animations": {
    "idle": {
      "frames": [0, 1, 2, 3, 4, 5],
      "fps": 8,
      "loop": true,
      "fallback": "idle"
    }
  }
}
```

These field names and types come directly from the deserialized `PetFile`, `FrameSpec`, and `AnimationSpec` structures.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/model.rs#L115-L162)
The top-level metadata, sprite path, frame object, and animation map are optional.
The default sprite path is `spritesheet.webp`, and the default grid is `192x208` pixels per frame across 8 columns and 9 rows.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/model.rs#L138-L147) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/model.rs#L232-L293)

The current contract fixes the complete decoded atlas at `1536x1872`, even when a custom `frame` object repartitions that area into a different grid.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/model.rs#L314-L358)
Grid fields must be nonzero, their products must cover the atlas exactly, and the total frame count may not exceed 256.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/model.rs#L327-L358)
The sprite path must be relative and may not contain an absolute path, parent traversal, or a Windows path prefix.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/model.rs#L296-L312)

Custom animation definitions are overlaid onto the complete default animation map instead of replacing it.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/model.rs#L388-L451)
Because retained defaults are validated against the custom grid too, a smaller or differently indexed grid must override every default track whose indices no longer fit.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/model.rs#L388-L477)
Each supplied track must contain at least one in-range, zero-based sprite index.
Its `fps` defaults to 8 and must be finite, greater than zero, and no more than 60.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/model.rs#L398-L419)
`loop` defaults to true, and an empty `fallback` defaults to `idle`; every fallback must name an existing track.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/model.rs#L420-L450) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/model.rs#L454-L477)

## Default atlas and animation behavior

The default 8-by-9 atlas uses this semantic row layout.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/model.rs#L484-L581)

| Row | Primary name | Compatibility alias | Frames used | Timing |
| --- | --- | --- | --- | --- |
| 0 | `idle` | None | 0 through 5 | Per-frame durations of 1680, 660, 660, 840, 840, and 1920 ms.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/model.rs#L584-L595) |
| 1 | `running-right` | `move_right` | 8 frames | 120 ms each, with 220 ms on the last frame.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/model.rs#L488-L492) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/model.rs#L543-L548) |
| 2 | `running-left` | `move_left` | 8 frames | 120 ms each, with 220 ms on the last frame.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/model.rs#L494-L499) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/model.rs#L550-L555) |
| 3 | `waving` | `wave` | 4 frames | 140 ms each, with 280 ms on the last frame.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/model.rs#L501-L506) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/model.rs#L557-L562) |
| 4 | `jumping` | `bounce` | 5 frames | 140 ms each, with 280 ms on the last frame.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/model.rs#L508-L513) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/model.rs#L564-L569) |
| 5 | `failed` | `sad` | 8 frames | 140 ms each, with 240 ms on the last frame.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/model.rs#L515-L520) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/model.rs#L571-L576) |
| 6 | `waiting` | None | 6 frames | 150 ms each, with 260 ms on the last frame.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/model.rs#L522-L527) |
| 7 | `running` | None | 6 frames | 120 ms each, with 220 ms on the last frame.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/model.rs#L529-L534) |
| 8 | `review` | None | 6 frames | 150 ms each, with 280 ms on the last frame.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/model.rs#L536-L541) |

Every non-idle default track repeats its active row three times, appends the six idle frames, and sets the loop point at the beginning of that appended idle sequence.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/model.rs#L598-L626)
The visible result is a finite reaction burst followed by a calm idle loop, even while the semantic notification remains current.
By contrast, a custom track with `loop: false` holds its last frame at the low-level ticker, while `AmbientPet` switches to the named fallback once that track's total duration has elapsed.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/ambient.rs#L283-L301) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/ambient.rs#L376-L412)

The TUI currently selects only five of these tracks through application state:

| Application condition | Track | Lifetime before it is treated as expired |
| --- | --- | --- |
| No current notification | `idle` | Indefinite.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/ambient.rs#L277-L291) |
| Turn starts | `running` | 3 minutes.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/chatwidget/turn_runtime.rs#L80-L112) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/ambient.rs#L41-L44) |
| An approval, permission, elicitation, verification, or user-input request is shown | `waiting` | 24 hours.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/chatwidget/tool_requests.rs#L283-L329) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/chatwidget/tool_requests.rs#L404-L483) |
| A live turn completes normally | `review` | 7 days.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/chatwidget/turn_runtime.rs#L179-L199) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/ambient.rs#L41-L44) |
| A turn ends in an error | `failed` | 1 hour.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/chatwidget/turn_runtime.rs#L378-L390) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/ambient.rs#L41-L44) |

`running-left`, `running-right`, `waving`, `jumping`, and their aliases exist in the default model but are not selected by `PetNotificationKind` in this terminal implementation.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/ambient.rs#L46-L62)
There is no autonomous movement or random behavior in `AmbientPet`; the pet is a fixed-position state indicator whose animation clock resets whenever a notification is set.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/ambient.rs#L126-L181)

Frame selection is time-derived rather than counter-derived.
The ticker walks frame durations using `animation_started_at.elapsed()`, folds elapsed time into the configured loop segment, and returns both the sprite index and the remaining delay to its boundary.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/ambient.rs#L370-L434)
This makes a delayed redraw catch up to the frame implied by wall-clock elapsed time instead of replaying every missed frame.

If animations are disabled, Codex uses the first frame of the selected track and schedules no follow-up redraw.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/ambient.rs#L202-L212) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/ambient.rs#L303-L315)
The effective setting is the saved `[tui].animations` preference combined with the host's launch-time reduced-motion preference.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/local_settings.rs#L25-L38)

The notification model stores labels and optional body text, but the current TUI deliberately does not draw that text over the terminal.
The layout still accounts for one or two notification rows when checking whether the pet fits, and a test explicitly asserts that `Running`, `Needs input`, `Ready`, and `Blocked` are absent from the Ratatui output.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/ambient.rs#L92-L110) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/ambient.rs#L221-L249) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/chatwidget/tests/status_and_layout.rs#L2722-L2746)

## Layout and image rendering

The ambient pet targets a fixed physical height of 75 pixels.
Codex assumes a 15-pixel terminal row, producing a five-row image, and uses a `0.52` correction in the frame aspect calculation to estimate terminal cell width.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/ambient.rs#L37-L40) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/ambient.rs#L334-L345)
With the default `192x208` frame this resolves to nine columns by five rows, as asserted by the layout test.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/chatwidget/tests/status_and_layout.rs#L2477-L2504)

The pet is right-aligned and placed one derived gap row above its anchor.
It is hidden if the full sprite and notification allowance do not fit; Codex does not clip it.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/ambient.rs#L214-L249) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/ambient.rs#L348-L350)
The default anchor is the bottom of the current composer viewport, while `screen-bottom` anchors it to the terminal's physical bottom.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/config/src/types.rs#L696-L704) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/chatwidget/pets.rs#L84-L100)
The app deliberately passes the full screen rectangle to pet layout even when the ordinary inline viewport is short.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/app.rs#L977-L987) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/chatwidget/tests/status_and_layout.rs#L2691-L2720)

The sprite is suppressed whenever a modal or popup is active.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/chatwidget/pets.rs#L84-L100)
When enabled, the chat renderer reserves the image width plus a two-column gap from active transcript cells and the composer, and the same reduced width is used for history wrapping and resize reflow.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/chatwidget.rs#L180-L190) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/chatwidget/rendering.rs#L121-L209) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/chatwidget/pets.rs#L102-L117)

The picker preview uses the first idle frame, centers it in a fixed-width side pane, and does not animate it.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/ambient.rs#L251-L275) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/chatwidget/pets.rs#L242-L260)

### Terminal protocol selection

Production always resolves protocol support automatically.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/ambient.rs#L353-L360)
Codex disables pets inside tmux and Zellij before considering terminal capabilities because images can escape pane boundaries or corrupt scrollback.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/image_protocol.rs#L55-L79) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/image_protocol.rs#L112-L143)
Kitty and WezTerm environment markers select inline Kitty graphics.
iTerm2 3.6 or newer selects the Kitty local-file transport, while older iTerm2 versions receive a dedicated upgrade error.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/image_protocol.rs#L124-L151) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/image_protocol.rs#L165-L188)
Ghostty, Kitty, and WezTerm terminal identities and matching `TERM` or `TERM_PROGRAM` values select Kitty graphics.
Windows Terminal, `xterm-sixel`, `mlterm`, and `foot` select Sixel.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/image_protocol.rs#L178-L195)
Other terminals are rejected with a warning instead of receiving an attempted image sequence.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/chatwidget/pets.rs#L141-L180)

### Kitty path

Inline Kitty rendering reads the PNG, base64-encodes it, splits it into 4096-byte chunks, and sends an image command sized in terminal columns and rows.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/image_protocol.rs#L219-L252)
The iTerm2 path canonicalizes the PNG and sends a base64-encoded local filename instead of the image bytes.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/image_protocol.rs#L254-L268)
Ambient and picker images use stable IDs `0xC0DE` and `0xC0DF`, allowing replacement and deletion without disturbing unrelated terminal images.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/mod.rs#L125-L139)

### Sixel path

Sixel rendering resizes a PNG to 75 pixels high with a Lanczos3 filter, preserving aspect ratio, then caches the encoded bytes.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/image_protocol.rs#L285-L309)
The custom encoder quantizes opaque pixels to RGB332, treats alpha below 128 as transparent, writes only active color planes, and run-length encodes repeated Sixel cells.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/sixel.rs#L12-L40) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/sixel.rs#L43-L137) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/sixel.rs#L139-L163)

### Replacement and clearing

Image emission saves the cursor, clears or deletes the prior image as needed, moves to the target cell, writes the payload, restores the cursor, and flushes.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/mod.rs#L147-L231)
Kitty frames are deleted by image ID before replacement or removal.
Sixel has no equivalent retained-image deletion in this implementation, so Codex overwrites the previous occupied terminal cells with spaces before drawing and when hiding the pet.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/mod.rs#L159-L175) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/mod.rs#L209-L230) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/mod.rs#L246-L275)
The TUI wraps image writes in synchronized terminal output so a Ratatui frame and its image update are less likely to tear.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/tui.rs#L1069-L1108)

## Persistence and failure policy

The persisted configuration surface is:

```toml
[tui]
pet = "codex"
pet_anchor = "composer"
animations = true
```

`pet` is optional, `pet_anchor` defaults to `composer` and also accepts `screen-bottom`, and `animations` defaults to true.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/config/src/types.rs#L696-L704) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/config/src/types.rs#L736-L746) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/config/src/types.rs#L817-L834)
The interactive picker writes only `[tui].pet`; anchor and animation behavior are read from the wider TUI configuration.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/core/src/config/edit.rs#L88-L102) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/chatwidget/pets.rs#L93-L100)
Custom picker entries persist a `custom:<folder>` selector, although the loader also accepts an unprefixed unknown ID and falls back to the custom directories.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/picker.rs#L158-L189) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/model.rs#L82-L96)

Asset acquisition and parsing happen before the configuration edit, preventing a broken selection from becoming the saved startup choice.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/app/pets.rs#L78-L103) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/app/pets.rs#L134-L170)
An image asset error during normal rendering disables the pet only for the current session and attempts to clear its old image; it does not rewrite the persisted selection.
A terminal writer error is propagated as a fatal TUI error instead.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/app/pets.rs#L22-L48)
The pet image is explicitly cleared during shutdown.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/app/pets.rs#L5-L20)

## Test coverage

The implementation has focused coverage at every seam:

- Model tests verify the built-in catalog, default row mapping and timings, custom FPS and loop behavior, path and legacy selector loading, cache-key invalidation, and malformed manifest rejection.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/model.rs#L659-L783) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/model.rs#L804-L1019)
- Frame tests verify in-process row-major slicing into PNGs.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/frames.rs#L73-L115)
- Asset-pack tests verify the CDN URL, streaming byte cap, and complete built-in test pack.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/asset_pack.rs#L191-L235)
- Protocol tests cover Kitty bytes, local-file transport, multiplexer rejection, terminal detection, iTerm2 version gating, Sixel generation, and version parsing.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/image_protocol.rs#L343-L411) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/image_protocol.rs#L413-L613) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/image_protocol.rs#L647-L696)
- Sixel unit tests verify transparency, multi-band movement, run-length encoding, and buffer validation.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/sixel.rs#L250-L314)
- Render tests inspect emitted control-sequence order, cursor restoration, Kitty deletion, local-file references, Sixel clearing, and the separation between asset and terminal errors.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/mod.rs#L277-L373) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/mod.rs#L376-L492)
- Slash-command and picker tests cover opening, direct selection, disable aliases, unsupported-terminal warnings, built-in and custom discovery, current-state selection, and legacy imports.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/chatwidget/tests/slash_commands.rs#L3157-L3295) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/pets/picker.rs#L196-L323)
- Async coordination tests verify cached built-in loads and rejection of stale preview and selection completions.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/chatwidget/pets_tests.rs#L5-L86)
- Layout tests verify hidden-by-default behavior, the 9-by-5 placement, anchor switching, width reservation, full-screen-area placement, earlier transcript reflow, and absence of a text overlay.[Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/chatwidget/tests/status_and_layout.rs#L2477-L2551) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/chatwidget/tests/status_and_layout.rs#L2607-L2746) [Source](https://github.com/openai/codex/blob/4dcce4f0c47e0183e4b05ffcbb38b4fffb8b8042/codex-rs/tui/src/app/tests.rs#L6500-L6524)

## Design lessons for Border Collie

These are implementation inferences from the source above rather than additional claims about Codex:

1. Keep the pet model independent from rendering.
Codex normalizes built-in IDs, custom IDs, legacy data, and local paths into the same `Pet` before any image protocol is involved.
2. Make animation time-based.
Deriving the visible frame from an event timestamp and per-frame durations avoids drift and lets delayed UI frames catch up cleanly.
3. Persist only a validated selection.
Loading first and committing configuration second avoids turning one bad asset into a recurring startup failure.
4. Separate source assets, decoded-frame caches, and renderer-specific caches.
The SHA-256 plus geometry key gives straightforward invalidation, while a separate Sixel cache can evolve with its own version.
5. Treat image replacement as an ownership problem.
Stable image IDs, explicit old-region clearing, cursor preservation, and guaranteed shutdown cleanup are as important as drawing the new frame.
6. Reserve layout space before drawing an out-of-band surface.
Codex narrows transcript and composer layout so terminal images do not visually overwrite ordinary UI.
7. Make unsupported environments an explicit capability result.
Codex gives multiplexer and terminal-specific explanations instead of attempting output that may damage scrollback.
8. Keep semantic state names small and stable.
The TUI maps many product events onto four meaningful reactions plus idle, while the atlas can carry extra tracks for other clients or future behaviors.
