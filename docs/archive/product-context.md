# xor

xor checks an agent's proposed actions against the owner's instructions and verifies evidence for completion claims.

The active work is synthetic-data generation, independent review, and qualification of the local checker.
The desktop companion is retained for runtime compatibility and documented in [the archived product guide](product-guide.md).

## Language

**xor**:
The single product and command name for the system that applies permission decisions and checks completion evidence.

**Needle Gate (Verifier)**:
The model that reads the user message, the Preference, and one proposed action and returns a Verdict.

**Verdict**:
An approve, deny, or ask decision for one proposed action.
A missing Verdict withholds the action.
An ask withholds the action when confirmation is required or permission is unclear.

**Preference**:
One free-text statement of the owner's instructions for a project.
Optional completion criteria remain separate for deterministic evidence checks.

**Migration**:
An owner-initiated operation that carries existing settings and completion criteria into the current `.xor/` format.

**Pet**:
The optional desktop companion that expresses events without changing permission decisions.

**Pet host**:
The platform window that owns interaction, placement, and lifecycle for the Pet.

**Pet animation contract**:
The validated mapping from Pet states to animations and timing.

**Event stream**:
The transient sequence of events shared by xor and the Pet during one session.

**xor plugin**:
The connection between xor and the coding application.

**xor package**:
The installable product containing the plugin, action checks, evidence checks, verifier support, and Pet.

**Global bind**:
Installation of a verified xor package for the coding application while preserving the previous working installation if verification fails.
