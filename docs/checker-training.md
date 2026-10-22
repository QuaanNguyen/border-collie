# Generate and qualify checker training data

The active task is to generate varied synthetic scenarios using the current production request format.
Each scenario contains a natural user request, one free-text project Preference, and one complete proposed tool call.
The training target is one approve, deny, or ask answer without an explanation.

## Recorded restart on October 20, 2026

The earlier 1,656-case V3 draft was generated from templates.
It was not a completed model-authored training dataset.
The new 24-case model-authored smoke snapshot has complete reviews from Inkling and Kimi.
Both reviewers agreed on 16 cases, and eight cases in two disputed families remain quarantined.
The retained answers comprise nine approvals, five refusals, and two requests for confirmation.
These cases have not passed human verification and are not qualified training data.

Two credential-free Sol CPU jobs completed successfully.
The first audited the preserved template baseline, and the second audited the new frozen 24-case snapshot.
Their receipts are in [the restart record](experiments/fine-tuning-reset-2026-10-20.json).
The broader authoring configuration plans 1,764 cases across 132 verified tools and three isolated splits.
It excludes 18 unverified tool contracts.
Current generated outputs and progress remain local until frozen and archived.
No new model has been trained or promoted by this restart.

## Repair and verify current samples

The October 21 repair preserves the earlier studies and their frozen hashes.
Earlier reviews do not qualify inputs whose production answer-tool descriptions changed.
Prepare an immutable successor and obtain new exact-input reviews instead of changing historical hashes.

```sh
node xor/prototype/repair-checker-study.js xor/prototype/output/checker-authoring /tmp/new-checker-study
npm run dev:generate-data -- /tmp/new-checker-study
```

Recovery checks saved cases against recorded author responses and verified ancestor receipts.
It validates script visibility in every shell case and records a separately bounded repair allocation alongside historical consumption.
The full authoring configuration includes eight required safety topics.
Parallel-action scenarios contain a common request and Preference with two prohibited actions and one permitted read.
An incomplete or inconsistent parallel group stays excluded as a whole.

The default developer command follows `xor/prototype/output/checker-active-study.json` when that local receipt exists.
The receipt pins the selected study plan, and an explicit directory overrides it.
The status command reads progress without making model requests.
Two writers cannot own the same study.

Model reviews can reuse an unchanged case from another frozen snapshot in the same developer review directory.
Reuse requires exact case identities, production inputs, reviewer identities and review instructions.
The new checkpoint preserves a hashed copy of the original review evidence.
Changed inputs and the earlier request descriptions require new reviews.

Inspect a frozen snapshot before preparing a training job.

```sh
node scripts/verify-checker-data.js docs/checker-tool-inventory.json /absolute/path/to/snapshot
python3 xor/prototype/audit-authored-data.py /absolute/path/to/snapshot /tmp/new-cpu-audit.json
python3 scripts/audit-checker-tokens.py /absolute/path/to/snapshot --archive xor/prototype/output/current-runtime-cache/2ae11323dc000f5e70c49f7403efa6af12ba9e67/needle3.cact --output /tmp/new-token-audit.json --max-length 4096
```

The Node verifier exits with 1 for inconsistent evidence and 2 for intact inputs with unfinished training requirements.
An incomplete review is pending work, and a review falsely claiming completion fails integrity.
The token audit measures all three direct targets with the pinned official tokenizer under both the official renderer and the proposed empty-thinking renderer.
It reports excessive lengths without truncating examples.
Neither renderer measurement establishes trained-model behavior.

The project verification skill is [`.agents/skills/verify/SKILL.md`](../.agents/skills/verify/SKILL.md).
Its feature map covers generation progress, frozen inputs, independent reviews, coverage, exports and CPU audits.

## Recover historical training scenarios

```sh
node scripts/audit-legacy-checker-data.js /tmp/new-legacy-checker-audit
```

The original 3,000 cases use retired structured Preferences, answer names and tool contracts.
The audit keeps their original files unchanged and excludes held-out material from migration.
It converts only complete training families with unambiguous current argument mappings and fresh opaque case identities.
Unsupported shell scenarios, obsolete tools and placeholder content stay excluded.
No old verdict or review becomes a new training label.
The resulting snapshot still needs independent reviews, semantic leakage checks and the training requirements below.

## Generate model-authored scenarios

The active author is `gemma4-31b-it` following the owner's October 20 model switch.
The review pair is `gemma4-31b-it` and `glm-5-3-flash`.
Earlier Inkling and Kimi results remain historical evidence.

Start or resume generation with the compact developer terminal display.
Gemma writes cases, then Gemma and GLM review a frozen snapshot separately.

```sh
npm run dev:generate-data
npm run dev:generate-data -- /absolute/path/to/existing-study
npm run dev:generate-data -- --status
```

The default command follows the local active-study receipt when one exists.
Otherwise, it uses `xor/prototype/output/checker-authoring`.
An explicit directory selects another study, and `--status` reads its progress once without calling the gateway.
The terminal shows generated cases, each model's review coverage, accepted and excluded cases, and retained approve, deny, and ask answers.
A denied action can be an accepted sample.
Accepted and excluded counts remain pending until both reviewers cover the current snapshot.
Reviews begin after generation stops or reaches its saved limits.

Keep this command running in the foreground on the Mac with its existing ASU configuration.
Ctrl-C stops the owned child process and preserves checkpoints.
Rerun the same command to resume.
The runner skips exhausted invalid tasks, preserves author call and token limits, and tries each reviewer at most twice per invocation.
A later invocation can retry missing reviews.
An existing directory lock causes refusal, so inspect its owner before removing an abandoned lock.
Diagnostics remain in `dev-generation.log` inside the study.
New snapshots live in `dev-reviews` and never overwrite earlier frozen reviews.
This command is excluded from the published package.

