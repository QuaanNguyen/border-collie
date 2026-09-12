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
- missing files or accidentally bundled `node_modules` in the npm tarball;
- package-manager differences in the tarball report shape.

Future workflows can also automate dependency updates, CodeQL/security scans, license checks, changelog generation, release artifact checksums, npm provenance, publishing, and post-publish installation tests.
Publishing should remain separate from CI: trigger it only from a protected version tag or GitHub Release and use npm trusted publishing rather than a long-lived token.

GUI behavior, native host behavior, and a real OpenCode launch belong in a slower integration job.
They should not be confused with unit tests and should not block every small change until reliable hosted-runner fixtures exist.

## Test layers

1. **Tracked release checks** parse JavaScript entrypoints and inspect the exact npm tarball file list.
2. **Local-only unit tests** call deterministic Guard, Event stream, installer, and Pet helpers with fake inputs.
3. **Local-only install smoke tests** install into temporary directories without Electron downloads or a user's real OpenCode configuration.
4. **Integration tests** run OpenCode and the Pet host on each supported OS.
5. **Release smoke tests** install the exact published version into a clean environment and exercise `border-collie install`.

Package/plugin code is tested the same way as other code: keep most logic in ordinary exported functions, unit-test those functions, then use a small number of boundary tests for OpenCode and the desktop host.

## First-release checklist

1. Choose and reserve the npm package name.
2. Add `repository`, `bugs`, and `homepage` metadata to `package.json`, then remove `private`.
3. Decide whether `0.1.0` accurately describes the compatibility promise.
4. Keep the root package version, Git tag, and GitHub Release identical.
5. Make CI required on the protected default branch and require reviewed pull requests.
6. Run `npm run check`, `npm run test:package`, and the local-only test suite locally.
7. Inspect the tarball with `npm pack --dry-run`; never publish from an uncommitted working tree.
8. Configure npm trusted publishing for the release workflow and require a GitHub environment approval for the first few releases.
9. Publish a release candidate with the `next` dist tag, install it on all three operating systems, and test it with OpenCode.
10. Publish `0.1.0`, tag the exact commit `v0.1.0`, and create matching GitHub release notes with supported platforms, Node/OpenCode prerequisites, known limitations, and upgrade instructions.
11. Test the public command from a clean directory.
12. If it is broken, deprecate the npm version; do not reuse or move an existing version tag.

Homebrew and WinGet should come later, once the npm package has a stable CLI and upgrade behavior.
They are extra distribution channels, not different implementations.
Each future adapter should state its supported host versions, event mapping, installation path, and integration-test coverage.
