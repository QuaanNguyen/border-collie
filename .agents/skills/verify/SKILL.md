---
name: verify
description: Verify XOR synthetic permission-checker datasets through the developer CLI, frozen exact-input reviews, coverage reports, exports and CPU audits before preparing fine-tuning data.
---

# Verify checker training samples

## Launch

Run from the repository root with Node 22.12 or newer and Python 3.
The primary surface is the developer data CLI.
The product runtime is a separate surface and its Mac qualification is not covered by a dataset audit.

```sh
node --version
node -e "require('ajv'); require('ajv-formats'); console.log('checker verification ready')"
```

Use `npm ci --ignore-scripts` only if these existing dependencies are missing.
There is no service to start and no credential is needed for read-only verification.
The readiness line is `checker verification ready`.
Choose an existing frozen snapshot explicitly rather than creating or mutating the active authoring study.
For a reproducible current-input integrity journey, use the repaired legacy snapshot below.
It is expected to report pending reviews or other training requirements rather than training readiness.

```sh
checker_snapshot=.audit/checker-training-readiness-2026-10-21/legacy-opaque-review
checker_evidence=.audit/checker-verification/$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$checker_evidence"
```

For a new study use its own frozen snapshot path and its pinned inventory path.
Do not infer the active snapshot from directory modification time.
Use the runner receipt or the explicit path returned by freeze.
Read-only journeys can run side by side because they create separate evidence directories.
Never launch two generation or review writers against the same study.
Teardown requires no server shutdown for these short-lived commands.

## Doctor

```sh
node -e "const fs=require('node:fs');const p=process.argv[1];for(const n of ['manifest.json','proposals.jsonl','review-packet.json'])fs.accessSync(p+'/'+n,fs.constants.R_OK);require('./scripts/verify-checker-data');console.log('frozen snapshot readable; local verifier importable')" "$checker_snapshot" > "$checker_evidence/doctor.txt"
```

Stop on missing files, unavailable dependencies or invalid JSON.
Do not repair evidence in place.
The generation status command can reject a historical study when the current request builder changes.
That is a recorded blocker, not permission to rewrite its hashes.

## Drive

Drive one mapped feature using the exact commands in [the feature index](features/README.md).
The default read-only journey is the integrity command.

```sh
node scripts/verify-checker-data.js docs/checker-tool-inventory.json "$checker_snapshot" > "$checker_evidence/integrity.json"
checker_result=$?
printf '%s\n' "$checker_result" > "$checker_evidence/exit-code.txt"
test "$checker_result" -eq 2
```

Exit 1 means malformed or inconsistent evidence.
Exit 2 means the evidence can be inspected but one or more training requirements remain unsatisfied.
The repaired legacy snapshot must report integrity passed and matching current production inputs.
An intact partial review is pending work.
A historical snapshot can also fail the stricter script checks if it omitted a script body.
A builder mismatch alone is a readiness blocker and does not prove that stored files changed.
Never equate exit 2 with a failed integrity check or a qualified training dataset.
The helper deliberately never grants training eligibility because human safety decisions, tokenizer measurements, blind evaluation provenance and Mac runtime qualification require separate evidence.

## Evidence

Keep the command, its exit code and full JSON report under the selected evidence directory.
Exercise the real CLI rather than constructing an internal accepted count.
Record before and after SHA-256 values for the immutable manifest, proposals and review packet when proving a read-only journey.
Review checkpoints can legitimately change while an owned reviewer is running.
Verify that the snapshot remains unchanged after the command.
A status label alone does not establish absence of side effects.
The automated verification tests exercise the real CLI and compare all snapshot file hashes before and after execution.

```sh
node --test test/unit/checker-verification.test.js > "$checker_evidence/verification-tests.txt"
```

Generated shell commands and scripts are inert sample text.
Never run them to verify their intent.
The verifier makes no model requests and launches no generated command.
Independent model reviews require exact production inputs, distinct model families, matching instruction and input hashes, complete case decisions and recorded gateway model receipts.
A recorded model receipt is local provenance, not an externally authenticated signature or human endorsement.
Model agreement does not establish a correct label.
Split labels do not establish blind evaluation isolation.
A boolean claiming human verification is not a recorded case-bound owner decision.
The observed inventory is finite and dynamic tool catalogs are not universally covered by it.
Preserved historical inputs, including the canceled approximately 3,000-case study, must not be relabeled as repaired data.
Use the separate repair provenance receipt to establish a descendant dataset's ancestry.

## Cleanup

Read-only verification starts no persistent process and requires no cleanup of the selected snapshot.
Remove only temporary data created by a test; its test harness already does so after success or failure.
Do not delete the evidence directory or historical snapshots.
Confirm evidence survived cleanup.

```sh
test -s "$checker_evidence/integrity.json"
test -s "$checker_evidence/doctor.txt"
test -s "$checker_evidence/exit-code.txt"
```

## Helpers

The executable helper is `scripts/verify-checker-data.js`.
It prints JSON and never writes the selected dataset.
Pass two explicit review files if the snapshot contains additional historical review files.

```sh
node scripts/verify-checker-data.js docs/checker-tool-inventory.json "$checker_snapshot" "$checker_snapshot/review-gemma4-31b-it.json" "$checker_snapshot/review-glm-5-3-flash.json"
```

Use `/maintain-verification-skill` when the commands, request builder or feature map change.
