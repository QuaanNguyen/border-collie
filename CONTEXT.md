# Domain

**Guard** - the boundary that applies a Verdict before a tool runs, and the evidence checks on a completion claim. A call that leaves the project folder, or that would change the Preference, is a disallow the Judge does not make.
_Avoid_: policy engine

**Judge** - the model that reads the user message, the Preference, and one proposed tool call, and returns a Verdict.
_Avoid_: coding model

**Verdict** - allow, disallow, or ask, as the Judge emits it for one proposed tool call. A missing Verdict is disallow. Ask withholds the call; a later proposal is judged again with the owner's answer in the user message.
_Avoid_: tool selection, score, permission ledger, threshold

**Preference** - the owner's statement, at `.border-collie/preference.json`, of one project folder's purpose, what may proceed, what is disallowed, and what must be asked. A missing Preference uses the shipped default. An unreadable Preference blocks the session. Done criteria live here, and are read from a retired Protocol while that file remains. It is the only statement the Judge reads.
_Avoid_: Protocol, profile

**Profile** - retired owner allowlist. It does not gate tool calls.
_Avoid_: Preference

**bdc** - the command installed by the Border Collie package. `bdc install` binds the OpenCode plugin and retrieves the Judge for this machine. A failed retrieval leaves the previous plugin in place.
_Avoid_: bc, border-collie

**Migration** - a manual `bdc migrate` the owner runs. Install does not run it. It carries done criteria into the Preference, then removes the retired Protocol and Profile files. Pet size stays. Later package versions ship it.
_Avoid_: automatic upgrade

**Protocol** - retired allowlist envelope. Tool gating no longer reads it.
_Avoid_: Preference

**Pet** - optional desktop companion that expresses events without deciding or changing Guard outcomes.

**Pet host** - platform window boundary that owns focus, pointer routing, movement, shortcuts, and lifecycle while sharing the Pet renderer.
Production macOS uses AppKit and system WebKit, while Windows, Linux, and development mode use Electron.

**Pet animation contract** - validated shared configuration that maps semantic Pet states to named animation tracks, ordered frames, and per-frame durations before either Pet host activates the renderer.

**Event stream** - transient contract sent over the Pet process's private input pipe through which the Border Collie plugin publishes events and Pet consumes them.
The Pet keeps only a bounded in-memory queue while its renderer starts, and no events survive an OpenCode restart.

**Border Collie plugin** - OpenCode adapter whose source is `plugin/border-collie.js` in this clone.

**Border Collie package** - self-contained installation containing the Border Collie plugin, Guard, Event stream contract, and Pet.

**Global bind** - installation operation that materializes a verified Border Collie package under OpenCode's global plugin directory while preserving the prior working package if verification fails.

