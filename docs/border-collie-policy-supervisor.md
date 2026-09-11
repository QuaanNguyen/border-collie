# Border Collie policy supervisor

Border Collie is an owner-defined policy supervisor for OpenCode agents.

It allows ordinary work inside the active project while enforcing the owner’s resolved Border Collie policy through OpenCode’s pre-execution hook.

Research-safe is the default setup package.

It permits normal reads, edits, and ordinary Bash inside the active project.

It adds no trusted workspace roots outside that project.

Custom is the only other setup package.

Custom configures the supported owner-policy fields.

High-containment is future work and is not an available setup package.

Project policy lives only at `.opencode/protocol.json` in the active project.

Project policy may narrow the owner policy but cannot broaden it.

Broadening conflicts and malformed active-project policy block the session and create high-priority owner notifications.

Routine denials provide agent remediation without creating owner-notification noise.

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
