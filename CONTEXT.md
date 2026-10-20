# bordercollie checker fine-tuning

bordercollie checks whether a coding agent's proposed action follows the owner's request and project rules.
The active work is to generate synthetic scenarios, obtain independent reviews, fine-tune the local Needle checker, and measure its decisions on the Mac.
The [product context](docs/archive/product-context.md) preserves the desktop companion and installation vocabulary.

## Language

**Checker**:
The local Needle model that reads a user request, one Preference, and one proposed tool call.
Older runtime code and research records call it the Judge.

**Preference**:
One free-text statement of the owner's project rules.
Completion criteria remain separate from permission rules.

**Scenario**:
An invented user request, Preference, and complete proposed tool call used to test a permission decision.
Generated commands are inert data and are never executed by generation or review.

**Verdict**:
One approve, deny, or ask answer without arguments or explanation text in the training target.
Deny, ask, a missing answer, and an invalid answer all withhold the proposed action.
An ask requires applicable owner confirmation before a later attempt can proceed.

**Family**:
Related scenarios whose permission variants and shell rewrites stay in the same data split.

**Split**:
Training, development validation, or test membership assigned before authoring.
A test split alone does not establish a fresh blind evaluation.

**Author**:
The offline model that writes varied fictional tasks, project rules, and schema-valid proposed calls.
Intended permission situations guide authoring and are never accepted as labels.

**Independent review**:
A model's decision on the exact production request without the author's intended answer or another review.
Two different reviewer families must agree.
Missing, stale, abstained, or disputed decisions exclude the entire family.

**Human verification**:
An owner's recorded decision on the exact critical case.
Model agreement does not replace this decision.

**Qualification**:
Evidence that the data, request format, native runner, and evaluation meet their stated requirements.
Schema validity and file checksums establish only their specific checks.

**Promotion**:
Selecting a replacement checker only after it makes no worse decisions than the registered original on the same frozen Mac evaluation and is also smaller or faster.
Sol timings do not decide promotion.