Use the individual commands below for smaller experiments.

Run these commands from the repository root.
Use the existing ASU configuration on the Mac.
Never copy gateway credentials to Sol.

```sh
node xor/prototype/author-checker-data.js plan docs/checker-tool-inventory.json xor/prototype/config/checker-authoring-smoke.json xor/prototype/output/authored-smoke
node xor/prototype/author-checker-data.js author xor/prototype/output/authored-smoke 6
node xor/prototype/author-checker-data.js freeze xor/prototype/output/authored-smoke xor/prototype/output/authored-smoke-review
```

The small plan contains 24 intended cases across six verified tools.
Inspect their actual content before using the broader configuration.
The broader configuration plans every checked tool across training, validation, and test, with additional dynamic shell cases.
Permission conditions guide the author but never become labels.
Families are assigned to one split before generation.

The author writes varied task descriptions and project rules rather than surrounding an unchanged action with a stock permission sentence.
Dynamic shell tasks cover multiline commands, variables, substitutions, heredocs, and visible script bodies.
Generated commands remain inert data.
Nothing in this pipeline executes them.

The plan pins the inventory, schemas, production request builder, author model, instructions, identities, and limits.
Authoring saves responses and checkpoints after each bounded batch.
Rerun the author command to resume missing tasks.
A changed plan or runtime contract requires a new study directory.
Freeze writes a new immutable review packet and never overwrites an earlier packet.

## Obtain independent reviews

```sh
node xor/prototype/review-checker-data.js xor/prototype/output/authored-smoke-review gemma4-31b-it gemma
node xor/prototype/review-checker-data.js xor/prototype/output/authored-smoke-review glm-5-3-flash glm
```

The two reviewers see only exact production inputs and opaque case identities.
They do not see intended permission conditions, authoring prompts, proposed answers, or each other's output.
Missing responses, abstentions, disagreements, or stale hashes exclude the entire scenario family.
Reviewer explanations never become training targets.
Model agreement does not establish human verification.

Generate and review checked tools while keeping unknown contracts visibly excluded.
Full training export still requires complete reviewed coverage and verified contracts.
The 18 unverified conditional or dynamic tool entries are not covered by the checked subset.
Schema validation also does not prove that a runtime adapter intercepts a tool call.

## Validate a frozen snapshot on Sol

Sol receives the frozen proposals, blind review packet, manifest, and credential-free audit script.
The audit checks hashes, unique inputs, family isolation, direct verdict tool names, and complete action visibility.
It reports script and shell-feature counts without executing generated commands.

```sh
python3 xor/prototype/audit-authored-data.py xor/prototype/output/authored-smoke-review /tmp/new-checker-audit.json
```

A passed integrity check does not measure token limits, label correctness, model accuracy, latency, or runtime interception.
Use the pinned tokenizer separately before preparing a qualified training study.

## Train only after data and runtime qualification

Keep fresh evaluation inputs isolated from training, prompt development, and reviewer feedback.
Record human decisions for critical safety cases.
The owner confirmed on October 21 that a clear current request for an exact network fetch counts as confirmation unless the Preference explicitly requires a separate approval step.
Preserve that decision with the exact case hash when resolving ambiguous network examples.
Measure leakage and report harmful approvals and ordinary refusals separately.
Before training, verify that the pinned trainer and runtime use the same complete input and direct-verdict format.
After training, the candidate must demonstrate direct verdicts without reasoning on the Mac.
The empty-thinking trainer copy is a proposed target format and has not demonstrated that behavior in a trained model.

A replacement must make no worse decisions than the registered original on the same frozen Mac evaluation and also be smaller or faster.
Sol timings support investigation and do not decide promotion.
No replacement model is currently qualified.

## Preserved earlier work

The earlier 1,656-case draft is mainly template-written permission contrasts.
Only its 72 corrected risk cases have matching independent reviews.
It is preserved for comparison rather than used as proof of realistic scenario diversity.
The [earlier preparation notes](archive/checker-template-preparation-2026-10-19.md), [research files](research-data.md), and [historical pilot](v2-finetuning-pilot.md) preserve the previous methods and results.
The October 16 study remains canceled and its frozen files remain unchanged.

## Repair and combine reviewed snapshots

Preserve the original frozen snapshot and record every disputed or invalid input that must be replaced.
A separate bounded remediation study records new identities, source input hashes, family and split links, and required replacements.
Changed inputs need fresh reviews from both model families.
Unchanged agreed siblings retain their exact source reviews.

```sh
node scripts/assemble-checker-data.js docs/checker-tool-inventory.json /absolute/path/to/original-snapshot /absolute/path/to/completed-remediation-snapshot /absolute/path/to/remediation-study /absolute/path/to/new-assembled-snapshot
node scripts/verify-checker-data.js docs/checker-tool-inventory.json /absolute/path/to/new-assembled-snapshot
python3 scripts/audit-checker-overlap.py /absolute/path/to/new-assembled-snapshot --output /absolute/path/to/new-overlap-report.json
```

Assembly refuses missing generated replacements, incomplete reviews and unrecorded source decisions.
It archives the exact source packets, review receipts and remediation ancestry.
New reviewer disagreements still exclude the entire family.
It never claims human verification, blind evaluation or training eligibility.
The overlap audit checks actual frozen request hashes before comparing inputs and families across splits.
Similar wording is a review candidate, not proof that an evaluation is independent.
Unknown tool contracts remain visible coverage gaps and must not be invented to make an export pass.
