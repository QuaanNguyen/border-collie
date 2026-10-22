# xor verifier and companion

xor checks proposed OpenCode tool calls against the user's request and project rules before they run.
It uses local Needle decisions to approve, deny, or ask for confirmation.

The active work prepares reviewed synthetic scenarios and qualifies a replacement Needle model on the Mac.
No replacement model is qualified.
Direct answers without model reasoning remain a qualification requirement.
The desktop companion remains part of the runtime.

## Core architecture

### 1. The Hook / Catch Verifier
The verifier operates as a hook interceptor on agent tool execution (`tool.execute.before`).
Before any proposed tool call is allowed to run:
1. **Safety and Boundary Checks**: Enforces folder boundaries in deterministic code (e.g., rejecting paths escaping the project root, attempts to alter `.xor/preference.json`, or unmanaged subagent dispatches).
2. **Needle Verifier Execution**: Evaluates the proposed call against the folder Preference and the active user request using the local Needle model.
3. **Denial vs. Allowance**:
   - When the proposed action matches the user preference description for denial, the verifier returns `deny`, blocking tool execution and informing the agent of the refusal reason and permitted alternatives.
   - When the proposed action does not match the denial description, the verifier returns `approve` (`allow`), letting the agent proceed through OpenCode's normal permission checks.
   - If explicit human confirmation is mandated by the preference or the model returns `ask`, execution is blocked and the agent is instructed to ask the owner before retrying.

### 2. The local Needle model
- **Decision format**: The target format is direct `approve`, `deny`, or `ask` tool calls.
  Qualification must establish this behavior for a replacement model.
- **Checked Inputs**: The verifier consumes the exact production request format (version 3): the latest user request, one free-text project Preference, and the complete proposed tool call (including derived read/write paths and network targets for shell commands).
- **Fail-Closed**: Missing models, unreadable preferences, missing verdicts, or execution timeouts automatically fail-closed into refusals.

### 3. The Desktop Companion (Pet)
- Sits beside the coding agent and reflects the live event stream emitted by the verifier (`calm`, `allowed`, `thinking`, `refused`, `denied`, `suspicious`, `celebrating`).
- Uses native macOS AppKit / WebKit (`pet/native/`) on Darwin and locked Electron on Windows / Linux.
- The Pet observes and displays events via a private IPC pipe; it never alters verifier decisions.

## Language and Domain Vocabulary

**xor**:
The verifier product, plugin, and CLI command suite (`xor install`, `xor migrate`, `xor pet size`).

**Verifier / Hook**:
The interceptor that traps every agent tool call before execution, comparing proposed actions against the owner Preference using the system-one Needle model.

**Preference**:
One free-text statement of the user's project rules (canonical location `.xor/preference.json`), defining what actions are permitted, what must be denied, and what requires owner confirmation. Optional `done_criteria` define deterministic completion verification.

**Needle Model (Judge / Verifier Engine)**:
The on-device Cactus Needle model that classifies proposed actions.

**Verdict**:
One direct `approve`, `deny`, or `ask` answer returned by the verifier.
- `deny`: Withholds the proposed action because it matches the user preference description for denial.
- `approve`: Allows the proposed action because it does not match the denial description.
- `ask`: Withholds the action pending owner confirmation.

**Scenario**:
A synthetic tuple of (user request, Preference, proposed tool call) used for fine-tuning and evaluating the verifier. Generated commands are inert data and never executed.

**Family**:
A cluster of related scenarios and syntactic command variants that are kept together in the same data split to prevent leakage.

**Split**:
Disjoint partitions for training, validation, and frozen blind evaluation.

**Author**:
The model responsible for synthesizing diverse, schema-valid tool calls, tasks, and preferences.

**Independent Review**:
Evaluating author cases across two distinct model families without access to intended labels; families with disputes or abstentions are quarantined.

**Human Verification**:
Explicit human audit and sign-off on critical safety cases and distribution boundaries.

**Promotion**:
Upgrading the shipped Needle verifier only after proving parity or improvement over the baseline on frozen evaluation sets with lower latency or smaller size.
