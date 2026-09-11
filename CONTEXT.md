# Domain

**Guard** - deterministic gate and evidence checks with no model in the loop.

**Pet** - optional desktop companion that expresses events without deciding or changing Guard outcomes.

**Pet host** - platform window boundary that owns focus, pointer routing, movement, shortcuts, and lifecycle while sharing the Pet renderer.
Production macOS uses AppKit and system WebKit, while Windows, Linux, and development mode use Electron.

**Pet animation contract** - validated shared configuration that maps semantic Pet states to named animation tracks, ordered frames, and per-frame durations before either Pet host activates the renderer.

**Event stream** - append-only contract through which the Border Collie plugin publishes events and Pet consumes them.

**Border Collie plugin** - OpenCode adapter whose source is `plugin/border-collie.js` in this clone.

**Border Collie package** - self-contained installation containing the Border Collie plugin, Guard, Event stream contract, and optionally Pet.

**Global bind** - installation operation that materializes a verified Border Collie package under OpenCode's global plugin directory while preserving the prior working package if verification fails.

**Protocol** - task envelope at `.opencode/protocol.json` in the opened directory, containing allowed reads, writes, commands, egress, and done criteria.
A missing Protocol selects the conservative default.
