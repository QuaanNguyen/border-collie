## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues.
See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default canonical triage labels.
See `docs/agents/triage-labels.md`.

### Domain docs

This repository uses a single-context domain-doc layout.
See `docs/agents/domain.md`.

### Synthetic data and training

The active task is V3 synthetic generation for one free-text Preference and approve, deny, or ask answers.
Use the production request builder and checked input contracts.
Never execute generated commands.

Local ASU generation and credential-free CPU validation on Sol are authorized.
This override does not authorize bypassing training or promotion requirements.
Keep ASU gateway credentials on the Mac.
Do not close a ticket to bypass a requirement.
The cancellation receipt remains `docs/experiments/v2-pilot-cancelled-2026-10-16.json`.
