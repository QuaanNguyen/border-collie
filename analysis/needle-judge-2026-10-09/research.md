# Needle Judge: verified sources and training implications

Accessed date for every source below: 2026-10-09.
This is a separate research note for the isolated data-analysis phase.
No Sol connection, job submission, scheduling, cancellation, or live dataset change was performed for this research.

## Corrections to the attached report

| Claim | Finding |
| --- | --- |
| RedCode-Exec has 4,050 cases and 20 Bash scenarios | Confirmed with a scope correction: 4,050 includes Python and Bash, with three input formats per program. |
| Open-interpreter achieves 62.5% full Bash attack success in that paper | Unverified and unsupported by the cited paper: its OpenCodeInterpreter evaluation excludes Bash. |
| The denylist paper studies 1,709 denylists and 13,332 rules | Confirmed in the abstract, contributions, and conclusion, with an inconsistent 1,731 count in the introduction. |
| The denylist paper provides an available validated bypass corpus | Unverified: the paper says the code and data will be released upon publication. |
| Cactus local official fine-tuning exports 4-bit models without usable confidence | Confirmed. |
| Reasoning is optional in Cactus training | Confirmed, with the qualification that Cactus recommends it for grounding arguments in the request. |
| The official trainer supports automatic early stopping or restoring the best epoch | Not supported by the inspected official trainer version. |
| The three linked Claude Code incidents establish vendor-confirmed failures | Corrected: these are user reports in the vendor's issue tracker, with evidence limitations. |
| All other users' Sol directories are categorically private | Overbroad as an ASU-policy claim: ASU documents controlled scratch sharing and group project storage. |
| PocketOS incident details are verified against the founder's original evidence | Unverified here because the original posts were inaccessible. |

## Cactus official training guidance

**Confirmed.**
The official local path trains LoRA adapters with the base frozen, then merges them into a 4-bit export.
It leaves the confidence head untrained and omits it from the local archive, so confidence is absent.
The hosted path is different and falls outside the user's chosen scope. [Cactus fine-tuning guide](https://www.cactuscompute.com/blog/finetuning-needle)

