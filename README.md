# xor

`xor` is a hook/catch verifier for every agent's tool calling. It denies when a tool call matches the user preference description for denial and allows the rest, utilizing a fine-tuned system-one Needle model. It also includes an optional desktop companion pet that visualizes verifier activity in real time.

![xor companion](docs/xor.gif)

## How It Works

1. **Agent Tool Hook**: `xor` intercepts every tool execution before it runs via `tool.execute.before`.
2. **Preference Evaluation**: Evaluates the proposed call against the folder Preference (`.xor/preference.json`) and the latest user prompt using the system-one Needle model.
3. **Deny Matches, Allow Rest**:
   - **Deny**: If the tool call matches what the user preference described for denial, `xor` blocks the tool and reports the refusal reason to the agent.
   - **Approve (Allow)**: If the call does not match the denial criteria, `xor` permits execution immediately with system-one speed and zero reasoning overhead.
   - **Ask**: If the action requires explicit confirmation under the preference, `xor` pauses and prompts the user before proceeding.
4. **Deterministic Completion**: When an agent claims a task is complete, `xor` deterministically checks `done_criteria` against the workspace.
5. **Desktop Pet**: An optional desktop pet reflects verifier status (`allowed`, `refused`, `thinking`, `celebrating`) without interfering with execution.

## Installation

Install the package globally or locally:

```sh
npm install --global @quaannguyen/xor
xor install
```

`xor install` sets up the OpenCode plugin, downloads and verifies the pinned Needle runner and weights (`~/.cache/xor/judge`), and builds the native macOS Pet (or stages Electron on Windows and Linux).

For source clones:
```sh
git clone https://github.com/QuaanNguyen/border-collie.git xor
cd xor
node scripts/install-plugin.js
```

## CLI Usage

```sh
# Install and bind the plugin and Needle verifier
xor install

# Migrate legacy preferences (.bordercollie) to .xor/preference.json
xor migrate

# Resize or reset the desktop companion pet
xor pet size 75
xor pet size 115
xor pet size reset
```

Backward compatibility aliases (`bordercollie install`, `bordercollie migrate`, `bordercollie pet size`) remain supported.

## Preference Setup

Project rules live in `.xor/preference.json` as a single natural language `text` string with optional deterministic `done_criteria`:

```json
{
  "text": "Work on the user request in this repository. Local file edits, git status, and testing are approved. Deny sending source code or secrets off-machine via curl, wget, or network commands. Deny destructive file deletions unless explicitly requested.",
  "done_criteria": [
    {
      "id": "tests-pass",
      "checks": [
        { "type": "file_exists", "path": "dist/index.js" }
      ]
    }
  ]
}
```

If no Preference exists, `xor` enforces safe default project boundaries. Run `xor migrate` to upgrade legacy `.bordercollie` configurations cleanly.

## Development and Verification

Requirements: Node.js 22.12+, Python 3, Git, and Git LFS.

```sh
# Run syntax and package checks
npm run check
npm run test:package

# Run unit and integration tests
npm test

# Run the complete test suite
node test/run-all-tests.js

# Verify research data manifest
python3 analysis/checker-v3-2026-10-19/manifest-data.py --check
```

## Documentation

- [Architecture & Domain Context](CONTEXT.md)
- [Verifier Hook & Needle Specifications](docs/xor-and-judge.md)
- [Event Schema & Pet Animation Protocol](docs/EVENTS.md)
- [Release Process](docs/RELEASING.md)
- [Contributing Guide](CONTRIBUTION.md)
