# Frozen sample integrity

## Sub-features

Preserve exact proposals and review packets, validate tool arguments, detect duplicate visible inputs and keep each scenario family in one split.
Compare frozen requests with the current production request builder separately from checking preserved hashes.

## How to get to it (user POV)

Choose the frozen snapshot returned by the generation runner or the freeze command.
Use its original inventory rather than silently substituting a newer one.

## Driving it with the Node CLI

Follow Launch and Doctor in the parent skill.
Run `node scripts/verify-checker-data.js docs/checker-tool-inventory.json "$checker_snapshot"` and capture stdout and the exit code.
An intact snapshot reports `integrity` as `passed` with an empty failures list.
A historical builder mismatch appears separately and prevents training eligibility.
Run `node --test test/unit/checker-verification.test.js` to verify altered proposal bytes, mismatched visible inputs and missing model receipts are rejected.

## Gotchas

Integrity cannot prove semantic label correctness, token limits or realistic diversity.
The preserved 1,524-case snapshot has historical production tool descriptions and therefore cannot reuse its old reviews for the current builder.
If a snapshot fails, preserve the failure as evidence and prepare a new successor rather than rewriting its manifest.
