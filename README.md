# Border Collie

A desktop border collie that watches your AI coding agent and reacts when something needs attention.

![Border Collie watching agents](docs/border-collie.gif)

## What It Does

Border Collie is a small desktop companion for OpenCode.
In plain terms, it sits beside your coding agent, watches what the agent tries to do, and reacts when the agent is working, blocked, refused, failed, or claiming it is done.

The guard checks every tool call before it runs.
A small on-device model, the Judge, reads your latest message, the folder Preference, and the proposed call, and answers allow, disallow, or ask.
Paths outside the project folder and changes to the Preference are refused in code before the Judge runs.
The guard also verifies important finish claims against the files in the project.

The Judge is the base [Needle 3](https://github.com/cactus-compute/needle) model from Cactus Compute, run locally with telemetry off.
It is not tuned for this job yet, so expect some wrong calls in both directions; `npm run eval:judge` measures it on a fixed set of cases.
Border Collie is not an operating-system sandbox.

## Installation

OpenCode is the currently supported Guard-enforcing integration.
Codex CLI and Claude Code are not yet advertised as Guard-enforcing because their deny-before-run coverage has not been verified.

For the public npm package, install the CLI globally and then install the plugin:

```sh
npm install --global @quaannguyen/border-collie
bdc install
```

The npm installation includes Guard and the desktop Pet.
`bdc install` also downloads the Needle runner for your platform and the 35 MB `needle3.cact` weights from Hugging Face, checks both against pinned SHA-256 digests, and caches them under `~/.cache/border-collie/judge` (`%LOCALAPPDATA%\border-collie\judge` on Windows).
If that download or check fails, the previously installed plugin stays in place.
The Judge has runners for macOS on Apple Silicon, Linux x64 and ARM64, and Windows x64 and ARM64.

To install from a source clone for development:

```sh
git clone https://github.com/QuaanNguyen/border-collie.git
cd border-collie
node scripts/install-plugin.js
```

Or on macOS and Linux:

```sh
bash scripts/install-plugin.sh
```

The installation includes Guard and the desktop Pet.
OpenCode v2 loads the package directory `~/.config/opencode/plugins/border-collie`. A configured path must point at that directory; a bare `border-collie.js` file is not a v2 plugin.
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
  "purpose": "Software work in this folder for the user's request.",
  "allow": "Ordinary local reads, edits, and commands inside this folder that serve the user's request.",
  "disallow": "Sending project contents off the machine, and destructive actions the user's request did not ask for.",
  "ask": ""
}
```

To describe a folder yourself, save `.border-collie/preference.json` with any of those four prose fields and optional `done_criteria`.
Fields you leave out keep the default text.
With `ask` empty the Judge never asks; set it to something like `"pushing or deploying"` to have those calls held until you answer in the chat.
An unreadable Preference blocks the session until you fix it, and the agent cannot edit the file.

Projects set up with an earlier release may still have `.border-collie/protocol.json` or `.opencode/protocol.json`.
Their allowlists are ignored; only their `done_criteria` are read, and only while no Preference exists.
Clean them up when you choose:

```sh
bdc migrate
```

`bdc migrate` writes the Preference with those done criteria, deletes both Protocol files, and removes retired profiles from the Border Collie configuration while keeping the Pet size.

Resize the Pet directly, without sending a UI preference through an agent conversation:

```sh
bdc pet size 115
bdc pet size reset
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

Animation asset storage and replacement notes live in [docs/ANIMATION_ASSETS.md](docs/ANIMATION_ASSETS.md).
The Pet validates its complete animation contract before activating it, uses elapsed-time frame scheduling, and shows a stable frame when the operating system requests reduced motion.

Run the fast release-readiness checks:

```sh
npm test
npm run test:package
```

The current automated suite exercises unit behavior, non-UI integration behavior, the CLI, a no-download staged install, and the contents of the npm tarball.
See [the release guide](docs/RELEASING.md) for the release plan, test layers, and the work GitHub Actions can automate.
Pet UI, native window, renderer, and real OpenCode process coverage live in the e2e layer.

Run the focused Guard and plugin behavior tests:

```sh
node --test test/guard/*.test.js test/plugin/*.test.mjs
```

Measure the installed Judge against the fixed evaluation cases:

```sh
npm run eval:judge
```

Guard events and active sessions exist only while OpenCode and the Pet are running.
The plugin sends Guard events over the Pet process's private input pipe.
Pet size is the persistent setting in the Border Collie configuration.
