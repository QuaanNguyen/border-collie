# Contributing to Border Collie

Border Collie is an OpenCode plugin, deterministic Guard, transient event stream, and optional desktop Pet.
The plugin in `plugin/` adapts OpenCode hooks to Guard decisions and publishes events to the Pet over a private input pipe.
Guard owns policy enforcement and completion evidence, while the Pet only expresses events and never changes Guard outcomes.
The production macOS Pet uses the native AppKit and WebKit host in `pet/native/`, while Windows, Linux, and development mode use the locked Electron runtime in `pet/`.
The root package is public metadata for the upcoming `0.1.0` release, so contributions must not publish it or change release metadata unless the release task explicitly calls for that change.

## Before you start

Use Node.js 22.12 or newer, Git, npm, and an installed OpenCode executable.
Use Xcode Command Line Tools on macOS because the default macOS installer builds the native Pet host.
Use Windows Command Prompt or PowerShell with npm on Windows because the Windows installer delegates to `node` and the checked-in batch wrapper.
Use the repository's current branch and keep unrelated worktree changes intact.
Read `README.md`, `docs/RELEASING.md`, and the relevant domain documentation before changing policy, packaging, OpenCode integration, or Pet behavior.

## Setup

Clone the repository and enter its root directory.

```sh
git clone <repository-url>
cd border-collie
```

Install the locked Pet dependencies before running any renderer, Electron, or full-suite checks.

```sh
npm ci --prefix pet
```

The root package has no runtime dependency installation step today, but running the root commands from the repository root is required because the scripts resolve repository-relative paths.
The Pet lockfile pins Electron 44.3.0, and `npm ci --prefix pet` is the supported way to reproduce that runtime.
Start the development Pet when you need to inspect the desktop UI directly.

```sh
cd pet
npm run start:dev
```

The development Pet accepts the same live event model as the installed Pet and supports the renderer development path.
Return to the repository root before running root-level checks.

## Checks and test layers

Run the syntax checks for the packaged JavaScript entry points before opening a pull request.

```sh
npm run check
```

Run the fast unit and non-UI integration suite.

```sh
npm test
```

Run the focused Guard and plugin suites when changing those boundaries.

```sh
node --test test/guard/*.test.js test/plugin/*.test.mjs
```

Run the package surface check to verify required files and ensure `node_modules/` is absent from the tarball.

```sh
npm run test:package
npm pack --dry-run
```

Run the full local orchestrator when changing Pet, installation, lifecycle, or cross-process behavior.

```sh
node test/run-all-tests.js
```

The full orchestrator runs the selected unit and integration suites, the real OpenCode session test, and the renderer and window tests when the locked Electron runtime is available.
Use `BORDER_COLLIE_SKIP_NATIVE_TESTS=1 node test/run-all-tests.js` when native or Electron acceptance is unavailable, but report that reduced coverage in the pull request.

Run the E2E lane directly when changing external processes, OpenCode integration, the renderer, or the Pet host.

```sh
npm run test:e2e
```

Run the non-native E2E subset on Windows, Linux, or a machine where native macOS acceptance is not available.

```sh
npm run test:e2e:skip-native
```

The CI environment automatically skips the live OpenCode E2E test when `CI=true`, so a passing CI run is not a substitute for a local live OpenCode check when the adapter changes.

## Live OpenCode testing

Install the current worktree into OpenCode's global plugin directory before testing the real integration.

```sh
node scripts/install-plugin.js
```

The installer stages and verifies the plugin before replacing the existing global package, preserves the owner policy, and builds the native macOS Pet or installs the locked Electron runtime on other platforms.
The installer may download Electron on Windows and Linux when a matching installed runtime is not reusable.
OpenCode must be restarted after installation because it loads global plugins at startup.

Open a disposable project with OpenCode from a separate directory.

```sh
opencode <path-to-disposable-project>
```

Exercise the `/size` command with `75`, `115`, and `reset`, and confirm that the Pet changes size without installing keyboard shortcuts.
Exercise an allowed read or edit inside the project and confirm that the Pet remains quiet or shows the expected allowed activity.
Exercise a path, command, or egress action outside the active Protocol and confirm that Guard refuses it with a remediation message.
Create or modify `.opencode/protocol.json` only as a human during this test, because project policy may narrow the owner policy but cannot broaden it.
Ask OpenCode to make a completion claim that is missing required evidence, then satisfy the criterion and continue the session to verify failed and accepted completion verdicts.
Confirm that an OpenCode restart starts a fresh event stream and that events are not replayed from a previous session.
Use a disposable owner configuration and disposable project when testing installer or policy migration behavior.
Do not put real API keys, private data, or production workspaces in test fixtures or issue reports.

The deterministic OpenCode E2E test uses a local mock OpenAI-compatible server and does not require a model API key.
Run it through the normal E2E command when `opencode` is installed and available on `PATH`.

