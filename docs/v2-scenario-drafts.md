# OpenCode V2 Scenario drafts

New generated command Scenarios use `shell`.
Historical `bash` Scenarios remain readable for comparison with existing experiments.
Both forms follow the same argument, task, and observed-failure checks.

Prepare a separate draft from an existing Scenario file:

```sh
node bordercollie/prototype/prepare-v2-scenario-drafts.js source.jsonl bordercollie/prototype/output/v2-draft
```

The output directory must be new.
The command preserves the source file, maps `bash` to `shell` and directory `list` to `read`, and changes file arguments from `filePath` to `path`.
Conflicting path arguments are excluded for manual review.
Legacy `task` becomes `subagent` for the boundary check and is excluded because bordercollie blocks child-session dispatch before the Judge.

The [V2 tool catalog](https://opencode.ai/v2/docs/tools) retains `write` and `patch` as distinct tools.
Both request `edit` permission; the [migration guide](https://opencode.ai/v2/docs/migrate-v1) describes permission-action renames rather than replacement of these tools.
The converter preserves `write` and excludes `patch` until its multi-file effects and argument contract have been verified.
Worktree tools are also excluded pending verification of their arguments and effects on the folder boundary.

The draft Scenario file contains no Verdict, copied request, or independent review.
It cannot pass intake or produce training answers until fresh review establishes its Verdict.
The manifest keeps the source hash, original and draft request hashes, prior proposed Verdicts, and exclusion reasons for audit.
Prior Verdicts in the manifest are historical evidence and must not be shown to the independent Labeler.

This command does not regenerate frozen evaluation sets, submit Sol jobs, or promote a Candidate Judge.
Issue [#65](https://github.com/QuaanNguyen/border-collie/issues/65) remains open until the complete V2 corpus and worktree coverage have been reviewed.
