# bordercollie

This work focuses on fine-tuning a small local checker that decides whether a coding agent may run a proposed tool call.
The checker reads the user request, one free-text project Preference, and the complete proposed action.
It returns approve, deny, or ask.

## Current work

Generate varied synthetic user requests and tool calls, obtain two independent reviews, and test a trained model on the Mac.
Cover shell scripts, multiline commands, variables, substitutions, partial permissions, sensitive reads, outside-folder actions, delegation, and the checked tools across OpenCode, Claude Code, and Codex.
Generated commands are data and are never executed by the generation pipeline.

The earlier 1,656-case draft consists mainly of template-written permission contrasts.
It remains preserved for comparison and is not evidence of realistic request diversity or improved model quality.
The [training guide](docs/checker-training.md) describes the current pipeline and remaining requirements.
The [tool inventory](docs/checker-tool-inventory.json) records checked schemas and explicit gaps.

No replacement model is qualified.
Independent agreement does not replace human verification or a fresh isolated evaluation.
The Mac runner still needs to demonstrate direct verdicts without reasoning before new fitting can establish the intended behavior.

## Research setup

Use Node.js 22.12 or newer, Git, and Git LFS.
Install development dependencies and fetch the pinned research files:

```sh
npm install
git lfs install
git lfs pull
python3 analysis/checker-v3-2026-10-19/manifest-data.py --check
```

Use the existing ASU gateway configuration on your Mac.
Credentials are never copied to Sol.
Sol receives only frozen synthetic data and credential-free validation or separately qualified training work.

The [research file guide](docs/research-data.md) lists the preserved inputs and checksum manifest.
Completed experiments, rejected drafts, human decisions, and frozen evaluation files remain historical evidence.

## Runtime and historical product work

The runtime request builder stays in this repository so training and evaluation use the same inputs as the checker.
The [runtime contract](docs/bordercollie-and-judge.md) and [project vocabulary](CONTEXT.md) define that boundary.
The [product installation guide](docs/archive/product-guide.md) and [desktop companion documents](docs/archive/pet/animation-assets.md) are outside the active fine-tuning work.
