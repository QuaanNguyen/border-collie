# Kimi reasoning and speed controls: manufacturer documentation

Accessed: 2026-10-09.
This check used public primary documentation only.
No inference requests, Sol access, jobs, or original-file changes were performed.

## Direct answer for K2.7 Code

Kimi K2.7 Code does not support turning thinking off.
Moonshot documents that a request with `thinking.type` set to `disabled` returns an error.
It also explicitly lists `reasoning_effort` as unsupported for K2.7 Code. [Moonshot model parameter reference](https://platform.kimi.ai/docs/api/models-overview)

The documented faster choice is a separate model ID, `kimi-k2.7-code-highspeed`.
Moonshot describes it as the same model with faster output, and its documentation says the thinking behavior and parameter constraints are identical.
HighSpeed therefore does not provide an instant or non-thinking mode. [K2.7 Code guide](https://platform.kimi.ai/docs/guide/kimi-k2-7-code-quickstart), [Moonshot model parameter reference](https://platform.kimi.ai/docs/api/models-overview)

The K2.7 manufacturer guide documents `max_tokens` as an output budget with a default of 32,768.
That is an output budget, not a switch for internal reasoning. [K2.7 Code guide](https://platform.kimi.ai/docs/guide/kimi-k2-7-code-quickstart)

## Related models and their documented request fields

| Model | Documented control | Scope |
| --- | --- | --- |
| Kimi K2.5 | Top-level `thinking: {"type": "disabled"}` | Selects Instant mode in the manufacturer's official API example. |
| Kimi K2.6 | Top-level `thinking: {"type": "disabled"}` | Selects non-thinking mode in the current API documentation. |
| Kimi K2.7 Code | Omit `thinking`; thinking remains enabled | There is no supported disabled mode and no supported `reasoning_effort` field. |
| Kimi K2.7 Code HighSpeed | Select `kimi-k2.7-code-highspeed` as the model | Increases output speed while retaining K2.7 thinking behavior. |

Moonshot's own K2.5 repository explicitly distinguishes the official API field from deployment-specific template settings.
Its Python SDK example uses `extra_body={"thinking": {"type": "disabled"}}` for the official API.
The SDK merges that object into the HTTP request body; `extra_body` is not the name of a field to send in the JSON body.
The example separately identifies `chat_template_kwargs` with `thinking: false` for vLLM or SGLang deployments. [Official K2.5 repository, Model Usage](https://github.com/MoonshotAI/Kimi-K2.5)

The current parameter reference confirms the same top-level disabled value for K2.6 and rejects it for K2.7 Code. [Moonshot model parameter reference](https://platform.kimi.ai/docs/api/models-overview)
Moonshot documents adjustable `reasoning_effort` values for K3, with a different request contract.
That field should not be generalized to older Kimi families. [Moonshot reasoning-effort guide](https://platform.kimi.ai/docs/guide/use-reasoning-effort)

## What response evidence can establish

Moonshot's Chat Completions reference documents `reasoning_content` alongside `content` in the assistant message.
It says reasoning content is returned only when thinking is enabled. [Moonshot Chat Completions reference](https://platform.kimi.ai/docs/api/chat)

In streaming responses, thinking models emit reasoning in `choices[0].delta.reasoning_content` before final-answer content.
In non-streaming responses, it is in `choices[0].message.reasoning_content`.
Moonshot's K2.7 guide says this model always emits reasoning content. [Moonshot thinking-model guide](https://platform.kimi.ai/docs/guide/use-thinking-models)

For any separately authorized check on a supported model, retain the complete raw request and response, the endpoint, requested and returned model IDs, all streaming chunks if used, and the completion status.
This distinguishes actual service output from a client that simply hides the reasoning field.

| Observation | Interpretation |
| --- | --- |
| Nonempty reasoning appears in the raw assistant message or any streaming delta | Reasoning was returned, so the response does not establish non-thinking mode. |
| A supported disabled request completes with a final answer and no returned reasoning | Consistent with the manufacturer's documented non-thinking behavior. |
| Only the final answer was saved while reasoning fields were discarded | Insufficient evidence about the requested mode. |
| A response is faster or shorter | Insufficient evidence that thinking was disabled. |
| `finish_reason` is `length` | The response was truncated, which cannot demonstrate a successful complete instant-mode response. |

The reference describes truncation using `finish_reason: "length"` and returns a model identifier in the response.
It does not document a separate reasoning-token usage counter or a response field that echoes the effective thinking setting. [Moonshot Chat Completions reference](https://platform.kimi.ai/docs/api/chat)
Absence of returned reasoning is evidence about the exposed response, with no independent proof of every internal computation.

The thinking-model guide also states that `max_tokens` covers both returned reasoning and the final answer.
Reducing it can truncate an answer after spending the available budget on reasoning.
The separate `thinking.keep` setting concerns preserving earlier turns' reasoning and does not switch off thinking in the current turn. [Moonshot thinking-model guide](https://platform.kimi.ai/docs/guide/use-thinking-models)

## Separation from the ASU deployment

These findings describe Moonshot's official API and its published model behavior.
They do not establish which fields ASU forwards, validates, ignores, or translates for its shared gateway.
The prior ASU documentation check remains recorded in [api-research.md](./api-research.md).
The supplied ASU model ID, `kimi-k2-7-code`, differs in spelling from Moonshot's public `kimi-k2.7-code` ID, so their routing equivalence has not been independently verified here.

Kimi Code's current documented model aliases can also select newer models.
For example, its current overview identifies `kimi-for-coding` as K2.8 Preview, while the HighSpeed alias refers to K2.7 Code.
A product-level Thinking control or a stable alias therefore does not establish the behavior of a fixed K2.7 deployment. [Current Kimi Code overview](https://www.kimi.com/code/docs/en/)

The research establishes no supported off or low-effort setting for a fixed K2.7 Code model.
It establishes an official Instant-mode field for K2.5 and a non-thinking field for K2.6, plus a distinct faster K2.7 model choice at Moonshot.
No model substitution or gateway option change was made.
