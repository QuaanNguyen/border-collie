# V2 fine-tuning improvement pilot

The owner canceled all remaining jobs on October 16, 2026.
This document describes the historical study and its completed artifacts.
The earlier permission to submit this study does not authorize new jobs during the [dataset repair](dataset-repair-status.md).
The [cancellation receipt](experiments/v2-pilot-cancelled-2026-10-16.json) records the canceled tasks.

This is the first diagnostic training stage of the improvement plan in issues #54, #57, #58, #59, #60, #61, and #65.
The owner authorized new Sol jobs on October 13, 2026.
Previous experiments and frozen inputs stay unchanged in their own directories.

## Data contract

Copy the development and historical diagnostic Scenarios into a new evidence directory.
Use V2 shell names and file-path arguments, preserve distinct write semantics, and exclude calls the folder boundary blocks before the Judge.
Append the same explicit permission precedence and sensitive-read rules to every custom Preference.
The sensitive-directory rule covers other users' directories on Sol.
All cases offer the three Verdict tools, avoiding the old shortcut in which tool availability revealed the answer.
The production request builder and shipped default Preference remain unchanged.

Two different model families review only the visible runtime query and tool descriptions.
They see no previous Verdict, family, category, or other review.
Every review records the exact input hash and model metadata.
Quarantine a complete family when either reviewer abstains or they disagree.
Exclude conflicting duplicate inputs and overlap across data splits.
Keep excluded cases and their reasons for later disputed-case review under #60.

Freeze 1,000 distinct family-separated training cases and 100 validation cases after review.
Record class, category, topic, and exclusion counts.
Use a fixed 100-case training sample for fitting diagnostics.
The historical diagnostic set remains descriptive and cannot choose a seed or setting.
No new blind set or human-reviewed gold set is claimed.
Missing coverage remains visible under #57 and #59 rather than being filled with duplicates or validation cases.

## Registered comparisons

| Comparison | Seeds | Training cases | Rank | Optimizer updates | Target |
| --- | --- | --- | --- | --- | --- |
| Matched untuned export | 0, 1, 2 | 0 | 16 | 0 | None |
| Fitting sweep | 0, 1, 2 | 1,000 | 16, 32 | 300, 1,500, 3,000 | One Verdict, no reasoning |
| Target-format control | 0, 1, 2 | Same 1,000 | 16 | 300 | One Verdict plus fresh reviewer explanation |

The pilot has 24 model conditions, including three matched untuned controls.
Keep the same data, batch size of 20, learning rate of 0.0001, base checkpoint, full 20-layer four-bit export, tokenizer, and pinned evaluation engine.
Set LoRA alpha to twice the rank.
The official trainer runs unchanged, with separate integer-epoch runs for each update budget.
It does not restore a best epoch automatically.
Record the actual padded length for each target format; reasoning may change the tensor shape and the comparison measures the complete target-format intervention.

The installed trainer has no external validation-file argument.
Use its verified seed permutation to place the registered family-separated validation cases into the internal split exactly.
Audit the resulting indices, file hashes, example count, optimizer-step count, and trainer source hash.
Fail rather than silently clip token evidence.

## Sol execution

Use a separate scratch directory named `v2-improvement-pilot-2026-10-13`.
Token preflight precedes the first GPU build.
The matched baseline build and a small native-engine compatibility check must succeed before the fitting array becomes eligible.
Allow at most two concurrent A100 training tasks and four CPU evaluation tasks.
Each GPU task requests 32 GiB RAM, eight CPUs, and at most four hours.
Each candidate receives independent fitting, validation, and historical diagnostic measurements.
Telemetry stays disabled.
Credentials used for review stay on the owner's Mac and are never copied to Sol.

The original submission occurred during scheduler maintenance.
Queued jobs must report their actual pending reason and must not be described as running.

On October 15, token preflight job 65695482 passed, but baseline job 65695585 failed before export because the official builder forced a Hub download while offline mode was enabled.
Slurm canceled the dependent engine, fitting, and evaluation jobs, and the summary reported an incomplete study.
The original directory, plan, inputs, and failure logs remain unchanged.

The October 16 recovery uses a separate directory named `v2-improvement-pilot-2026-10-16-offline-recovery`.
Every frozen data hash, review, model condition, training setting, and evaluation setting matches the original pilot.
The wrapper verifies a pinned local base archive and supplies it to the unchanged official exporter instead of downloading it.
It also verifies the official trainer source and package version before export.
The recovery plan records the original plan hash and the reason for the change.
Because Slurm no longer accepted a dependency on the old completed preflight job, the recovery repeats that audit under a fresh job ID.
The actual job receipt and observed outcomes are recorded in `docs/experiments/v2-pilot-recovery-2026-10-16.json`.

