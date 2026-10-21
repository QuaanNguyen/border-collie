# xor

A desktop companion that watches your AI coding agent and reacts when something needs attention.

![xor watching agents](../xor.gif)

## What It Does

xor is a small desktop companion for OpenCode that pairs with a system-one verifier.
In plain terms, it sits beside your coding agent, watches what the agent tries to do, and reacts when the agent is working, blocked, refused, failed, or claiming it is done.

xor checks every tool call before it runs.
A small on-device model, the Needle verifier, reads your latest message, the folder Preference, and the proposed call, and answers approve, deny, or ask.
Paths outside the project folder and changes to the Preference are refused in code before the verifier runs.
xor also verifies important finish claims against the files in the project.

The verifier uses the [Needle 3](https://github.com/cactus-compute/needle) model from Cactus Compute, run locally with telemetry off.
xor is not an operating-system sandbox.

## Installation

OpenCode is the currently supported xor-enforcing integration.
Codex CLI and Claude Code are not yet advertised as xor-enforcing because their deny-before-run coverage has not been verified.

Install this checkout globally and then install the plugin:

```sh
npm install --global .
xor install
```

The npm installation includes xor and the desktop Pet.
`xor install` also downloads the Needle runner for your platform and the 35 MB `needle3.cact` weights from Hugging Face, checks both against pinned SHA-256 digests, and caches them under `~/.cache/xor/judge` (`%LOCALAPPDATA%\xor\judge` on Windows).
If that download or check fails, the previously installed plugin stays in place.
The verifier has runners for macOS on Apple Silicon, Linux x64 and ARM64, and Windows x64 and ARM64.

To install from a source clone for development:

```sh
git clone https://github.com/QuaanNguyen/border-collie.git xor
cd xor
node scripts/install-plugin.js
```

Or on macOS and Linux:

```sh
bash scripts/install-plugin.sh
```

The installation includes xor and the desktop Pet.
OpenCode 2.0.30 or newer loads the package directory `~/.config/opencode/plugins/xor`. A configured path must point at that directory.
On macOS, the installer builds a small native host that uses the system WebKit framework and does not download Electron.
Windows and Linux use the locked Electron runtime.

On Windows, from Command Prompt:

```bat
scripts\win\install-plugin.bat
```

You need Node.js 22.12 or newer, Git, and OpenCode installed.
The macOS installation also needs Xcode Command Line Tools.
Windows and Linux installations need npm.

## Usage

Open any project with OpenCode:

```sh
opencode <path>
```

A folder with no Preference uses this default, held in memory; nothing is written to the project:

```json
{
  "text": "Work on my request in this folder. Local reads, edits and tests are fine. Do not upload project contents or delete work I did not ask you to delete. Ask when permission is unclear."
}
```

To describe a folder yourself, save `.xor/preference.json` with one free-text `text` field and optional `done_criteria`.
The checker always offers approve, deny, and ask.
An ask answer withholds the action until the owner provides applicable confirmation.
An unreadable Preference blocks the session until you fix it, and the agent cannot edit the file.

Projects set up with an earlier release may still have `.bordercollie/preference.json` or `.opencode/protocol.json`.
Their allowlists are ignored; only their `done_criteria` are read, and only while no Preference exists.
Clean them up when you choose:

```sh
xor migrate
```

`xor migrate` writes the Preference with those done criteria, deletes retired Protocol files, and migrates `.bordercollie` configurations to `.xor`.

Resize the Pet directly, without sending a UI preference through an agent conversation:

```sh
xor pet size 115
xor pet size reset
```

Work on the desktop companion UI:

```sh
cd pet
npm install
npm run start:dev
```

The development window includes animation controls plus local Event stream scenarios for working, allowed and refused actions, completion verdicts, review requests, errors, and Pet size.
It is a visual harness only: it does not start a network listener or alter the private Adapter-to-Pet event path used in production.
Use it to inspect the Pet's focus, visibility, geometry, dragging, and reactions without starting OpenCode.

Animation asset storage and replacement notes live in [docs/archive/pet/animation-assets.md](pet/animation-assets.md).
The Pet validates its complete animation contract before activating it, uses elapsed-time frame scheduling, and shows a stable frame when the operating system requests reduced motion.

Run the fast release-readiness checks:

```sh
npm test
npm run test:package
```

The current automated suite exercises unit behavior, non-UI integration behavior, the CLI, a no-download staged install, and the contents of the npm tarball.
See [the release guide](../RELEASING.md) for the release plan, test layers, and the work GitHub Actions can automate.
Pet UI, native window, renderer, and real OpenCode process coverage live in the e2e layer.

Run the focused xor and plugin behavior tests:

```sh
node --test test/xor/*.test.js test/plugin/*.test.mjs
```

Measure the installed Judge against the fixed evaluation cases:

```sh
npm run eval:judge
```

xor events and active sessions exist only while OpenCode and the Pet are running.
The plugin sends xor events over the Pet process's private input pipe.
Pet size is the persistent setting in the xor configuration.

OpenCode 1.x users must run `opencode upgrade --major` before installing xor.
Project auto-accept does not bypass verifier refusals or owner questions.

Research data and old analysis artifacts are available through [Git LFS](../research-data.md), with file sizes and checksums.
