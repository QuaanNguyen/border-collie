# Coverage and training readiness

## Sub-features

Report observed inventory entries, verified input contracts, represented tool identities and unknown contracts.
Count approve, deny, ask and shipped-default Preferences separately for each tool and split.
Report required risk-topic coverage and runtime interception gaps.

## How to get to it (user POV)

Read the verification JSON produced for the frozen snapshot.
Use the same inventory whose hash the snapshot records.

## Driving it with the Node CLI

Run the helper and inspect `toolCoverage`, `coverage.breakdown`, `coverage.topics`, `coverage.missing`, `coverage.runtimeGaps` and `blockers`.
A complete observed data-coverage end state requires an empty missing list.
Training readiness additionally requires verified case-bound human decisions, pinned-tokenizer evidence, independent blind evaluation provenance and Mac direct-output runtime qualification.
Those external checks are not granted by this helper.

## Gotchas

The current observed inventory contains 150 entries and 132 checked contracts.
The 18 unknown contracts and dynamic catalogs prevent a universal all-tools claim.
Schema coverage does not establish actual runtime interception.
The approximately 3,000 historical samples are not a count target or evidence of V3 coverage.
The helper intentionally reports training eligibility as false until a separate gate checks the evidence outside its scope.
