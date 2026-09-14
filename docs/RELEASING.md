# Releasing Border Collie

Border Collie's first supported public distribution should be one npm package and one matching GitHub Release.
The npm registry also serves npm, pnpm, Yarn, and Bun, so those clients do not need separate packages.
OpenCode is the only supported adapter for the first release; other agent and editor integrations should be designed and tested as adapters before they are advertised as supported.

The root package is configured as the public scoped `@quaannguyen/border-collie@0.1.0` package.
The npm package name and repository metadata are recorded in `package.json`.
The remaining public-release gates are npm ownership and trusted-publisher configuration, protected-branch controls, release-candidate validation, and clean installation checks.

## What GitHub Actions can automate

The CI workflow runs on Linux, macOS, and Windows with Node.js 22.12, 24, and 26.
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
Every matrix job runs `npm run check`, `npm test`, and `npm run test:package` on Linux, macOS, and Windows with Node.js 22.12, 24, and 26.
The protected default branch should require the complete `CI` workflow to pass.

`Package Compatibility` checks that npm, pnpm, Yarn, and Bun can consume the packed npm artifact.
It runs on Linux, macOS, and Windows with Node.js 22.12 when package or package-related paths change, and should be green before a public release.

`E2E` is the slower host-behavior lane.
Its non-native job runs the Electron renderer and lifecycle coverage on Ubuntu with a virtual display.
Its native macOS Pet job runs only on scheduled or manually dispatched runs.
Windows UI behavior is covered by the contributor Windows test procedure and should be exercised on a Windows host before a public release.
Run the relevant E2E coverage before a public release; it is not part of the fast `CI` merge gate.

`Release` is the tag-driven publishing lane.
For a version tag matching `v*.*.*`, its Ubuntu Node.js 22.12 verification job runs `npm run check`, `npm test`, `npm run test:package`, and `npm pack --dry-run` before the publish job can start.
Manual dispatch runs the verification job without publishing.
The tag-triggered publish job requires the `npm` environment, refuses to publish a private package, and publishes with npm provenance.

## Test layers

1. **Unit tests** call deterministic Guard, Event stream, installer, and Pet helpers with fake inputs using Node's built-in `node:test` runner.
2. **Integration tests** compose Border Collie modules across the OpenCode adapter, installer, owner policy, project policy, and package CLI boundaries.
3. **Package tests** run `npm pack` and inspect the exact tarball file list.
4. **E2E tests** run OpenCode, external processes, the Pet host, native macOS behavior, renderer startup, and desktop window behavior.
5. **Release smoke tests** install the exact published version into a clean environment and exercise `border-collie install`.

Package/plugin code is tested the same way as other code: keep most logic in ordinary exported functions, unit-test those functions, then use a small number of boundary tests for OpenCode and the desktop host.

## First-release checklist

1. Choose and reserve the npm package name.
2. Verify `repository`, `bugs`, and `homepage` metadata in `package.json`, record the npm trusted-publisher configuration, and keep the package public for the release candidate.
3. Decide whether `0.1.0` accurately describes the compatibility promise.
4. Keep the root package version, Git tag, and GitHub Release identical.
5. Make the complete `CI` workflow required on the protected default branch and require reviewed pull requests.
6. Run `npm test`, `npm run check`, and `npm run test:package` locally.
7. Require `Package Compatibility` to pass for package-related changes.
8. Run the E2E suite on hosts that can launch OpenCode and the Pet UI.
9. Inspect the tarball with `npm pack --dry-run`; never publish from an uncommitted working tree.
10. Configure npm trusted publishing for the release workflow and require a GitHub environment approval for the first few releases.
11. Publish a release candidate with the `next` dist tag, install it on all three operating systems, and test it with OpenCode.
12. Tag the exact release commit as `v0.1.0` and let the tag-driven `Release` workflow verify and publish it.
13. Create matching GitHub release notes with supported platforms, Node/OpenCode prerequisites, known limitations, and upgrade instructions.
14. Test the public command from a clean directory.
15. If it is broken, deprecate the npm version; do not reuse or move an existing version tag.

Homebrew and WinGet should come later, once the npm package has a stable CLI and upgrade behavior.
They are extra distribution channels, not different implementations.
Each future adapter should state its supported host versions, event mapping, installation path, and integration-test coverage.