The recovery token audit and baseline export passed, including an exact match to the registered untuned export hash.
The Linux engine preflight then exceeded its unchanged 15-second deadline on the fourth case, withholding all fitting and evaluation tasks.
A separate CPU diagnostic completed all repeated cases, but observed total wall times between 1.75 and 33.12 seconds with four threads.
A second diagnostic measured container startup near 0.3 seconds and three local-image inferences between 1.61 and 1.97 seconds on another node.
These observations do not establish a root cause for the variable Linux latency.
A syscall probe completed the same four inputs in 2.23 to 2.77 seconds without reproducing the long delay under tracing.
The same four inputs and two additional repeats completed on the pinned Mac runner between 0.17 and 0.26 seconds with the unchanged 15-second deadline.
This is untuned compatibility evidence, and does not establish trained-model latency or close issue #61.
No fitting run or model promotion occurred in this recovery.

## Single-worker repair and comparison

The follow-up uses `v2-improvement-pilot-2026-10-16-one-worker`, with all earlier study directories and frozen inputs preserved.
The owner approved replacing only the nine newly created, unstarted jobs 65790130 through 65790138 after a node-specific resource wait and Sol's refusal to change pending placement.
Their submission receipts and cancellation reason remain in the new study directory.

Two controlled CPU comparisons ran on different Sol nodes using the same model, inputs, and four-CPU allocations.
The affected node reproduced a 23.87-second four-worker inference with 34.07 CPU-seconds even with a clean environment.
Single-worker cases completed within 6.17 seconds on both nodes.
This establishes a useful configuration boundary, while the underlying native implementation cause remains unverified.
The new study uses one Linux worker for every model and preserves the 15-second deadline, output cap, pinned engine, and container.
A separate 60-case regression check on the other previously failing node passed with zero infrastructure errors and a maximum of 5.49 seconds.

The unchanged 24 model conditions are scheduled in two waves.
All zero-update and 300-update conditions across all three seeds run before the longer update budgets.
The second wave waits for both fitting and evaluation from the first wave, preserving the total limits of two GPU tasks and four CPU evaluation tasks.
Submission checks reject missing or repeated condition indices before queueing any jobs.

The actual Mac runner is also evaluated against the exact frozen fitting sample, validation cases, and historical diagnostics.
Every result records the model digest, runner digest, evaluation-script digest, request fingerprints, raw response, elapsed time, and source-model provenance.
Failed inference invalidates an evaluation rather than becoming a guessed label.
Saved evaluations are not overwritten.
The baseline and three prior-data controls have completed all 439 Mac cases each.
The untuned baseline obtains 41 percent validation accuracy, with 50 percent prohibited approvals and 43.59 percent ordinary refusals.
The prior-data controls obtain 38 to 41 percent validation accuracy, 25 to 29.55 percent prohibited approvals, and 74.36 to 76.92 percent ordinary refusals.
These results use the revised input contract and are not directly interchangeable with historical scores under the old contract.

Run `python3 xor/prototype/compare-pilot-native.py <study-directory>` to regenerate the paired native comparison from saved evidence.
It compares every completed seed and reports a paired family-block bootstrap interval with seed resampling.
The short-budget reasoning controls also permit comparison against prior-data models matched for example count, seed, adapter rank, and optimizer updates.
That comparison measures the combined revised input contract, reviewed labels, selected examples, and resulting padding rather than isolating label edits alone.
Only development validation can select a setting, and only after all three seeds for that setting complete.
Historical diagnostics remain descriptive, and fresh blind and human-verified critical evaluations remain prerequisites for promotion.

### Initial native results

The first completed seed does not establish improved deployed quality.
The rank-16 and rank-32 answers-only models score 41 and 42 of 100 validation cases, compared with 41 for the matched untuned export.
Both approve 10 of 44 prohibited actions and refuse 32 of 39 ordinary actions.
The rank-16 reasoning control scores 50 of 100, compared with 40 for its seed-matched prior-data control, but approves 22 of 44 prohibited actions.
The remaining registered seeds and longer budgets are still pending or running, so no setting is eligible for selection yet.
The second rank-16 answers-only seed scores 45 of 100, approves 9 of 44 prohibited actions, and refuses 31 of 39 ordinary actions.
The mean validation accuracy change across the first two seeds is two percentage points, with a paired family-block bootstrap interval from about minus 10.2 to plus 13.1 points.
This partial interval does not establish an improvement, and the third seed is still required.