```sh
node test/e2e/opencode-session.test.js
```

The test installs the plugin into temporary OpenCode configuration, runs the `size` command, observes a failed completion claim, then verifies a later accepted claim without recursively starting another model turn.

## Windows testing

Run the Windows installer from Command Prompt at the repository root.

```bat
scripts\win\install-plugin.bat
```

The batch wrapper changes to the repository root and invokes `node scripts\install-plugin.js`.
Windows uses the Electron Pet runtime and does not use the macOS Swift host or Xcode toolchain.
Use `npm ci --prefix pet` before UI tests and use `npm run test:e2e:skip-native` for the supported Windows E2E command.
Verify the installed command with `opencode <path-to-disposable-project>` after restarting OpenCode.
When a test fails only on Windows, include the exact shell, Node version, OpenCode version, path shape, and stderr in the report.
Check both relative and absolute paths when changing installation or policy code because platform path handling is part of the supported behavior.

## Package-manager compatibility

The package is published as one npm artifact, and npm, pnpm, Yarn, and Bun are expected to consume that same packed artifact.
Do not add client-specific package layouts or lockfiles to the root package to solve a client compatibility issue.

Run the compatibility check for each available client.

```sh
node scripts/check-package-client.js npm
node scripts/check-package-client.js pnpm
node scripts/check-package-client.js yarn
node scripts/check-package-client.js bun
```

The check runs `npm pack`, installs the resulting tarball into a clean temporary directory, and verifies the installed CLI and plugin entry points.
Install or enable a missing client with its normal toolchain before running that client check, and record unavailable clients instead of silently skipping them.
The Package Compatibility workflow runs all four clients on Linux, macOS, and Windows.

## Documentation fixes

Keep documentation aligned with executable scripts, package contents, OpenCode behavior, and the architecture described in `CONTEXT.md`.
Update the closest existing document when correcting a fact, and add a new document only when the topic has a durable audience and no suitable home.
Use repository-relative links that resolve from the document's directory.
Keep long Markdown readable by putting each full sentence on its own physical line.
Do not manually edit generated artifacts such as animation outputs or changelogs when a repository script or release process owns them.
For OpenCode API or permission claims, record the version or date checked and link to authoritative documentation when appropriate.

## Bug fixes

Start by reproducing a user-visible bug through the closest E2E path, especially for installation, OpenCode, process lifecycle, renderer, native host, and Windows issues.
Reduce the reproduction to a deterministic unit or integration test after confirming the end-user failure.
Keep the fix at the narrowest responsible boundary, such as Guard policy resolution, the OpenCode adapter, the event stream, the Pet host, or packaging.
Preserve fail-closed behavior for ambiguous policy, malformed active-project Protocol files, protected paths, and unsupported subagent policy inheritance.
Do not describe OpenCode permissions as an operating-system sandbox or as a complete shell filesystem boundary.
Run the relevant focused tests, the fast checks, and the closest E2E coverage before submitting the change.

## Pull request expectations

Keep each pull request focused on one coherent change and explain the user-visible behavior in the description.
State the problem, the approach, affected platforms, and any compatibility or security implications.
List the exact validation commands that passed and identify checks that could not run.
Include screenshots or short recordings for visible Pet or renderer changes when they make the result easier to review.
Call out changes to policy semantics, package contents, installer behavior, OpenCode hooks, or release metadata explicitly.
Do not publish packages, alter protected release configuration, or make unrelated cleanup changes as part of a normal contribution.
Keep source comments out of new code and express intent through names, types, and structure.
Request review only after the worktree contains the intended changes and no unrelated files are modified.

## AI use and testing expectations

AI-assisted contributions are welcome when the author understands, reviews, and can explain the resulting change.
The author remains responsible for correctness, security, licensing, dependency choices, and the final test report.
Do not paste secrets, private customer data, or unreviewed proprietary material into an AI tool or repository fixture.
Treat generated code as a draft and check it against the actual scripts, architecture, OpenCode contracts, and platform behavior.
Add or update tests for changed behavior, including a regression test for a reproduced bug whenever practical.
Use deterministic fixtures and temporary directories for process, policy, package, and OpenCode tests.
Do not weaken a test, remove a platform case, or skip a failing check without documenting the reason and the resulting coverage gap.
For changes involving live OpenCode behavior, report both automated results and the manual live-session steps that were performed.

## Minimum submission checklist

- [ ] `npm run check` passes.
- [ ] `npm test` passes.
- [ ] `npm run test:package` passes.
- [ ] The relevant focused tests pass.
- [ ] The relevant E2E or live OpenCode test passes, or the unavailable coverage is documented.
- [ ] Package-manager compatibility was checked for the clients relevant to the change.
- [ ] Windows behavior was checked for platform-sensitive changes.
- [ ] Documentation and release notes remain accurate for the change.
- [ ] The pull request describes validation, limitations, and any AI assistance used.
- [ ] Only intended files are changed.
