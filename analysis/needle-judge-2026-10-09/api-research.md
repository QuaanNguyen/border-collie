# ASU RC gateway: reasoning controls

Accessed: 2026-10-09.
No inference requests, authenticated model-list requests, Sol connections, or job operations were performed for this check.

The public ASU documentation does not establish a supported way to disable Kimi reasoning or set its inference effort through the shared gateway.
Support remains unverified.
The absence of documentation does not establish that the server rejects a particular field.

The official API guide documents the Chat Completions endpoint at `https://openai.rc.asu.edu/v1/chat/completions`, the base URL, authentication, basic message requests, and listing model IDs.
It contains no Kimi-specific settings, reasoning toggle, thinking setting, or inference-effort option. [ASU LLM API Access](https://docs.rc.asu.edu/ai/api/)

ASU's beginner guide describes a Reasoning capability badge in the model catalog.
That description does not specify a request parameter for controlling reasoning. [ASU Getting Started with AI](https://docs.rc.asu.edu/ai/getting-started/)

The linked OpenCode and VS Code gateway setup guides also provide no reasoning-control parameter. [ASU OpenCode setup](https://docs.rc.asu.edu/ai/api/opencode/), [ASU VS Code setup](https://docs.rc.asu.edu/ai/api/vscode-byok/)

The main gateway API guide does not document `max_tokens`, `max_completion_tokens`, or another raw request parameter for limiting output length.
Targeted public-document searches also found no gateway-specific reference for `max_tokens`, `max_completion_tokens`, or `max_output_tokens`. [ASU LLM API Access](https://docs.rc.asu.edu/ai/api/)
The VS Code guide includes `maxOutputTokens: 8192` in its local model configuration example.
That is a client configuration entry rather than a documented raw gateway request field.
The guide does not specify how it maps to a request or establish an accepted output-length field for Kimi. [ASU VS Code setup](https://docs.rc.asu.edu/ai/api/vscode-byok/)

ASU documents `chat_template_kwargs.enable_thinking` for a Qwen3.5-27B server launched by the user with vLLM on Sol.
The example sets that option to false to disable thinking.
That tutorial describes a separate hosting setup and does not establish support for Kimi, the shared gateway, or the supplied Qwen3-235B deployment. [ASU vLLM hosting guide](https://docs.rc.asu.edu/vllm/)

The gateway root and the attempted public documentation/schema routes were inaccessible through the browsing tool. [Gateway root](https://openai.rc.asu.edu/), [Documentation route](https://openai.rc.asu.edu/docs), [Schema route](https://openai.rc.asu.edu/openapi.json), [Versioned schema route](https://openai.rc.asu.edu/v1/openapi.json)
No deployed gateway schema was obtained.

The model IDs supplied for this investigation were `kimi-k2-7-code`, `inkling-small`, and `qwen3-235b-a22b-instruct-2507`.
Their names do not establish supported inference controls.

For the copied-data review, keep Kimi reasoning controls unspecified until ASU supplies deployment-specific documentation or a schema confirming an option.
A shorter requested answer and a limit on returned text do not establish that internal reasoning has been disabled.
No unsupported option was tested or added to any client by this research.
