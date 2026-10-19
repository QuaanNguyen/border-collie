# bordercollie

bordercollie checks an agent's proposed actions against the owner's instructions and verifies evidence for completion claims.

## Language

**bordercollie**:
The single product and command name for the system that applies permission decisions and checks completion evidence.

**Judge**:
The model that reads the user message, the Preference, and one proposed action and returns a Verdict.

**Verdict**:
An approve, deny, or ask decision for one proposed action.
A missing Verdict withholds the action, and an ask requires an applicable rule in the Preference.

**Preference**:
One free-text statement of the owner's instructions for a project.
Optional completion criteria remain separate for deterministic evidence checks.

**Migration**:
An owner-initiated operation that carries existing settings and completion criteria into the current format.

**Pet**:
The optional desktop companion that expresses events without changing permission decisions.

**Pet host**:
The platform window that owns interaction, placement, and lifecycle for the Pet.

**Pet animation contract**:
The validated mapping from Pet states to animations and timing.

**Event stream**:
The transient sequence of events shared by bordercollie and the Pet during one session.

**bordercollie plugin**:
The connection between bordercollie and the coding application.

**bordercollie package**:
The installable product containing the plugin, action checks, evidence checks, Judge support, and Pet.

**Global bind**:
Installation of a verified bordercollie package for the coding application while preserving the previous working installation if verification fails.
