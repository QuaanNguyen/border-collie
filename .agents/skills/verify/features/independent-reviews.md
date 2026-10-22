# Independent reviews

## Sub-features

Require two distinct model families, complete exact-input decisions and recorded requested and reported gateway model identities.
Exclude the entire family on a missing, abstained, stale or disputed decision.

## How to get to it (user POV)

The generation runner stores separate review files inside its frozen snapshot.
Gemma and GLM each review only the exact production request packet.

## Driving it with the Node CLI

Run the verification helper with the snapshot and two explicit review paths as shown in the parent skill.
Inspect `reviewers`, `failures`, `accepted`, `excluded` and `quarantinedFamilies` in its JSON output.
The successful integrity end state has both complete review counts and no review identity, input hash or response receipt failure.
A disagreement must remain excluded and visible rather than being converted into agreement by the audit.

## Gotchas

The reviewer may share the author's model family; independence here means the two reviewer calls receive separate exact-input packets without suggested answers or each other's decisions.
This is not human gold data.
Local response receipts establish recorded provenance only.
Unknown or duplicate review decisions fail integrity.
An additional third review file requires explicitly selecting the intended pair rather than silently choosing two files.
