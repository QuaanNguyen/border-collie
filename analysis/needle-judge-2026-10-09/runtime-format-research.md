# Needle training and Mac runtime format check

Accessed and checked on 2026-10-09.
This check used copied source, copied historical records, copied binaries, and public official documentation.
Only this note was written.
No inference, training, scenario commands, credential reads, dependency installation, or Sol access was performed.

## Finding

The training and evaluation application paths supply identical query text and tool objects on all 1,000 copied historical training examples.
The historical official trainer and the newly captured official source have identical prompt-rendering and target-encoding functions.
Full equivalence with the pinned native runner remains unverified because its internal renderer and token trace were not recovered.
Official Cactus documentation describes runtime transformations and forced thinking that the trainer does not reproduce in every mode.
Therefore poor native accuracy on training examples establishes that the deployed pipeline does not fit those examples well, but it does not isolate optimization as the cause.

## Exact artifacts

| Artifact | Identifier | Evidence |
| --- | --- | --- |
| Historical official trainer | `cactus-needle==3.1.2`; SHA-256 `677b2e4aba1fd9ce5ff6e6e19763d0a66b8425eccf626f7107e2e3ace5d99241` | [Copied historical trainer](/Users/quan/Repos/border-collie/analysis/needle-judge-2026-10-09/snapshot/guard/prototype/output/sol-300-seed42/upstream/finetune.py:201), [saved seed 0 job record](/Users/quan/Repos/border-collie/analysis/needle-judge-2026-10-09/snapshot/guard/prototype/output/needle-official-ladder/sol-batch-results/job-reasoning-1000-seed0.json:6) |
| Captured public trainer | Git revision `ef3cf7543204d99878c0dd913a05f6a506da4be8`; SHA-256 `1b3eb3006c32804a47f5e9f603dbee8e4104ea3c6179199807dd3690d31fc832` | [Official source at that revision](https://github.com/cactus-compute/needle/blob/ef3cf7543204d99878c0dd913a05f6a506da4be8/needle/model/finetune.py#L201), [capture provenance](/Users/quan/Repos/border-collie/analysis/needle-judge-2026-10-09/artifacts/public-source/ef3cf7543204d99878c0dd913a05f6a506da4be8/provenance.json) |
| Mac runner | Hugging Face revision `2ae11323dc000f5e70c49f7403efa6af12ba9e67`; path `macos-arm64/needle`; SHA-256 `342fa2c6f140e702354a99c4201c9057535ec908eed35c7382e911a19d1d2724`; 1,089,896 bytes | [Copied manifest](/Users/quan/Repos/border-collie/analysis/needle-judge-2026-10-09/snapshot/guard/lib/judge-artifacts.js:11), [official artifact revision](https://huggingface.co/Cactus-Compute/needle3/commit/2ae11323dc000f5e70c49f7403efa6af12ba9e67) |
| Training tokenizer capture | SHA-256 `97dfd5666620b19875deba9e55953d312364e7763bd08bee428b94f1b9491b25` | [Official pinned tokenizer URL](https://huggingface.co/Cactus-Compute/needle3/resolve/2ae11323dc000f5e70c49f7403efa6af12ba9e67/tokenizer/tokenizer.model), [capture provenance](/Users/quan/Repos/border-collie/analysis/needle-judge-2026-10-09/artifacts/public-tokenizer/provenance.json) |

Both isolated copied Mac runners were hashed during this check and match the manifest digest above.
The historical trainer file was also hashed and matches the saved historical job record.
An AST comparison confirms identical `render_example`, `_encode`, `from_chat`, `fit_max_len`, and `load_jsonl` functions between the historical and captured trainer files.
Their whole-file hashes differ, and `read_examples` differs, so this is a formatter comparison rather than a claim that the entire trainers are identical.
The historical trainer's Git source revision is not recorded by those saved job records.
The Hugging Face revision identifies the published artifacts, not a recovered native source/build revision.

## What matches and what remains uncertain

| Layer | Result | Meaning |
| --- | --- | --- |
| Application query | Verified for 1,000 historical training cases | Reconstructed query text equals saved reasoning-training query text in every case |
| Application tool objects | Verified for those 1,000 cases | Exact serialized tool objects match before native processing |
| Historical versus captured training formatter | Verified for rendering and target encoding | Same tool/query assembly, target construction, BOS/EOS insertion, and masking |
| Tokenizer vocabulary and scores | Existing saved check confirms match | Training tokenizer pieces/scores match the copied export's embedded tokenizer |
| Reference tokenizer IDs | Existing saved check confirms 28 sampled cases | SentencePiece agrees with the public archive reference encoder on sampled prompts and targets |
| Native rendered tool JSON | Unverified | Runtime documentation describes schema normalization; no exact emitted JSON was captured |
| Native prefix and query token IDs | Unverified | Tokenizer agreement does not show which string or token boundaries the binary actually supplies |
| Native first generated token and stop behavior | Unverified for this binary | Official documentation describes forced thinking; release binary output does not expose token IDs |
| Semantic answer payload | Compatible | Training targets and returned native calls use tool names with argument objects |

The application comparison reconstructed requests from copied scenarios using only the copied request builder and effect extractor.
It executed no proposed scenario action.
It found zero query mismatches and zero tool-object mismatches against the copied 1,000-example reasoning-training file.
Both paths therefore share the same clipping and effect representation at this application boundary. [Copied pipeline](/Users/quan/Repos/border-collie/analysis/needle-judge-2026-10-09/snapshot/guard/prototype/finetune-pipeline.js:37), [training row builder](/Users/quan/Repos/border-collie/analysis/needle-judge-2026-10-09/snapshot/guard/prototype/finetune-pipeline.js:262)

## Training format

The official formatter minifies the supplied tool array and answer array, preserving Unicode.
It writes an optional system turn, then a user turn containing the tools, one newline, and the query, followed by an open assistant turn.
A nonempty reasoning value adds a thinking block before the tool-call target.
An absent or empty reasoning value starts the target directly with the tool-call marker.
Encoding adds BOS ID 2 and EOS ID 1, masks the prompt from loss, and supervises the target including EOS. [Captured official formatter](https://github.com/cactus-compute/needle/blob/ef3cf7543204d99878c0dd913a05f6a506da4be8/needle/model/finetune.py#L201), [token constants](https://github.com/cactus-compute/needle/blob/ef3cf7543204d99878c0dd913a05f6a506da4be8/needle/model/tokenizer.py#L8)

The copied 1,000-example reasoning file has reasoning on every row and no system field.
Its saved official input contains 1,100 rows including validation, with reasoning on every row and no system field.
The historical seed 0 and seed 42 run records report a maximum complete training sequence of 430 tokens, below their configured 1,024-token cap.
Their low native accuracy cannot be attributed to training-input truncation on that evidence. [Seed 0 run record](/Users/quan/Repos/border-collie/analysis/needle-judge-2026-10-09/snapshot/guard/prototype/output/needle-official-ladder/sol-batch-results/reasoning-1000-seed0/run.json), [seed 42 run record](/Users/quan/Repos/border-collie/analysis/needle-judge-2026-10-09/snapshot/guard/prototype/output/needle-official-ladder/sol-batch-results/reasoning-1000-seed42/run.json)

## Documented native differences

Cactus describes a cached prefix using the same chat and tool markers, an optional system turn, and minified tool JSON.
It also describes unwrapping OpenAI tool envelopes, aliasing names to snake case, and removing unsupported schema keys before rendering.
Most importantly, the document says the engine forces the thinking marker at the start of every response. [Official porting guide, prompt section](https://cactuscompute.com/blog/porting-needle#the-prompt-on-the-wire)

These Judge tool names are already in snake case, their arguments have no properties, and their schemas have no triggers or OpenAI wrappers.
The documented aliasing and wrapper removal therefore do not establish a mismatch in these particular tool names.
They also do not prove identical key ordering, treatment of empty required lists, Unicode escaping, or complete schema serialization in the pinned binary.

Forced thinking would conflict with the official trainer's immediate tool-call target when reasoning is omitted.
That is a documented compatibility concern for the owner's answers-only study, not proof that the pinned binary forces it and not an explanation established for historical models trained with reasoning.
The owner's choice remains official training with answers-only targets.
The next study needs an explicit compatibility check, without silently adding prose reasoning or modifying a custom trainer.

The Python wrapper's automatic date fact is a separate behavior.
This repository invokes the native CLI directly and supplies no system flag, so Python's automatic date behavior is not evidence that these historical requests received an extra system turn. [Copied CLI invocation](/Users/quan/Repos/border-collie/analysis/needle-judge-2026-10-09/snapshot/guard/lib/judge.js:154), [official Python wrapper](https://github.com/cactus-compute/needle/blob/ef3cf7543204d99878c0dd913a05f6a506da4be8/needle/__init__.py#L430)

## Answer and decoding behavior

The supervised answer is an array containing a verdict-tool name and an empty argument object.
The native CLI returns a response envelope containing function calls, suppressed calls, confidence, and other metadata.
The application accepts the first recognized verdict in function calls or suppressed calls and ignores confidence when choosing it. [Copied verdict parser](/Users/quan/Repos/border-collie/analysis/needle-judge-2026-10-09/snapshot/guard/lib/judge.js:83)

Cactus describes schema-constrained decoding and postprocessing in native inference. [Official Python response contract](https://www.cactuscompute.com/blog/needle-python-docs#the-response)
Those operations differ from supervised teacher-forced loss even if the input tokens match.
The native generation cap is 128 tokens and the application discards raw reasoning and token-level output.
The copied historical Mac reports therefore cannot show whether a wrong decision came from decoding, a gate, unexpected reasoning, or output truncation.
The existing complete training probes show 574/1,000 correct for seed 42 and 578/1,000 for seed 0, but those numbers alone do not distinguish these causes. [Existing seed 42 probe](/Users/quan/Repos/border-collie/analysis/needle-judge-2026-10-09/artifacts/reasoning-1000-seed42-training-probe.json), [existing seed 0 probe](/Users/quan/Repos/border-collie/analysis/needle-judge-2026-10-09/artifacts/reasoning-1000-seed0-training-probe.json)

## Bounded local verification prerequisite

The copied release binary's symbols and embedded usage text expose no documented token-prefix dump or reasoning-off flag.
That inspection is not proof that an undocumented interface does not exist.
The public native source or a reproducible build mapping to the pinned digest was not recovered in this bounded check.
Cactus's porting guide says a debug build can print prefix and turn token IDs, but that does not establish that the copied release has the same facility.

A safe local inference-only follow-up can use the copied runner and copied weights with fictional requests and temporary tool files inside this analysis directory.
It should capture full stdout and stderr directly, including the reasoning, suppressed calls, errors, and generation-cap behavior that the application currently discards.
The returned tools must remain data and must never be dispatched.
This can establish observed response behavior and test whether a larger output cap changes decisions, but raw responses alone cannot prove the internal first token was forced or recover the complete input prefix.

Exact format equivalence requires prefix/turn token IDs from a matching official debug build, or a bounded local trace of this exact binary, compared with the historical official renderer on identical fictional inputs.
Compare schema serialization, query bytes, system-turn presence, BOS/chat markers, assistant boundary, thinking/tool-call transition, and stop tokens before interpreting a later training study.
Treat a source-identical native/JAX quantized inference comparison as a separate check for export, quantization, and decoding differences after prompt equivalence is established.
No such follow-up was run here, and no Sol study was started or altered.

## Plain-language summary

Training and testing receive the same request at the application level, but we have not proved they receive the same internal model prompt.
The official runtime documentation suggests it may require a thinking step even when official training data omits it.
That needs a local compatibility check before spending another training run trying to solve the accuracy problem.
