# Model selection benchmark evidence

Research checked on October 8, 2026.
The target tasks are synthetic tool-action scenario proposal and independent policy-based allow/deny annotation.
Public benchmark evidence supports a provisional shortlist, not a proven winner on this repository's labeling rubric.

## Recommendation

Start with Inkling-Small for proposal and Kimi K2.7 Code for independent labeling.
This is an inference from instruction following, tool competence, reasoning, the supplied ASU catalog metrics, and model-family independence.
Inkling's strong instruction adherence fits constrained scenario generation, while Kimi's strongest observed reasoning and coding scores fit interpreting tool actions and policy boundaries.
No primary-source head-to-head comparison of these endpoints on policy-based allow/deny annotation was found.

## Primary evidence

| Model | Relevant reported metrics | Source and limitation |
| --- | --- | --- |
| Kimi K2.7 Code | MCP-Atlas 76.0; MCPMark Verified 81.1; Kimi Code Bench v2 62.0 | [Moonshot model card](https://huggingface.co/moonshotai/Kimi-K2.7-Code); vendor-reported agent results, thinking enabled, 262,144-token context |
| GLM-5.3 | Toolathlon Verified 73.0; CyberGym 84.5; Agents' Last Exam CLI 28.5; Terminal-Bench 3.0 28.3 | [Z.ai model card](https://huggingface.co/zai-org/GLM-5.3); tool, cyber, and agent competence are indirect evidence for labeling; Toolathlon uses the official evaluation service |
| Qwen3.8-27B | IFBench 79.5; GPQA Diamond 89.2; HLE 30.8 | [Qwen model card](https://huggingface.co/Qwen/Qwen3.8-27B); instruction following and reasoning are indirect evidence, with no safety-judge metric |
| Qwen3-235B-A22B-Thinking-2507 | IFEval 87.8; BFCL-v3 71.9; WritingBench 88.3 | [Qwen model card](https://huggingface.co/Qwen/Qwen3-235B-A22B-Thinking-2507); a credible backup for reasoning-heavy labeling, but these are not labeling evaluations |
| Qwen3-235B-A22B-Instruct-2507 | IFEval 88.7; BFCL-v3 70.9; WritingBench 85.2 | [Qwen model card](https://huggingface.co/Qwen/Qwen3-235B-A22B-Instruct-2507); useful structured generation evidence, but no direct policy-judgment score |
| Inkling-Small | HLE 31.6%; FORTRESS adversarial 71.6%; FORTRESS benign 96.9%; StrongREJECT 98.4% | [Thinking Machines release](https://thinkingmachines.ai/news/inkling-small/); refusal behavior and benign compliance are distinct from correctly judging another agent's action |

The final [Inkling-Small model card](https://huggingface.co/thinkingmachines/Inkling-Small) reports IFBench 82.2%, GPQA Diamond 89.5%, and SWE-bench Verified 80.2%.
The July 15 preview reported IFBench 83.4%, but this should not be substituted for the July 30 final model's score.

## ASU portal comparison

These LiveBench category scores were observed in the ASU portal during this research.
They have no displayed evaluation release, run date, or settings, so they are portal-reported rather than independently reproduced results.

| Endpoint | Overall | Reasoning | Coding | Instruction following | Language |
| --- | --- | --- | --- | --- | --- |
| Kimi K2.7 Code | 85.6 | 98.7 | 91.9 | 89.2 | 71.1 |
| Inkling-Small | 83.8 | 95.8 | 87.5 | 97.7 | 61.0 |
| Qwen3.8-27B | 81.7 | 97.3 | 85.5 | 89.0 | 55.3 |
| GLM-5.3 | 78.5 | 97.2 | 73.8 | 77.1 | 62.3 |
| Qwen3 Instruct 2507 | 75.3 | 92.4 | 65.9 | 78.0 | 68.0 |

The corresponding upstream model identities exist in official publisher sources.
These sources do not independently confirm that ASU's aliases serve the identical weight revision, quantization, reasoning settings, or chat template.
ASU's supplied screenshot lists Kimi at 85.6 overall LiveBench and 71.1 language, Inkling-Small at 83.8 and 61.0, Qwen3 Thinking at 80.2 and 62.0, GLM-5.3 at 78.5 and 62.3, and Qwen3 Instruct at 75.3 and 68.0.
Those scores are snapshot evidence supplied by the user; the benchmark release and evaluation configuration were not shown.
The [LiveBench site](https://livebench.ai/) returned no extractable leaderboard table in the web reader, so the screenshot scores were not independently reproduced.
IFEval and IFBench are different benchmarks and their percentages should not be compared directly.

## Task-specific validation

[R-Judge](https://arxiv.org/abs/2401.10019) directly evaluates safety risk judgment over 569 multi-turn agent records across 27 scenarios, five application categories, and ten risk types.
Its published results predate the candidate models and therefore do not rank the available endpoints.
[BiasScope and JudgeBench-Pro](https://arxiv.org/abs/2602.09383) report that strong evaluator models can still exceed 50% error under adversarial judge biases.
These results justify evaluating label accuracy on the actual repository policy rather than substituting a general leaderboard rank.

Use a human-reviewed, held-out sample with both safe and unsafe actions, ambiguous authorization, prompt injection, destructive actions, and data disclosure.
Compare macro F1, unsafe-action recall, false-denial rate, rationale correctness, and valid structured output at the ASU endpoint settings.
Measure proposal diversity, policy coverage, validity, and reviewer acceptance separately.
Keep the labeler blind to the proposer's intended answer and rationale.
