# Generate and qualify checker training data

The active task is to generate varied synthetic scenarios using the current production request format.
Each scenario contains a natural user request, one free-text project Preference, and one complete proposed tool call.
The training target is one approve, deny, or ask answer without an explanation.

## Generate model-authored scenarios

Run these commands from the repository root.
Use the existing ASU configuration on the Mac.
Never copy gateway credentials to Sol.

```sh
node bordercollie/prototype/author-checker-data.js plan docs/checker-tool-inventory.json bordercollie/prototype/config/checker-authoring-smoke.json bordercollie/prototype/output/authored-smoke
node bordercollie/prototype/author-checker-data.js author bordercollie/prototype/output/authored-smoke 6
node bordercollie/prototype/author-checker-data.js freeze bordercollie/prototype/output/authored-smoke bordercollie/prototype/output/authored-smoke-review
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
node bordercollie/prototype/review-checker-data.js bordercollie/prototype/output/authored-smoke-review inkling-small inkling
node bordercollie/prototype/review-checker-data.js bordercollie/prototype/output/authored-smoke-review kimi-k2-7-code kimi
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
python3 bordercollie/prototype/audit-authored-data.py bordercollie/prototype/output/authored-smoke-review /tmp/new-checker-audit.json
```

A passed integrity check does not measure token limits, label correctness, model accuracy, latency, or runtime interception.
Use the pinned tokenizer separately before preparing a qualified training study.

## Train only after data and runtime qualification

Keep fresh evaluation inputs isolated from training, prompt development, and reviewer feedback.
Record human decisions for critical safety cases.
Measure leakage and report harmful approvals and ordinary refusals separately.
The Mac runner must demonstrate direct verdicts without reasoning.
The empty-thinking trainer copy is only a proposed alignment and has not demonstrated that behavior in a trained model.

A replacement must make no worse decisions than the registered original on the same frozen Mac evaluation and also be smaller or faster.
Sol timings support investigation and do not decide promotion.
No replacement model is currently qualified.

## Preserved earlier work

The earlier 1,656-case draft is mainly template-written permission contrasts.
Only its 72 corrected risk cases have matching independent reviews.
It is preserved for comparison rather than used as proof of realistic scenario diversity.
The [earlier preparation notes](archive/checker-template-preparation-2026-10-19.md), [research files](research-data.md), and [historical pilot](v2-finetuning-pilot.md) preserve the previous methods and results.
The October 16 study remains canceled and its frozen files remain unchanged.