The completed Linux baseline evaluation covers all 439 cases with zero infrastructure errors, 6.42-second 95th-percentile latency, and 7.40-second maximum latency.
It uses one worker and the unchanged 15-second deadline.
On the same 100 validation cases, one-worker and four-worker Mac baseline runs differ on two decisions, and the one-worker Linux and Mac runs differ on three more decisions.
All three runs score 41 of 100 overall.
This single-model diagnostic establishes that aggregate equality is insufficient for input-and-output agreement; it does not isolate a general platform effect.

A separate 114-case owner-rule diagnostic covers six sensitive-file families, direct reads, shell reads, specific permission, initial confirmation, exact approval, refusals, different files, edits, uploads, and ordinary reads.
It was frozen before candidate native results and uses only fictional paths and proposed actions as text.
Its labels follow the owner's rule but are not independently human-reviewed blind gold.
The three prior-data models score 65 to 69 cases correctly; the first answers-only models score 58 and 62, and the reasoning control scores 57.
Both answers-only models refuse all 24 permitted or ordinary reads.
This diagnostic cannot select a setting or authorize promotion.

The first answers-only models' official validation scores are 57 and 56 of 100, exceeding their native scores.
The pinned official scorer applies four-bit weight quantization, while its generation function leaves activation and KV fake quantization disabled.
The native runtime also starts each turn with a thinking marker, whereas the official answers-only target begins with a tool-call marker.
The native behavior is documented in the [Cactus porting guide](https://www.cactuscompute.com/blog/porting-needle#the-prompt-on-the-wire).
These are compatibility differences to investigate, not proof that either alone caused the native quality gap.
A six-case reference likelihood probe still favors blocking the ordinary and ask cases under the training-style prompt.
The paired reference probe with activation and KV fake quantization disabled changes likelihoods but preserves that preferred Verdict for all six cases.
It does not explain the native gap by itself and is not a free-generation accuracy measurement.
A separate fitting-only copy with one explicit task-role prefix reduces accuracy for the baseline and both answers-only candidates, so that prefix is rejected.
No frozen study input, production prompt, installed trainer, or queued condition was changed for these probes.

### Collected results at the next status check

All three 300-update answers-only seeds have now completed native evaluation.
Rank 16 scores 41, 45, and 45 of 100 validation cases; rank 32 scores 42, 40, and 41, against 41 for the untuned baseline.
Their mean accuracy changes are about plus 2.7 and zero percentage points, respectively, and both paired uncertainty intervals include zero.
The rank-16 candidates refuse 31 to 32 of 39 ordinary cases, while rank 32 refuses 32 to 33.
Two reasoning controls score 50 and 53, but approve 22 and 17 of 44 prohibited actions.
None meets the promotion gates.
The last successful Sol snapshot was October 16 at 12:41 p.m. Central, with the final short-budget reasoning condition still running.
Subsequent SSH connections timed out, so the current queue and longer-budget execution cannot be confirmed from that snapshot.
The local short-budget collector now retries connectivity failures while preserving completed evaluations and leaving Slurm jobs unchanged.

## Decisions after results

Use validation to distinguish failure to fit from poor generalization or excessive refusal.
Report harmful approvals, ordinary refusals, ask precision and recall, missing Verdicts, permission contrast families, latency, and results by topic, category, and Preference.
Report all three seeds and their spread.
An improved fitting result can justify expanding the selected design to ten seeds and then running the matched sample-size study.
It cannot justify promoting a model.

Promotion still needs a fresh blind evaluation set under #59, sufficient topic coverage under #57, completed V2 worktree and patch contracts under #65, and evaluation on the actual Mac runner under #61.
The promotion limits remain at most 5% harmful approvals and at most 10% ordinary refusals, improving both against the matched baseline.

## Commands

```sh
node xor/prototype/review-v2-pilot.js prepare xor/prototype/output/v2-improvement-pilot-2026-10-13
node xor/prototype/review-v2-pilot.js review xor/prototype/output/v2-improvement-pilot-2026-10-13 inkling-small 6 8
node xor/prototype/review-v2-pilot.js review xor/prototype/output/v2-improvement-pilot-2026-10-13 kimi-k2-7-code 6 8
node xor/prototype/prepare-v2-pilot-study.js xor/prototype/output/v2-improvement-pilot-2026-10-13
```

Preparation requires a new directory.
Review resumes only missing cases against unchanged inputs.
Freezing and submission refuse to replace an existing plan or submission record.
Keep large data, reviews, and weights outside Git; commit the small final provenance and job manifest with the study implementation.

The startup regression check is `python3 test/unit/needle-study-startup.test.py`.
It exercises run creation and registered settings through the training entry point with hardware dependencies replaced, before the actual GPU build and engine checks on Sol.
The offline export regression check is `python3 test/unit/needle-study-export.test.py`.
It verifies local archive selection, refusal of changed archives and trainer sources, rejection of unexpected archive requests, and restoration of the fetch boundary after an export failure.
