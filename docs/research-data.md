# Research files

Install Git LFS and download the files before replaying the research:

```sh
git lfs install
git lfs pull
python3 analysis/checker-v3-2026-10-19/manifest-data.py --check
```

The [data manifest](research-data-manifest.json) lists each path, byte count and SHA-256 checksum.
The commit containing the manifest identifies the complete snapshot.
Git LFS stores each file under that checksum, so no separate dataset account or revision is required.

The stage-two drafts, evaluation results, snapshot manifest, tool inventory and research evidence use Git LFS.
They are excluded from the installed product.
CI downloads only the tool inventory needed by its tests.

The old analysis folder is available under [artifacts](../analysis/needle-judge-2026-10-09/artifacts).
The [recovery record](../analysis/needle-judge-2026-10-09/artifact-recovery.json) distinguishes the 93 historical files recovered from commit `71bb67d` and the 30 additional files found on this Mac.
Seven source and job records linked by the old report were also copied from the original local snapshot.
All local report links now point into the repository.
No artifact files are needed from the owner.
These are preserved records, including superseded drafts, probe models and dependency caches; publishing them does not qualify them for training or deployment.

The old 1,500-case draft and current drafts remain separate.
The new [tool-input audit](../analysis/checker-v3-2026-10-19/input-contract-audit.json) records the result for each of the 47 previously unchecked entries.
The new [risk review](../analysis/checker-v3-2026-10-19/evidence/risk-review-v2) uses corrected, schema-checked inputs.
The earlier risk packet omitted a required subagent description and is retained as invalidated evidence only.
Neither its labels nor stale labels are used for the corrected requests.
