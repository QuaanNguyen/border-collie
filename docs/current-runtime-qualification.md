# Current input and runtime qualification

**Do not train or deploy a replacement yet.**
The official answers-only target and pinned native decoding still disagree.
The target starts directly with the tool-call marker, whereas the native runner produces reasoning before the decision.
All 108 locally tested cases produced reasoning, including the historical answers-only candidate.
The [current measurements](experiments/current-input-runtime-2026-10-16.json) record this no-go result.

The captured official trainer and tokenizer are pinned to source revision `ef3cf7543204d99878c0dd913a05f6a506da4be8`.
The tokenizer hash is checked against the existing four-bit export.
The complete proposed set has 6,644 inputs.
Checking each against all three possible answer targets gives 326 to 691 tokens, a median of 490, and a 95th percentile of 588.
None exceeds 1,024 tokens, but 2,312 exceed 512; silently using 512 would lose evidence.
This size check establishes fit, not correct labels or learning.

The Mac test selects the longest request for each new topic and authored decision contrast, plus twelve long copied cases.
It uses the complete frozen query, all tool descriptions, four threads, a 128-token output limit, and the production 15-second deadline.

| Artifact | Weight bytes | Median seconds | 95th percentile seconds | Maximum seconds | Ambiguous or missing decisions |
| --- | ---: | ---: | ---: | ---: | ---: |
| Shipped base | 35,335,380 | 0.269 | 0.382 | 0.562 | 11 of 108 |
| Matched untuned export | 63,437,076 | 0.191 | 0.322 | 0.548 | 8 of 108 |
| Historical answers-only candidate, rank 16, seed 1 | 63,437,076 | 0.268 | 0.363 | 0.442 | 0 of 108 |

There were no process failures or timeouts in these measurements.
Conflicting decisions are now withheld instead of accepting the first call.
The largest reported memory use was recorded with each artifact in the receipt.
Two measurements ran concurrently on the Mac, so their timings include local contention.
These proposals do not have final human labels, and this table makes no accuracy comparison.
The candidate used historical training inputs and cannot demonstrate improvement from the repaired dataset.

A separate oversized input was rejected as context overflow, returned no tool calls, and finished in 0.163 seconds.
The native runner's overflow-refusal flag must remain enabled.
Inputs that fail or lack a single valid decision must withhold the action.

The practical deployment checks remain: preserve complete evidence, require enough input capacity, retain the 15-second deadline, verify artifact hashes, and accept exactly one decision.
The answers-only format mismatch remains a blocker even though these Mac timings fit the deadline.
No Linux job was submitted for the repaired inputs, and the Mac measurements do not establish Linux or Raspberry Pi performance.
The [Cactus runtime explanation](https://www.cactuscompute.com/blog/porting-needle#the-prompt-on-the-wire) describes the native reasoning prefix and other prompt details that require agreement with training.
