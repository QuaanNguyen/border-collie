# V2 fine-tuning improvement pilot

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

The scheduler is under maintenance at submission time.
Queued jobs must report their actual pending reason and must not be described as running.

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
node guard/prototype/review-v2-pilot.js prepare guard/prototype/output/v2-improvement-pilot-2026-10-13
node guard/prototype/review-v2-pilot.js review guard/prototype/output/v2-improvement-pilot-2026-10-13 inkling-small 16 12
node guard/prototype/review-v2-pilot.js review guard/prototype/output/v2-improvement-pilot-2026-10-13 kimi-k2-7-code 16 12
node guard/prototype/prepare-v2-pilot-study.js guard/prototype/output/v2-improvement-pilot-2026-10-13
```

Preparation requires a new directory.
Review resumes only missing cases against unchanged inputs.
Freezing and submission refuse to replace an existing plan or submission record.
Keep large data, reviews, and weights outside Git; commit the small final provenance and job manifest with the study implementation.
