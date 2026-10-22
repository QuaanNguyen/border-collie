# xor

xor checks a coding agent's proposed actions before they run.
It reads your request, your project rules, and the proposed action, then returns approve, deny, or ask.
An optional desktop companion shows when the agent is working, blocked, or finished.

![xor companion](docs/xor.gif)

[Install](#installation) · [Set project rules](#project-rules) · [Commands](#commands) · [Current work](#current-work) · [Find your way around](#find-your-way-around)

## What it does

The OpenCode plugin checks each tool call before OpenCode runs it.
It blocks actions outside the project folder and protects the project rules from agent edits.
It then asks a local Needle model whether the remaining action follows your rules.

- Approve lets OpenCode continue its normal permission checks.
- Deny blocks the action and tells the agent why.
- Ask blocks the action and tells the agent to request your confirmation before trying again.

When the agent makes a matching completion claim, xor checks the completion requirements you configured against the project files.
The desktop companion displays these events without changing the decisions.

OpenCode is the supported integration.
The training tool inventory also covers Claude Code and Codex, but that inventory does not provide runtime integrations for those agents.

## Installation

Use Node.js 22.12 or newer and OpenCode 2.0.30 or newer.
On macOS, install Xcode Command Line Tools before running the installer.
Install the package and set up the plugin:

```sh
npm install --global @quaannguyen/xor
xor install
```

The installer checks your OpenCode version, installs the plugin, and downloads the pinned Needle runner and model.
It verifies the downloaded files and builds the desktop companion on macOS or installs its Electron runtime on Windows and Linux.
New model downloads use the xor cache folder.
An existing verified cache from an older installation can be reused.

To install from this repository:

```sh
git clone https://github.com/QuaanNguyen/xor.git
cd xor
npm install
node scripts/install-plugin.js
```

## Project rules

Write your project rules in `.xor/preference.json`:

```json
{
  "text": "Work on this repository. Allow local edits and tests. Deny sending source code or secrets to outside services. Ask before deleting files."
}
```

You can also add completion requirements, such as checking that a build output exists.
See the [project rule and completion reference](docs/xor-and-gate.md#the-preference) for the file format.
Missing rules use the shipped defaults.
Invalid rules block execution until you correct them.

## Commands

| Task | Command |
| --- | --- |
| Install the OpenCode plugin and model | `xor install` |
| Move older project rules to xor | `xor migrate` |
| Make the desktop companion smaller | `xor pet size 75` |
| Make the desktop companion larger | `xor pet size 115` |
| Reset the companion size | `xor pet size reset` |
| Show command help | `xor help` |

Migration preserves your rules and stops if old and new instructions conflict.

## Current work

The active research work generates varied examples, reviews their permission decisions, and tests a small checker model on the Mac.
Generated commands are data and are never executed by the generation pipeline.

No replacement model is qualified.
Direct answers without model reasoning remain a qualification requirement, not a measured guarantee of the current release.
The [training guide](docs/checker-training.md) records the pipeline and remaining requirements.
The [checked tool inventory](docs/checker-tool-inventory.json) records supported input formats and known gaps.

## Development and checks

Use Node.js 22.12 or newer, Python 3, Git, and Git LFS.
Install development dependencies and retrieve the preserved research files:

```sh
npm ci
git lfs install
git lfs pull
npm run check
npm test
npm run test:package
node scripts/check-package-client.js npm
python3 analysis/checker-v3-2026-10-19/manifest-data.py --check
```

Run the full desktop test suite on a host that can launch the companion:

```sh
node test/run-all-tests.js
```

Keep ASU gateway credentials on your Mac.
The [research file guide](docs/research-data.md) explains the preserved inputs and checksum checks.

## Find your way around

| If you want to… | Start here |
| --- | --- |
| Understand the runtime and project terms | [Project context](CONTEXT.md) |
| Understand action checks and project rules | [Gate reference](docs/xor-and-gate.md) |
| Follow model and data work | [Training guide](docs/checker-training.md) |
| Inspect the checked agent tools | [Tool inventory](docs/checker-tool-inventory.json) |
| Find preserved experiments and data | [Research file guide](docs/research-data.md) |
| Work on the desktop companion | [Companion events](docs/EVENTS.md) |
| Contribute or run platform checks | [Contributing guide](CONTRIBUTION.md) |
| Prepare a release | [Release guide](docs/RELEASING.md) |

The active gate code is in [xor](xor/), the OpenCode integration is in [plugin](plugin/), and the desktop companion is in [pet](pet/).
Command entry points and maintenance tools are in [scripts](scripts/), with tests in [test](test/).
Frozen records retain older names where changing them would break their recorded checksums.
