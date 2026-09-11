# Domain

**Guard**  -  deterministic gate and evidence checks. No model in the loop.

**Border Collie plugin**  -  OpenCode adapter. Source is `plugin/border-collie.js` in this clone.

**Border Collie package**  -  what install materializes under `~/.config/opencode/plugins/`:
entry `border-collie.js` plus folder `border-collie/` (guard + pet). Self-contained; moving this
clone after install does not break a completed install.

**Global bind**  -  one command (`scripts/install-plugin`) copies the package and
runs `npm install` for the pet. OpenCode loads the entry from the global plugins
directory.

**Protocol**  -  task envelope in the opened directory (`.opencode/protocol.json`): allowed
reads/writes, commands, egress, and done criteria. Missing file means the
conservative default.
