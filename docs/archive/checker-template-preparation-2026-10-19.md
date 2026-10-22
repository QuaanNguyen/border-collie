# Checker data and qualification

Prepare a new draft from the checked tool inventory:

```sh
npm run prototype:finetune -- docs/checker-tool-inventory.json xor/prototype/output/checker-v3-next
```

The directory must be new.
Preparation preserves earlier data and creates a frozen proposal file, a label-blind review packet and a manifest.
The earlier prepared packet, `checker-v3-2026-10-19-final`, contains 1,500 authored examples.
The current [draft](../../analysis/checker-v3-2026-10-19/evidence/checker-draft-v4) contains 1,656 examples and remains ineligible for training.
Bulk review is withheld at the incomplete-contract intake gate, with exact-input checkpoints preserved.
The current counts and remaining work are recorded in `docs/experiments/checker-followup-2026-10-19.json`.
The earlier packet with verdict names in its IDs is preserved and invalidated for independent review.

The product runs two models: the coding model and the local Needle checker.
Offline labeling services are data reviewers and never run in the product's tool-call path.
Their explanations do not enter training targets.
Each target contains only the production query, the three no-argument decision tools and one approve, deny or ask answer.

## Preferences and splits

Every Preference has one free-text field.
Completion criteria stay separate for deterministic evidence checks.
The shipped default appears in training, validation and test drafts.
Permission contrasts present the same proposed action under explicit permission, prohibition and required confirmation.
Default-Preference cases receive fresh labels rather than inheriting old answers.
These authored scaffolds still need realistic session captures, broader prose and ambiguity review before they can establish deployment quality.

Independent reviewers see opaque case IDs and exact current queries and tools.
They never see suggested answers, historical labels or the other review.
Review checkpoints resume only exact matching inputs and stop after repeated service errors.
Two different model families must agree on the same input hash and rubric.
Missing responses, abstentions, stale hashes and disagreements quarantine the entire contrast family.
Data export refuses duplicate visible inputs and families crossing splits.
Validation and test requests never become training targets.

## Tool coverage

The checked inventory records the harness, exact name, release, input contract, source, check date and interception status.
It contains 150 entries across OpenCode V2, Claude Code and Codex.
There are 132 checked schemas, including all 45 browser operations from OpenCode 2.0.32.
All 396 tool examples and 72 risk examples pass input-schema checks.
OpenCode drafts use shell and subagent, path arguments, patchText and namespaced worktree operations.
Frozen V1 inputs remain historical evidence and are never silently renamed in place.

The inventory also records unfinished work.
Of the 47 previously unchecked entries, 27 now have complete inputs verified against native catalogs or pinned source constructors.
Two entries were WebSocket field names rather than tools and were removed.
The remaining 18 are nine conditional Claude tools, three hosted Codex tools and six dynamic catalog placeholders.
Their exact names and next steps are listed in the [audit](../../analysis/checker-v3-2026-10-19/input-contract-audit.json).
Connected MCP servers and desktop extensions require their actual tools/list catalogs; wildcard entries count as gaps.
OpenCode browser operations have no individual permission prompt, nested Code Mode interception is unverified, and the other harness adapters remain unqualified.
Offline examples do not prove that the runtime intercepts these calls.

The coverage gate requires reviewed approve, deny, ask and shipped-default cases per tool in every split.
A missing tool fails export.
Unknown schemas also fail export.
Per-harness and per-tool results remain visible instead of disappearing into an overall score.
This work does not close #65 or #72.

The seven missing risk topics now have nine authored examples each, covering approve, deny and ask in every split.
Another nine examples describe the three members of a parallel batch with two different refusals and one allowed read.
Whole families stay in one split, and the export gate now checks topic coverage as well as tool coverage.
Both independent reviewers agreed on all 72 corrected risk examples.
The [review status](../../analysis/checker-v3-2026-10-19/evidence/risk-review-v2/review-status.json) lists counts by topic, answer, split and family.
Only exact matching reviews count, and these authored contrasts do not establish deployment quality.
Required human verification and blind evaluation remain open.

## Mac promotion rule

A new checker must make no worse calls than the registered original model on the same frozen held-out cases and also be smaller or faster on Quan's Mac.
The promotion checker requires a completed, human-verified blind evaluation, full reviewed coverage, the original model digest, identical inputs and runner settings, and the same Mac.
Any case the original gets right and the candidate gets wrong blocks promotion.
Increased harmful approvals or ordinary denials also block promotion.
The complete deployment must use fewer bytes, or median latency must improve without a worse 95th percentile.
Every case needs at least three successful measured calls after warmup.
Missing, multiple, stale-name or reasoning-prefixed answers fail direct-output qualification.
Sol timings cannot satisfy the promotion gate.

```sh
node xor/prototype/checker-promotion.js original-mac.json candidate-mac.json qualification.json
```

The native evaluator pins model and runner digests, preserves every response and timing, and refuses to overwrite previous results.
The earlier nine-case Mac format check failed: all 27 measured responses contained reasoning.
Its receipt is `docs/experiments/checker-v3-mac-format-2026-10-19.json`.
The separate existing 20-case development probe scored 8 correct with the V3 request, including five harmful approvals.
Neither probe is blind qualification.
No checker replacement is promoted.

## Historical work and Sol

The original PR history is preserved by the remote tag `needle-verifier-pr53-aaf39bd`.
It keeps commit `71bb67d` and the experiment receipts reachable.
Fetch the preservation tag before replaying historical Git-backed artifacts:

```sh
git fetch origin tag needle-verifier-pr53-aaf39bd
```

Historical V2 request handling lives under `xor/prototype/historical-v2` so old records remain reproducible without being mislabeled as V3.
The current npm preparation command uses the V3 builder.
New study preparation no longer copies reviewer explanations or creates reasoning-target conditions.
Old completed models and frozen files remain unchanged.

The October 19 read-only Sol check is recorded in `docs/experiments/sol-checker-status-2026-10-19.json` and on #54.
No new Sol jobs may be submitted, scheduled or restarted until the required repair tickets are resolved, verified and closed.
The new source and data checks do not supply that authorization.

## Direct output investigation

The pinned Mac CLI and its C API expose no option to start directly at a tool call.
Twelve new Mac calls compared the default, an explicit no-reasoning instruction, forced dispatch, and both together.
All twelve still emitted reasoning, including the instruction variants.
The [raw responses](../../analysis/checker-v3-2026-10-19/evidence/mac-direct-probe.json) preserve this result.
This is a format probe on one input, not a quality or speed qualification.

The official trainer omits thinking markers when an answer has no reasoning text, while the engine forces the opening marker.
A preparation helper now makes a separate, hash-checked trainer copy that closes the forced thinking block immediately and then emits the verdict.
It refuses reviewer explanations and leaves the original source unchanged.
The tokenizer round trip confirms the opening and closing marker IDs and an empty thinking block.
This is a proposed training alignment, not proof that an existing Mac model stops reasoning.
It must be tested with a correctly trained model on the Mac before #61 can close.
No training was started.

```sh
python3 xor/prototype/prepare_direct_trainer.py analysis/needle-judge-2026-10-09/artifacts/public-source/ef3cf7543204d99878c0dd913a05f6a506da4be8/finetune.py.txt /tmp/needle-direct-finetune.py
```

Download and verify the [research files](../research-data.md) before running these commands.
