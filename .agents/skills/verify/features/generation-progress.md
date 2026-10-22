# Generation progress

## Sub-features

Show generated cases, Gemma review coverage, GLM review coverage, retained cases, excluded families and retained approve, deny and ask counts.

## How to get to it (user POV)

Use `npm run dev:generate-data -- /absolute/path/to/study --status` from the repository root.
Without `--status`, this command performs real generation and reviews using the Mac's gateway credentials.
That writing path is outside this read-only verification journey.

## Driving it with the Node CLI

Capture `npm run dev:generate-data -- xor/prototype/output/checker-authoring --status` and its exit code in the evidence directory.
Verify the study checkpoint and snapshot hashes remain unchanged.
The successful end state is a compact progress display with counts derived from the selected study and no new generation log entries or model calls.

## Gotchas

When the current production builder differs from the frozen study, status refuses with a stale-snapshot error.
Record this failure rather than weakening the test or recomputing historical hashes in place.
The accepted count is model agreement, not human verification.
A denied action may be an accepted sample.
