# Claude Code hook investigation

The actual Claude Code 2.1.296 command line was tested with a local fictional model server and harmless temporary marker files.
No external model account was used and no Claude Code adapter was installed.
The [receipt](experiments/claude-hooks-2026-10-16.json) records the executable hash, version, and results.
The reproducible probe is [here](../analysis/needle-judge-2026-10-09/scripts/claude-hook-probe.js).

Without a hook, both marker files were created, proving the command line executed the proposed tools.
With failure blocking enabled, missing command scripts, crashes, error exits containing an allow response, malformed JSON objects, timeouts, HTTP errors, and invalid HTTP JSON prevented both marker actions.
Both command and HTTP refusals with an explicit stop ended the turn after one model request; the second proposed action was never requested or executed.
Failure blocking alone denied each attempted action but allowed the model to continue its turn and propose another action.

Unstructured command stdout is a critical limitation.
An incomplete JSON fragment was treated as plain text and both marker actions executed despite failure blocking.
A future adapter must parse and validate the Judge answer itself, exit with an error on missing or malformed decisions, and emit an explicit denial and turn stop for a refusal.
Passing through arbitrary runner stdout is unsafe.

The [official hook reference](https://code.claude.com/docs/en/hooks) documents failure blocking for command and HTTP hooks starting with 2.1.295 and explains that plain-text command stdout is not a failure.
The version actually tested here is 2.1.296; that is the minimum version qualified by this investigation.
This does not qualify earlier versions or every hook type.

The current bordercollie boundary separately tests missing runners, startup errors, crashes, the real 15-second deadline advanced with a test clock, malformed output, missing decisions, error exits containing an allow response, conflicting decisions, and an unsupported ask.
All withhold execution through the proposed-action interface.
The [regression](../test/bordercollie/judge-failures.test.js) uses real fixture child processes and asserts no downstream marker exists.

The command catalog pairs variable-disguised deletion, including Bash's alternate command-name variable, with ordinary printing counterparts.
The proposed repair cases include different variable, substitution, wrapper, loop, and conditional forms with confirmed, refused, and pending user instructions.
Those cases still require the independent dataset reviews and do not constitute a qualified fine-tuned model.

A separate six-case native diagnostic pairs variable, alternate-command-name, and function deletion with ordinary printing under the same Preference and user request.
The [case preparation](../bordercollie/prototype/disguised-command-cases.js) preserves the complete actions.
The [saved decisions](experiments/disguised-commands-2026-10-16.json) report the shipped Judge's actual answers, including errors, without treating the authored expectations as human gold.
