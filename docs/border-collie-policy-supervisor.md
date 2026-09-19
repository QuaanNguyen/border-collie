# Border Collie policy supervisor

Border Collie is an owner-defined policy supervisor with OpenCode as its reference adapter.

It allows ordinary work inside the active project while enforcing the owner’s resolved Border Collie policy through OpenCode’s pre-execution hook.

Casual, research, and governed are stable owner profile templates.

It permits normal reads, edits, and ordinary Bash inside the active project.

It adds no trusted workspace roots outside that project.

Custom is the only other setup package.

Custom configures the supported owner-policy fields.

High-containment is future work and is not an available setup package.

Project policy lives at `.border-collie/protocol.json` in the active project.
The legacy `.opencode/protocol.json` remains read-compatible during migration and is never rewritten automatically.

Projects may select only an owner-approved profile for their adapter.
Governed requires a human-authored project `write_paths` scope that narrows its project-wide owner ceiling.

Project policy may narrow the owner policy but cannot broaden it.

The Protocol is reloaded before every guarded tool action and completion evaluation.

Valid human edits apply to the active session and reset its completion verification state.

Broadening conflicts and malformed active-project policy block the session until a human corrects the file.

Canonical and legacy Protocol files are automatically protected from direct agent writes.

A Protocol change observed while an agent tool is executing is quarantined until a human saves a different correction.

Routine denials provide agent remediation without creating owner-notification noise.

Completion verification runs only when the agent explicitly completes and makes a criterion-matching claim.

Failed criteria receive compact remediation twice before the Guard stops further tool use and asks the agent to give the human the deterministic failure summary.

Command evidence checks use explicit argv values, a bounded timeout, and a sanitized environment.

Repository evidence checks can require the original base commit, a changed worktree diff, declared path scope, and no new ignored or untracked artifacts.

Subagent dispatch fails closed because the current OpenCode plugin interface cannot attach an authenticated resolved policy to a child session.
If a child-session tool call reaches the common pre-execution hook, Border Collie applies the same resolved policy and denial-remediation shape used for the parent session.
The upstream limitation and revisit condition are recorded in [OpenCode Subagent Policy API Research](opencode-subagent-policy-api.md).

Configured protected paths remain readable but cannot be modified.

Configured read-protected paths cannot be inspected or modified.

Recognizable direct-tool and shell attempts to cross the active-project boundary or modify protected paths are denied.

Border Collie is not an operating-system sandbox or a distinct security principal from its owner.

OpenCode permissions remain complementary to Border Collie’s deterministic policy checks.

Arbitrary encoded interpreter behavior cannot be fully contained in normal mode.

A hard execution boundary requires a real sandbox, container, VM, separate identity, or equivalent isolation.

`allow_commands` is not supported because Guard does not enforce it.
Use `allow_ordinary_bash`, `command_allowlist`, and `deny_commands` instead.
