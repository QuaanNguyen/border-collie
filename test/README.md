# Test Layout

`unit/` contains deterministic tests for Guard core, Event stream, installer helper, Pet geometry, animation, and package-surface behavior.

`guard/` contains focused Node test-runner coverage for Guard repository, session, live-protocol, and evidence behavior.

`integration/` contains tests that compose Border Collie modules across the OpenCode adapter, installer, owner policy, project policy, and package CLI boundaries.

`plugin/` contains Node test-runner coverage for the OpenCode plugin lifecycle and policy hooks.

`e2e/` contains tests that exercise external processes, OpenCode, Electron, native macOS behavior, renderer startup, and desktop window behavior.

`fixtures/` contains helper applications and native probes used by the e2e tests.

`run-all-tests.js` is the local full-suite orchestrator.
