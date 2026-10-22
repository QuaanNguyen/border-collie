# Export and CPU audit

## Sub-features

Export only independently reviewed complete coverage into direct-answer training rows and separate validation and test requests.
Audit frozen sample hashes, identities and visible actions on CPU without gateway credentials.

## How to get to it (user POV)

Use the documented `prototype:finetune` export CLI and the Python audit script after inspecting the read-only verification report.
Choose a new output directory for every export and a new report path for every CPU audit.

## Driving it with the Node CLI and Python

```sh
python3 xor/prototype/audit-authored-data.py "$checker_snapshot" "$checker_evidence/cpu-audit.json"
node xor/prototype/checker-data.js export docs/checker-tool-inventory.json "$checker_snapshot" "$checker_evidence/export" "$checker_snapshot/review-gemma4-31b-it.json" "$checker_snapshot/review-glm-5-3-flash.json"
```

Capture each exit code and terminal output independently.
The successful CPU end state is a nonempty report recording integrity and generated commands not executed.
A successful export creates training direct verdict targets and separate validation and test request files in the new directory.
If coverage or exact-input evidence is incomplete, export must refuse without claiming training readiness.

## Gotchas

The preserved historical snapshot is not an export-ready fixture because its current production requests are stale.
Record that journey as blocked with the exact error.
The CPU audit cannot rebuild the production request through Node and is complementary to the Node verifier.
Passing either integrity audit does not prove label correctness or token fit.
Run the separate pinned-tokenizer audit on the exact snapshot before preparing a training job.
Sol receives only credential-free inputs and audit code; gateway credentials remain on the Mac.

```sh
python3 scripts/audit-checker-tokens.py "$checker_snapshot" --archive xor/prototype/output/current-runtime-cache/2ae11323dc000f5e70c49f7403efa6af12ba9e67/needle3.cact --output "$checker_evidence/token-audit.json" --max-length 4096
```

The token audit counts approve, deny and ask under the official renderer and the proposed empty-thinking renderer.
It fails on excessive lengths without truncating input.
It invokes the trusted production request builder and pinned tokenizer, never generated commands.
