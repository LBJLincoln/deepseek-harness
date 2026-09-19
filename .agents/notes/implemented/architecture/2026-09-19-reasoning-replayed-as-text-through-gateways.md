# Agent Note: A prior step's reasoning is replayed as text through a gateway that drops the reasoning field

Status: implemented

English | [中文](2026-09-19-reasoning-replayed-as-text-through-gateways.zh.md)

## Problem

The first cells the Proving Ground bench ran on OpenRouter's free tier ([the record](../../../../data/proving-ground/README.md)) showed `deepseek/deepseek-v4-flash-0731:free` reading the task, the sources and the tests, running the tests, and then reading them again, for forty steps and three attempts, without one `write` or `edit` call, while `nvidia/nemotron-3-super-120b-a12b:free` on the same route and task wrote and edited its sources. The tool results were complete, the system prompt and tool schemas were the ones the certified Claude Code cells receive, and the prompt grew monotonically from step to step, so no history was being dropped.

What was being dropped was the model's own plan. The DeepSeek model puts its whole per-step deliberation in the `reasoning` channel and leaves `content` as a single space. The harness records that reasoning faithfully — `stream.ts` folds it into a `reasoning` block whose replay state carries `thinkingSignature: "reasoning"`, and `replay.ts` restores it as a pi-ai `thinking` block on the next request — and pi-ai's `openai-completions` serializer then puts it back on the wire as a top-level `reasoning` field on the assistant message, with `content: null`. OpenRouter ignores that field on input. Twelve live requests settled it: a codeword placed in the prior turn's `reasoning` field, or in a `reasoning_details` entry echoed byte for byte from a real response, came back as `UNKNOWN`; the same codeword in `content` came back verbatim. So at every step the model saw a history in which it had made tool calls and received results but had said nothing, and it restarted the investigation — which is also what its "the output got truncated" remarks were: a result for a call it could not remember making.

Nemotron escaped for an unrelated reason: it is in pi-ai's installed OpenRouter catalog with `reasoning: true` and no `off` level, so pi-ai sends `reasoning: { effort: "none" }` and the model narrates in `content`, which is replayed intact. The DeepSeek id is absent from that catalog, resolves to `reasoning: false`, and so receives no reasoning parameter at all; the provider's default is to think, and the thinking is what got lost.

pi-ai has the switch for exactly this: `compat.requiresThinkingAsText` moves a prior step's thinking into `content` as text. [`dsh-llm-pi-ai`](../../../../packages/llm/llm-pi-ai/README.md) exposed only `thinkingFormat` and `supportsReasoningEffort` and stated that the rest of pi-ai's compat surface stays auto-detected, and pi-ai's detection sets the switch from the endpoint URL, which for OpenRouter is `false`. Nothing an operator could write in a composition reached it.

## Decision

`PiAiCompatProfile` gains `requiresThinkingAsText?: boolean`, settable on a route (its models' default) and per model (winning per field), resolved and validated exactly as the two existing switches are: only on `openai-completions`, refused at load on a model of another protocol, skipped by a route-level default on such a model, merged over the installed catalog entry's compat rather than replacing it. Absent, the catalog entry's value and then pi-ai's URL-derived guess still apply, so no existing route changes.

The bench's `with-openrouter` overlay sets it at the route level, because every model on that route is served through the same gateway and the switch has no effect on a step that produced no reasoning. The adapter's tests pin both directions on the captured request body: with the switch off, a prior step from the same route is sent as `{ content: "Working.", reasoning: "<plan>" }`; with it on, as `content: [{ type: "text", text: "<plan>" }, { type: "text", text: "Working." }]` and no `reasoning` key. The `model-visible ⟺ logged` rule holds: the session log already carries every reasoning block, and the projection is a pure function of the log and the composition.

The pi-ai failure classifier gained one line in the same change: a message naming an overloaded or unavailable upstream without a status code (`Upstream error from Nvidia: Service temporarily overloaded`) maps to `SERVER`, the same transient class a 503 is, so the route's retry policy covers it instead of failing the attempt on the first such answer, which is what cut every Nemotron attempt short in the stopped first launch.

## Alternatives considered

- **Re-send `reasoning_details`.** Rejected by measurement: OpenRouter did not feed a `reasoning.text` detail back to the model either, and pi-ai keeps only `reasoning.encrypted` details, which this endpoint never produced.
- **Turn the model's thinking off** with `reasoningEfforts: { off: null, high: 'high' }`, so it narrates in `content` like Nemotron. Rejected: on a fresh turn with thinking off this model returned `content: null` and no narration at all, and the bench is not the place to disable a model's reasoning to work around a transport defect.
- **Point the overlay at the catalog id `deepseek/deepseek-v4-flash`.** Rejected: that entry declares `requiresReasoningContentOnAssistantMessages` and a level map with no `off`, so pi-ai would send `effort: "none"` — the Nemotron treatment, a different failure, not a fix.
- **Key the switch off `provider === 'openrouter'` in code.** Rejected: which gateways drop the field is a deployment fact that changes without a code release, and the repository's rule is that deployment-varying choices are validated `Config` fields, not constants.
- **Project reasoning to a text block inside the harness's replay** instead of exposing pi-ai's switch. Kept as the fallback: it would send the OpenAI-standard string `content` rather than an array, which pi-ai's own comment says one DeepSeek-family deployment mirrors literally; the array form did not misbehave in the probes, and exposing the switch keeps the projection where pi-ai owns it.

## Consequences

- A reasoning model behind OpenRouter, or any gateway with the same input rule, keeps its plan between steps once the route says so; the first DeepSeek cells stand as recorded, and the plan `h1-fleet-openrouter-deepseek-t2` reruns the same model over the six non-held-out tier-2 environments with the switch on.
- The switch is a snapshot of a gateway's behaviour, like the model list beside it: a gateway that starts honouring the field makes the array `content` redundant but not wrong.
- No keyless snapshot fixture composes a pi-ai route, so the adapter spec's captured request bodies are the regression pin for this model-visible change; a snapshot fixture over a replayed pi-ai route remains missing.
- The other free models on the route that narrate in `reasoning` were not measured before the fix; their records after it are the first that can be read as the model's rather than the transport's.