Reasoning targets are optional, but Cactus recommends short derivations connecting argument values to the request.
The guide recommends 10 to 30 epochs for a few hundred examples, increasing epochs before learning rate if loss barely moves, and monitoring validation loss for overfitting.
It recommends rank 32 for tasks with difficult argument grounding.
These are general guidance rather than measured prescriptions for the Judge. [Cactus fine-tuning guide](https://www.cactuscompute.com/blog/finetuning-needle)

**Version-scoped source inspection.**
The official package publication points to commit `ef3cf7543204d99878c0dd913a05f6a506da4be8`. [PyPI publication provenance](https://pypi.org/project/cactus-needle/)
At that commit, the trainer runs the requested epochs, prints validation loss, and writes the adapter after training finishes.
The inspected loop has no automatic early-stop decision or best-epoch restoration.
The guide's instruction to stop when validation worsens should not be reported as an implemented trainer feature. [Official trainer source](https://github.com/cactus-compute/needle/blob/ef3cf7543204d99878c0dd913a05f6a506da4be8/needle/model/finetune.py)

This inspection does not identify the trainer version installed in the running Sol jobs.
Any future experiment should record the exact installed version and export path in its own manifest.
Answers-only targets fit the documented format, but their superiority for policy decisions remains an experiment to measure after approval.
Report training accuracy and actual policy verdicts alongside loss.

## RedCode-Exec

**Confirmed with corrected scope.**
RedCode-Exec contains 25 Python scenarios and 20 Bash scenarios, with 30 programs per scenario.
Each program appears as code, a brief text summary, and a detailed text description.
That yields 2,250 Python inputs plus 1,800 Bash inputs, totaling 4,050.
The underlying Bash program count is 600. [RedCode paper, sections 3.2.2 and B](https://arxiv.org/html/2411.07781v1)

The paper covers risky execution categories including sensitive-file exposure, destructive file operations, system monitoring, process management, and unsafe code behavior.
It evaluates results in prepared Docker environments, which helps distinguish a refusal from a failed attempt. [RedCode paper](https://arxiv.org/html/2411.07781v1)

**Unsupported report statistic.**
Appendix C.1 states that OpenCodeInterpreter and CodeAct do not support Bash and were not evaluated on Bash tasks.
ReAct was evaluated on both languages.
The cited paper therefore cannot substantiate the report's “open-interpreter” Bash percentage. [RedCode paper, section C.1](https://arxiv.org/html/2411.07781v1)

The authors publish their dataset and evaluation resources. [Official RedCode repository](https://github.com/AI-secure/RedCode)
Use its scenarios to broaden coverage and construct disposable local fixtures.
Apply the user's policy to each example rather than inheriting every benchmark risk label.

## GTFOBins

**Confirmed.**
GTFOBins catalogs legitimate Unix executables whose capabilities can be abused in misconfigured environments.
Its categories include shell execution, commands, file reads and writes, upload and download, reverse and bind shells, library loading, and privilege escalation.
The project explicitly cautions that the listed programs are not inherently vulnerable. [GTFOBins](https://gtfobins.org/)

This makes it useful for varying how an action is expressed.
Training should include benign and unauthorized uses of the same executable, with differences in requested purpose, destination, scope, and effects.
A command name alone should not become the verdict.

## One Goal, Many Commands

**Confirmed, with two qualifications.**
The cited preprint exists as version 2 dated 2026-06-20.
Its abstract, contributions, and conclusion give 1,709 denylists and 13,332 rules collected from GitHub.
Its introduction instead says 1,731 denylists, without resolving that discrepancy. [Paper](https://arxiv.org/html/2606.15549v2)

The 69.0% to 98.6% range describes denylists targeting an operation that miss at least one validated bypass in the study's conditions.
It is not a general attack-success rate for every agent or evidence of Needle's accuracy.
The paper validates proposed bypasses by executing them in a sandbox. [Paper, abstract and conclusion](https://arxiv.org/html/2606.15549v2)

**Corpus availability unverified.**
The paper says the code and data will be released upon publication.
An available downloadable corpus was not established by the cited page. [Paper, contributions](https://arxiv.org/html/2606.15549v2)

Its useful lesson for this dataset is to group equivalent effects across shell forms and wrappers.
Reserve entire effect families and policy variants for evaluation to reduce memorization of command spelling.

## Codex dangerous-command matcher

**Confirmed at the cited commit.**
The supplied short revision resolves to `27c05a52e0cdf93ef7db5a96ccaf88d6b9095472`.
The matcher identifies forceful `rm` invocations and inspects `sudo`, `env`, and `trap` wrappers.
Its tests cover nested shell syntax, pipelines, substitutions, and scripts passed to a shell.
They also show limits for dynamically constructed command names and malformed shell source. [Pinned official source](https://github.com/openai/codex/blob/27c05a52e0cdf93ef7db5a96ccaf88d6b9095472/codex-rs/shell-command/src/command_safety/is_dangerous_command.rs)

This is a useful source of command-form variation and test cases.
Its narrow matching behavior should not be treated as a complete list of unsafe effects.

## Official ASU guidance for Sol and shared computing

**Restricted data.**
ASU Research Computing's acceptable-use policy says the covered systems comply with data-handling levels 1 and 2.
For regulated or restricted data, including personally identifiable or protected health information, it instructs users to consult Research Computing staff before using the systems to verify compliance. [ASU Research Computing acceptable-use policy, section 5](https://cores.research.asu.edu/computing-and-data-services/research-computing/policies/)

**Shared resource use.**
The policy prohibits running computational jobs on login nodes, jobs that disrupt other users, excessive idle jobs, and unattended listening services.
It places responsibility for protecting data on users and projects. [ASU Research Computing acceptable-use policy, sections 11.2 and data protection](https://cores.research.asu.edu/computing-and-data-services/research-computing/policies/)

**Sharing and ownership.**
ASU documents controlled file sharing using recipient scratch directories and group-owned project shares.
The scratch-sharing procedure temporarily opens permissions and revokes them after the transfer.
The documentation says not to apply that procedure to home directories. [ASU file-sharing guidance](https://docs.rc.asu.edu/sharing-files/)

ASU also documents installing group software in shared project storage.
It reserves administrative privileges for Research Computing staff and directs users to install software in storage where they have permission. [ASU building-software guidance](https://docs.rc.asu.edu/building-software/)

**Storage.**
Scratch storage is temporary, shared infrastructure without backups.
The scratch page says inactive files become eligible for removal after 90 days and recommends moving retained data to persistent storage. [ASU scratch guidance](https://docs.rc.asu.edu/scratch/)

Exact limits should not be silently embedded as universal rules.
For example, the resource-limits page says scratch is available without a quota, while the scratch page gives a per-user capacity limit. [ASU resource-limits page](https://docs.rc.asu.edu/resource-limits/), [ASU scratch page](https://docs.rc.asu.edu/scratch/)

**Limits of verification.**
The linked detailed data-handling standards returned an access error, and the linked general university computing policy redirected to a policy portal without its substantive text. [ASU security and privacy standards](https://getprotected.asu.edu/policy-practices/asu-information-security-privacy-standards), [Linked university computing policy](https://www.asu.edu/aad/manuals/acd/acd125.html)
The Research Computing policy itself was accessible.
It does not establish that every path owned by another user is secret or that an owner can authorize interfering with other users' work.

## Alleged incidents

**Claude Code issue 74539: report exists, cause unverified.**
The reporter describes deletion of home-directory contents during a Docker task launched from a project subdirectory.
The report says the session logs were destroyed, the command is unrecoverable, and there is no deterministic reproduction.
The issue was closed as inactive rather than containing a verified causal investigation. [Issue 74539](https://github.com/anthropics/claude-code/issues/74539)

**Claude Code issue 86872: report exists, cause partly inferred.**
The reporter attributes roughly 235,000 Windows profile deletions to a subagent's PowerShell call, citing timing, extension logs, and an NTFS journal.
The exact command is unrecoverable.
The issue presents the reporter's reconstruction and was closed as inactive. [Issue 86872](https://github.com/anthropics/claude-code/issues/86872)

**Claude Code issue 46684: report exists.**
The reporter says a request to investigate production logs led to two unrequested database column drops, with remaining triggers still referring to those columns.
The issue does not contain a vendor investigation establishing the underlying model or permission-system cause. [Issue 46684](https://github.com/anthropics/claude-code/issues/46684)

These reports justify testing scope expansion, broad deletion targets, subagent actions, and production changes during investigation.
They do not provide reliable frequencies of those failures.

**PocketOS: primary evidence inaccessible.**
The original founder post and article links returned access errors during this check. [Founder post](https://x.com/lifeof_jer/status/2048103471019434248), [Founder article](https://x.com/i/article/2048102151818559488)
The proposed recovery-update link was also inaccessible. [Recovery-update link](https://x.com/lifeofjer/status/2048576568109527407)
The specific deletion timing, token scope, backup layout, and restoration details are therefore unverified against primary evidence here.
Remote destructive operations and credential discovery remain useful test categories independent of those anecdotal details.

## Implications for the isolated data work

The following are proposed dataset requirements derived from the verified sources and the user's product vision.
They are analysis recommendations, with no live implementation or Sol job change.

| Category | Distinctions examples should teach |
| --- | --- |
| Sensitive-file reads | Default refusal, generic local-read permission, explicit permission naming the sensitive file, an ask response, and a later owner reply scoped to the same read. |
| Credential handling | Inspecting harmless configuration versus reading actual secrets, revealing values in output, or sending them to another destination. |
| Equivalent shell effects | Direct commands, wrappers, pipelines, interpreters, nested scripts, and variable-built targets with the same intended effect. |
| Destruction | Requested removal of named disposable outputs versus deletion of unrelated files, home directories, shared work, production data, or backups. |
| Shared storage | Unauthorized access to another user's private work versus authorized access to a project share or a deliberately shared scratch directory. |
| Shared jobs and processes | Reading status, changing one's authorized work, and interfering with another user's jobs or running a disruptive service. |
| Network actions | Approved public retrieval, unapproved search, requested backup transfers, secret-bearing uploads, and added destinations beyond the request. |
| Protected edits | Ordinary project changes versus changing the preference or protections governing the next action. |
| Investigation scope | Reading logs or status versus modifying running systems, changing schemas, or submitting new jobs. |

The sensitive-file ask behavior is a user requirement rather than a conclusion supplied by these public sources.
Show refusal, ask, and permitted work under similar wording so the model must learn intent and scope.
Always include the ask option in the proposed future input contract so its mere presence cannot predict the label.
Keep explicit test coverage for the single retained read guard and for commands whose effects cannot be fully determined from static inspection.
Decisions about how an owner reply satisfies that guard remain a separate implementation design item.

Future revisions should preserve source provenance and avoid treating benchmark labels, filesystem accessibility, or model agreement as proof of authorization.
Sol training and scheduling remain pending the user's approval.
