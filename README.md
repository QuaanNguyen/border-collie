# Border Collie

A desktop border collie that watches your AI coding agent and reacts when something needs attention.

![Border Collie watching agents](docs/border-collie.gif)

## What It Does

Border Collie is a small desktop companion for OpenCode.
In plain terms, it sits beside your coding agent, watches what the agent tries to do, and reacts when the agent is working, blocked, refused, failed, or claiming it is done.

The guard checks actions before they run, blocks work outside the task, and verifies important finish claims against the files in the project.

## Installation

Install the plugin from this repo:

```sh
node scripts/install-plugin.js
```

Or on macOS and Linux:

```sh
bash scripts/install-plugin.sh
```

The installation includes Guard and the desktop Pet.
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

Resize the Pet from the OpenCode chat with `/size` followed by one of the supported percentages:

```text
/size 75
/size 115
/size reset
```

Resize is command-driven and does not install keyboard shortcuts.

Work on the desktop companion UI:

```sh
cd pet
npm install
npm run start:dev
```

Animation asset storage and replacement notes live in [docs/ANIMATION_ASSETS.md](docs/ANIMATION_ASSETS.md).
The Pet validates its complete animation contract before activating it, uses elapsed-time frame scheduling, and shows a stable frame when the operating system requests reduced motion.

Run Guard and plugin behavior tests:

```sh
node --test test/guard/*.test.js test/plugin/*.test.mjs
```

Guard events, active sessions, Pet position, and Pet size exist only while OpenCode and the Pet are running.
The plugin sends events over the Pet process's private input pipe and does not create `~/.border-collie` or replay events from previous sessions.
