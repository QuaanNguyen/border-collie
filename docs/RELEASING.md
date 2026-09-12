# Releasing Border Collie

Border Collie's first supported distribution should be one npm package and one matching GitHub Release.
The npm registry also serves npm, pnpm, Yarn, and Bun, so those clients do not need separate packages.
OpenCode is the only supported adapter for the first release; other agent and editor integrations should be designed and tested as adapters before they are advertised as supported.

The root package is deliberately marked `private` while the package name, registry owner, repository URL, and npm trusted publisher are undecided.
This prevents an accidental public release.
Reserving a name and removing `private` should happen in a small release-enablement change after those decisions are recorded.

## What GitHub Actions can automate

The CI workflow runs on Linux, macOS, and Windows.
It can cheaply catch more than unit-test failures:

- JavaScript syntax errors;
- the CLI contract and a no-download Global bind smoke test;
- missing files or accidentally bundled `node_modules` in the npm tarball;
- platform-specific path and process regressions.

Future workflows can also automate dependency updates, CodeQL/security scans, license checks, changelog generation, release artifact checksums, npm provenance, publishing, and post-publish installation tests.
Publishing should remain separate from CI: trigger it only from a protected version tag or GitHub Release and use npm trusted publishing rather than a long-lived token.

GUI behavior, native host behavior, and a real OpenCode launch belong in a slower integration job.
They should not be confused with unit tests and should not block every small change until reliable hosted-runner fixtures exist.

## Workflows

`CI` is the required merge gate.
It runs syntax checks, unit tests, non-UI integration tests, and package surface checks on Linux, macOS, and Windows across supported Node.js versions.

`Package Compatibility` checks that npm, pnpm, Yarn, and Bun can consume the packed npm artifact.
It proves client compatibility without creating separate packages for those clients.

`E2E` is the slower host-behavior lane.
It runs on relevant path changes, on a schedule, and by manual dispatch for OpenCode, external process, renderer, Electron, and native Pet coverage.

`Release` is the tag-driven publishing lane.
It verifies the package before publishing and fails early while the package remains marked `private`.

## Test layers

1. **Unit tests** call deterministic Guard, Event stream, installer, and Pet helpers with fake inputs using Node's built-in `node:test` runner.
2. **Integration tests** compose Border Collie modules across the OpenCode adapter, installer, owner policy, project policy, and package CLI boundaries.
3. **Package tests** run `npm pack` and inspect the exact tarball file list.
4. **E2E tests** run OpenCode, external processes, the Pet host, native macOS behavior, renderer startup, and desktop window behavior.
5. **Release smoke tests** install the exact published version into a clean environment and exercise `border-collie install`.

Package/plugin code is tested the same way as other code: keep most logic in ordinary exported functions, unit-test those functions, then use a small number of boundary tests for OpenCode and the desktop host.

## First-release checklist

1. Choose and reserve the npm package name.
2. Add `repository`, `bugs`, and `homepage` metadata to `package.json`, then remove `private`.
3. Decide whether `0.1.0` accurately describes the compatibility promise.
4. Keep the root package version, Git tag, and GitHub Release identical.
5. Make CI required on the protected default branch and require reviewed pull requests.
6. Run `npm test`, `npm run check`, and `npm run test:package` locally.
7. Run the e2e suite on hosts that can launch OpenCode and the Pet UI.
8. Inspect the tarball with `npm pack --dry-run`; never publish from an uncommitted working tree.
9. Configure npm trusted publishing for the release workflow and require a GitHub environment approval for the first few releases.
10. Publish a release candidate with the `next` dist tag, install it on all three operating systems, and test it with OpenCode.
11. Publish `0.1.0`, tag the exact commit `v0.1.0`, and create matching GitHub release notes with supported platforms, Node/OpenCode prerequisites, known limitations, and upgrade instructions.
12. Test the public command from a clean directory.
13. If it is broken, deprecate the npm version; do not reuse or move an existing version tag.

Homebrew and WinGet should come later, once the npm package has a stable CLI and upgrade behavior.
They are extra distribution channels, not different implementations.
Each future adapter should state its supported host versions, event mapping, installation path, and integration-test coverage.
