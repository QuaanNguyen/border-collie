# xor and the Needle Verifier

xor checks proposed tool calls in OpenCode's tool execution hook before they run.
It evaluates the proposed action against the user request and project rules using a local Needle model.
No replacement model is qualified.
Direct answers without model reasoning remain a qualification requirement.

## Order of decisions

1. **Terminal completion failure**: A session stopped by a terminal completion failure refuses further tool calls.
2. **Folder boundary**: The folder boundary refuses, in code, a call whose path leaves the project folder, including through a symlink or `~`.
3. **Protected configuration**: The folder boundary refuses, in code, a write that would change `.xor/`, `.bordercollie/`, the retired `.opencode/protocol.json`, or a folder containing them.
4. **Subagent dispatch**: The folder boundary refuses subagent dispatch, because a child session cannot carry the folder Preference.
5. **Needle Verifier**: Every other call is evaluated against the owner's Preference using the local Needle model.

The verifier reads three inputs: the latest user message, the folder Preference, and the proposed tool call.
For shell commands, it also inspects the derived read paths, write paths, and network targets.
The expected model response is a Verdict: `approve`, `deny`, or `ask`.

- **Approve (`allow`)**: The tool call does not match the denial criteria; OpenCode continues its normal permission checks.
- **Deny (`disallow`)**: The tool call matches the user preference description for denial; execution is blocked and xor returns the requested action, target, governing rule, reason, permitted alternative, and a no-retry notice to the agent.
- **Ask (`ask`)**: The preference specifies explicit confirmation or the action is ambiguous; execution is withheld and the agent is instructed to ask the owner before retrying.

A missing Verdict, an uninstalled verifier runner, or a runner timeout/failure all fail-closed into refusals.

## The Needle Verifier Engine

The verifier uses an on-device [Needle](https://github.com/cactus-compute/needle) model from Cactus Compute, pinned to a specific Hugging Face revision.
`xor install` downloads the native runner for the current platform and the pinned `needle3.cact` weights, checks both against pinned SHA-256 digests, and caches them under `~/.cache/xor/judge` (`%LOCALAPPDATA%\xor\judge` on Windows).
The plugin verifies the digests again before first use in each process and runs Needle with telemetry disabled (`NEEDLE_TELEMETRY=0` and `DO_NOT_TRACK=1`).
Each invocation runs as a short process with a 15-second execution limit.

`npm run eval:judge` evaluates the verifier against fixed allow and disallow test cases under the default Preference.

## The Preference

The project Preference lives at `.xor/preference.json` and contains:
- `text`: One free-text statement describing project scope, what actions are permitted, what must be denied, and when to ask the owner.
- `done_criteria`: An optional array of deterministic assertions (such as file existence checks or regex searches) evaluated when the agent claims completion.

```json
{
  "text": "Work on the user request in this repository. Local file edits, git status, and testing are approved. Deny sending source code or secrets off-machine via curl, wget, or network commands. Deny destructive file deletions unless explicitly requested.",
  "done_criteria": [
    {
      "id": "build-output-exists",
      "checks": [{ "type": "file_exists", "path": "dist/index.js" }]
    }
  ]
}
```

Missing fields fall back to shipped defaults.
Unknown fields, non-string prose, or unreadable JSON block the session until a human corrects the file.
A Preference change observed while an agent tool runs is quarantined until a human saves a different version.

`xor migrate` automatically transfers instructions and done criteria from legacy `.bordercollie` or retired Protocol files into `.xor/preference.json` and cleans up retired files.

## Completion Verification

Completion verification runs only when the agent finishes its turn and asserts a criterion-matching claim.
Failed criteria receive compact remediation twice before xor halts further tool execution and instructs the agent to present the failure summary to the owner.
A completion claim without declared `done_criteria` requests human review.

## Limits and Boundaries

- xor is not an operating-system sandbox or an independent security principal; commands execute with the running user's credentials.
- Path and effect detection within complex shell scripts is best-effort. Strong execution containment requires a dedicated sandbox, container, or virtual machine.
- The coding agent and Needle verifier are the only models in the runtime loop. The request asks for direct verdict calls.
  Qualification must establish the response format and behavior of a replacement model.

## OpenCode Integration and Auto-Accept

OpenCode 2.0.30 or newer is required.
The installer verifies the installed OpenCode version before modifying files, and the plugin verifies the runtime version during startup.

Project auto-accept and saved approvals do not bypass xor's tool execution hook:
- An `approve` verdict allows OpenCode's normal permission flow to proceed.
- A `deny` or `ask` verdict throws directly from `tool.execute.before`, preventing tool execution regardless of auto-accept settings.
- An `ask` verdict always pauses tool execution so the agent can request human confirmation.
