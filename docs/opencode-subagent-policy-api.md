# OpenCode Subagent Policy API Research

_Verified against the official OpenCode documentation and upstream `dev` source on 2026-09-08._

## Conclusion

OpenCode plugins can observe and fail closed on a subagent dispatch because dispatch uses the built-in `task` tool and OpenCode calls the `tool.execute.before` plugin hook immediately before executing that tool.

The public hook receives the parent session ID, tool ID, call ID, and a mutable argument object.

A plugin can add text to the existing `args.prompt` object in place before the `task` tool runs.

That can instruct a child agent about a parent policy, but it is prompt context rather than an authenticated or enforced policy envelope.

The public plugin contract provides no child-session creation hook, no child session ID at dispatch time, no parent-child policy transaction, and no supported way to set a child session's permission rules.

Replacing `output.args` with a new object is not reliable in the current upstream implementation because the task executor subsequently uses its original `taskArgs` object.

OpenCode itself does propagate a limited native permission subset when it creates a child session.

The current implementation carries the parent's deny rules and `external_directory` rules into the child session, but intentionally leaves the child agent's own permissions to determine its capabilities.

Consequently, a plugin cannot safely implement issue #15 by attaching a per-child Rice policy envelope through a documented dispatch API.

A plugin can still enforce a policy independently by throwing from `tool.execute.before` for every relevant tool call, including calls from child sessions, but that is a plugin-owned guard rather than inherited child-session authority.

## Official evidence

The official plugin documentation defines `tool.execute.before` as a hook that may modify tool arguments.

Its documented example changes an existing shell command property in place.

[OpenCode plugin documentation](https://opencode.ai/docs/plugins)

The public `Hooks` type defines the hook input as `tool`, `sessionID`, and `callID`, and its output as only `{ args: any }`.

It defines no child session, parent session, policy, permission, or dispatch-context output field.

[Plugin hook type](https://github.com/anomalyco/opencode/blob/dev/packages/plugin/src/index.ts#L1348-L1354)

OpenCode identifies subagent launch as the `task` permission and matches it against the selected subagent type.

[Permission keys](https://opencode.ai/docs/permissions)

The official agent documentation separately describes `permission.task` as the control for which subagents an agent may invoke.

[Task permissions](https://opencode.ai/docs/agents)

The task-dispatch path constructs `taskArgs`, triggers `tool.execute.before` with those arguments, then executes the `task` tool using `taskArgs`.

Therefore, mutations to properties of the existing argument object can reach the execution path, while replacing `output.args` itself is not a supported way to replace the object.

[Task dispatch hook invocation](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/prompt.ts#L2722-L2777)

The task tool first applies the normal `task` permission check for the requested subagent type.

[Task permission check](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/tool/task.ts#L1144-L1166)

It then derives a child permission ruleset, creates a session with the current session as `parentID`, and assigns the derived rules to that new session.

[Child session creation and ruleset assignment](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/tool/task.ts#L1179-L1243)

The derivation function copies only parent rules that deny an action or govern `external_directory`.

Its source explicitly states that parent-agent restrictions govern only that parent and that the subagent's own permissions determine its capabilities.

[Subagent permission derivation](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/agent/subagent-permissions.ts#L258-L301)

Finally, the generic built-in and MCP tool wrappers trigger the same before hook with the executing session ID before invoking each tool.

This is the supported interception point for a plugin-owned, fail-closed guard that applies to both parent and child tool calls.

[Built-in and MCP tool hook invocation](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/tools.ts#L1559-L1577)

## Implementation implication

Keep Rice's current fail-closed denial of subagent dispatch unless the project deliberately adopts a design that guards every child tool call using the same resolved Rice policy.

Do not treat prompt injection as policy inheritance, and do not rely on a fabricated `policy` argument or an undocumented child-session mutation API.

If future OpenCode releases add an explicit child-session dispatch hook or a child permission-context API, revisit this conclusion against that released version rather than the moving `dev` branch.
