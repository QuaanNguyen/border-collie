# Test Layout

`unit/` contains deterministic tests for xor core, Event stream, installer helper, Pet geometry, animation, and package-surface behavior.

`xor/` contains focused Node test-runner coverage for the xor entry with a Judge double, the folder boundary, repository, session, and evidence behavior.

`integration/` contains tests that compose xor modules across the OpenCode adapter, installer, Judge retrieval, `xor migrate`, and package CLI boundaries.

`plugin/` contains Node test-runner coverage for the OpenCode plugin lifecycle, the folder Preference, and the tool hooks.

`e2e/` contains tests that exercise Electron renderer startup and native macOS desktop window behavior.

`fixtures/` contains helper applications, native probes, and the fake Judge download used by install tests.

`run-all-tests.js` is the local full-suite orchestrator.

`scripts/evaluate-judge.js` (`npm run eval:judge`) runs the installed Needle Judge on fixed cases; it is a measurement, not a pass or fail gate.
