# bordercollie and the Judge

bordercollie stops every OpenCode tool call in the `tool.execute.before` hook and decides it before the tool runs.

## Order of decisions

1. A session stopped by a terminal completion failure refuses further tool calls.
2. The folder boundary refuses, in code, a call whose path leaves the project folder, including through a symlink or `~`.
3. The folder boundary refuses, in code, a write that would change `.bordercollie/`, the retired `.opencode/protocol.json`, or a folder containing them.
4. The folder boundary refuses subagent dispatch, because a child session cannot carry the folder Preference.
5. Every other call goes to the Judge.

The Judge reads three things: the latest user message, the folder Preference, and the proposed call.
For a shell call it also reads the read paths, write paths, and network targets bordercollie derives from the command.
It returns approve, deny, or ask, and that Verdict is used as emitted, at any confidence.
A missing Verdict, a Judge that is not installed, and a Judge that fails are all refusals.

Allow runs the call.
Disallow returns the action, target, rule, reason, a permitted alternative, and a no-retry instruction to the coding model, and the session continues.
Ask withholds the call and tells the coding model to ask the owner; nothing is stored, and the owner's reply is judged with the next attempt.

## The Judge

The Judge is the base Needle 3 model, pinned to one Hugging Face revision.
`bordercollie install` downloads the runner for the current platform and `needle3.cact`, checks both SHA-256 digests, and caches them.
The plugin checks the digests again before first use in each process and runs Needle with telemetry disabled through `NEEDLE_TELEMETRY=0` and `DO_NOT_TRACK=1`.
Each call is one short Needle process with a 15 second limit.

The base model is not trained for this task.
`npm run eval:judge` reports how it scores on fixed allow and disallow cases under the default Preference.

## The Preference

The Preference lives at `.bordercollie/preference.json` and holds one free-text `text` field and optional `done_criteria` for deterministic completion checks.
All three decision tools are offered on every request.
The request format is version 3; older training inputs require fresh review.
An ask withholds execution and returns control to the coding model to get the owner's answer.
The current OpenCode adapter does not yet qualify a native approval dialog for this path.
Missing fields use the shipped default, and a missing file uses the whole default without writing anything.
Unknown fields, non-string prose, and unreadable JSON block the session until a person fixes the file.
A Preference change observed while an agent tool runs is quarantined until a person saves a different version.

While no Preference exists, the `done_criteria` of a retired Protocol are still read; project instructions require migration before any tool runs.
`bordercollie migrate` moves those done criteria into a Preference and removes the retired files.

## Completion

Completion verification runs only when the agent completes and makes a criterion-matching claim.
Failed criteria receive compact remediation twice before bordercollie stops further tool use and asks the agent to give the owner the failure summary.
A completion claim with no done criteria asks a person to look.

## Limits

bordercollie is not an operating-system sandbox or a distinct security principal from its owner.
Shell commands run with the owner's authority, and path detection inside arbitrary commands is best effort.
A hard execution boundary requires a real sandbox, container, VM, separate identity, or equivalent isolation.
The OpenCode subagent limitation is recorded in [OpenCode Subagent Policy API Research](opencode-subagent-policy-api.md).

The coding model and Needle checker are the only models in the running product.
Needle returns one no-argument approve, deny, or ask call.
External data-review explanations never belong in training targets.
The pinned engine still adds its own internal reasoning prefix; direct-output qualification remains open in issue #61, and no fine-tuned replacement is qualified.

A retired Protocol with project instructions withholds tool use until the owner runs migration.
Its restrictions are carried into the free-text Preference instead of being silently replaced by the default.

## OpenCode versions and auto-accept

OpenCode 2.0.30 or newer is required.
The installer checks the installed version before downloading or replacing files, and the plugin checks the running version before registering hooks.
OpenCode 1.x owners must run `opencode upgrade --major`.

Project auto-accept and saved permission approvals do not bypass the tool execution hook.
An approve answer may proceed to OpenCode's own permission checks.
A deny or ask answer throws from the hook before the tool runs, whether auto-accept is on or off.
An ask always returns control to the coding model to ask the owner and wait.
bordercollie does not use a native permission assertion for this question, because an existing allow rule could satisfy that assertion without showing a question.

The upstream ordering was checked against [OpenCode 2.0.32](https://github.com/anomalyco/opencode/tree/v2.0.32/packages/core/src).
The regression test exercises the V2 plugin with a parallel protected write, denied worktree removal, worktree removal requiring confirmation, and an allowed read.
Each refusal retains its own message and Pet event.
