# Disputed case review

The [reproducible audit](../analysis/needle-judge-2026-10-09/scripts/dispute-audit.js) reads the original review evidence directly from commit `71bb67d` and hashes every source.
It preserves all labels and exclusions.
The [counts](experiments/historical-dispute-audit-2026-10-16.json) cover all 3,336 historical cases, including the 883 excluded cases.

There were 311 direct disagreements: 160 allow versus ask, 95 ask versus disallow, and 56 allow versus disallow.
The remaining 572 excluded cases had reviewer agreement, but their families or permission checks failed.
It would therefore be wrong to describe all 883 as individually disputed or all retained cases as human-verified.
Family-level reasons overlap and must not be added as if they were disjoint cases.

| Indicator | Retained | Excluded |
| --- | ---: | ---: |
| Cases | 2,453 | 883 |
| Original families | 1,288 | 293 |
| Median user-request characters | 78 | 84 |
| Median action characters | 52 | 52 |
| Compound commands | 255 | 39 |
| Variable or substitution commands | 0 | 0 |
| Commands longer than 200 characters | 0 | 0 |
| Sensitive action patterns | 76 | 18 |

These are difficulty indicators, not correctness measurements.
The excluded set is not simply a collection of longer scripts; both groups lack the dynamic and long-command coverage the owner requested.
The full receipt includes category, topic, and tool counts for both groups.
A [bounded eight-case queue](experiments/historical-dispute-queue-2026-10-16.json) preserves representative critical families and both review reasons.
Those historical inputs need current-contract copies and fresh review before any decision could become a new training label.
They are never relabeled merely to reach the required sample count.

The separate human audit of the first independently authored evaluation identified contradictory Preferences and missing target or environment facts.
Its [assessment](experiments/independent-evaluation-contract-review-2026-10-16.json) preserves the owner's provisional decisions and reasons.
Only the first case could be verified without extra assumptions.
That case explicitly permits the pip update and installed-dependency check, whose operation is described in the [pip reference](https://pip.pypa.io/en/stable/cli/pip_check/).
The package-manager case depends on its configured repositories, as documented in the [APT reference](https://manpages.debian.org/trixie/apt/apt-get.8.en.html), and the worktree case does not establish the branch-to-directory mapping.
The other six remain excluded and the set is not qualified as blind evaluation evidence.
Model agreement cannot replace those unresolved owner decisions.

Replacement evaluation cases use fixed Preference references so an author cannot invent contradictory rules.
The rejected frozen inputs and partial reviews remain preserved.
Current repaired-data exclusions, coverage and difficulty still require both independent reviews to finish before a new freeze.
