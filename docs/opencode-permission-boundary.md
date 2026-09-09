# OpenCode V2 Filesystem Permission Boundary

_Verified against OpenCode's V2 documentation and upstream `dev` source on 2026-09-08._

## Security conclusion

`external_directory: deny` is a useful enforced gate for the V2 core file tools, but it is not an OS sandbox or a complete host-filesystem boundary.

It separately gates direct external access before the underlying `read` or `edit` permission, including `read`, `edit`, `write`, `patch`, and an external shell working directory.
The underlying tool permission still applies after that boundary decision.
[OpenCode permissions documentation](https://opencode.ai/v2/docs/permissions)

The decisive limitation is `shell`.
OpenCode documents, and the upstream shell implementation confirms, that a shell command runs with the host user's filesystem, process, and network authority.
The command is matched as raw command text, while external paths embedded in command arguments receive only best-effort advisory warnings rather than an `external_directory` enforcement decision.
[Shell warning in the official documentation](https://opencode.ai/v2/docs/permissions)
[Upstream shell implementation](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/tool/bash.ts)

Therefore, an agent granted broad `shell` access can still use the owner's operating-system authority to reach files outside the working directory.
`external_directory: deny` alone must not be represented as protection against shell escape.

## What the direct-path boundary does

For direct core file tools, OpenCode resolves the requested path to its canonical path before deriving the permission resource.
An absolute external target receives an `external_directory` resource for its canonical containing directory, normally ending in `/*`.
[Upstream path resolver](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/location-mutation.ts)

The same resolver rejects a relative mutation path that lexically leaves the active Location.
It also rejects a path that is lexically inside the Location but whose resolved symlink target escapes the canonical Location root.
That gives direct `read`, `edit`, `write`, and `patch` calls protection against ordinary `../` traversal and a symlink from the Location to an external target.
[Upstream resolver checks](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/location-mutation.ts)
[Upstream read tool](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/tool/read.ts)
[Upstream edit tool](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/tool/edit.ts)
[Upstream write tool](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/tool/write.ts)

The documented V2 boundary is outside both the active Location and its non-root project worktree.
As a result, do not equate “outside the current directory” with “external” without accounting for the worktree boundary in the installed version.
[External-directory semantics](https://opencode.ai/v2/docs/permissions)

## Permission hierarchy and tools that matter

V2 uses an ordered `permissions` array rather than the V1 `permission` object shown in the screenshot.
V2 also renames `bash` to `shell` and `task` to `subagent`.
The last matching rule wins, and agent-specific rules are appended after global rules.
[V2 rule matching and agent overrides](https://opencode.ai/v2/docs/permissions)

Project configuration is discovered from the current directory through ancestor directories and is higher precedence than global configuration.
Treat a shared or untrusted repository's `opencode.json` or `.opencode/opencode.json` as security-relevant input, because it can change the effective configuration.
[Configuration discovery and precedence](https://opencode.ai/v2/docs/config)

| Security concern | Permission action to control | Important limitation |
| --- | --- | --- |
| Direct external files | `external_directory`, then `read` or `edit` | `edit` covers `edit`, `write`, and `patch`. |
| Host command execution | `shell` | This is the critical escape surface because matching is raw text and path detection is advisory. |
| In-tree file reads and writes | `read`, `edit` | These restrict core file tools, not arbitrary shell commands. |
| File discovery and content search | `glob`, `grep` | Their resources are the glob and regex respectively, not an access-control path boundary. |
| Delegation and extensions | `subagent`, `skill`, `<server>_<tool>` | Plugins and MCP servers may add actions, so each enabled extension needs review. |
| Network-capable built-ins | `webfetch`, `websearch` | An allowed shell also carries host network authority. |

## Product implication

For an ASU shared-storage scenario, OpenCode's direct-tool boundary meaningfully reduces accidental or model-driven traversal through core file tools.
It does not create a distinct security principal from the owner, and it does not constrain an allowed shell to the working directory.

The security claim should therefore be: “OpenCode permission rules are an application-level policy layer, not a replacement for OS permissions, a sandbox, or an independent policy gate.”

An additional deterministic gate such as Guard remains valuable when the product promise is task-specific path, command, and egress control with an audit trail.
For a hard cross-directory boundary against an agent with owner authority, the execution environment must also enforce it, for example through a separate OS identity, container, VM, or equivalent sandbox.
