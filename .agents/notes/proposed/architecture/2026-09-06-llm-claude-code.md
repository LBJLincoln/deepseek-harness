# Agent Note: the LLM seam served by a local Claude Code installation

Status: proposed

English | [中文](2026-09-06-llm-claude-code.zh.md)

## Problem

The harness is model-agnostic at the LLM seam, but both shipped providers need an API key: [`dsh-llm-deepseek`](../../../../packages/llm/llm-deepseek/README.md) resolves `DEEPSEEK_API_KEY` and [`dsh-llm-pi-ai`](../../../../packages/llm/llm-pi-ai/README.md) resolves one credential per configured route. A host with no key and a Claude Code installation the operator has already authenticated can therefore run no harness role at all through the seam.

That installation can already enter the harness, but only through the subagent seam, where [`dsh-subagent-claude-code`](../../../../packages/subagent/subagent-claude-code/README.md) hands it a whole delegated task. Everything the harness owns is then out of reach for the work that task performs: the product picks its own tools, its own file access, its own loop, and its own session, and the harness sees one opaque answer. Nothing about the operator's subscription requires that trade — only the absence of a provider that speaks the LLM seam.

## Proposal

Add `@deepseek-ai/dsh-llm-claude-code`: a Service Provider on the LLM seam whose every `generate()` is one stateless query to the operator's installation through the pinned official Agent SDK (`@anthropic-ai/claude-agent-sdk`), the same dependency and the same process ownership the subagent provider already uses.

One plugin instance registers one route on `ctx.llm`. The route name is a required `Config` field with no default, and the model catalog is required configuration too: the harness cannot interrogate an installation for the models its subscription entitles, so only the operator can say. Unlike the keyed adapters, whose catalogs are advisory, a request naming an unlisted model fails with `UNKNOWN_MODEL` before any query starts, because an unlisted id here has no meaning to pass through to. A catalog entry's optional `productModel` is what the query asks the installation to run; omitting it leaves the option off so the installation runs whatever it is configured to run.

Each request renders into two query inputs. The harness system prompt becomes the query's custom system prompt, replacing the product's own preset. The conversation and the harness tool definitions become one prompt text: a reading-guide line, a tool section, then every message in log order, framed by `dsh-`-prefixed tags with escaped attribute values. When rendered content itself contains the prefix, the whole rendering moves to the first free numbered prefix, so no message can be read as framing. The answer is requested as a structured output of `{ content, toolCalls: [{ name, arguments }] }`, with `arguments` a JSON string — the form the seam carries end to end.

The product therefore executes nothing. `tools: []`, `mcpServers: {}`, `strictMcpConfig: true`, `settingSources: []`, and `persistSession: false` leave it one prompt and one schema; the permission mode never prompts and denies anything not pre-approved. Every tool call comes back as a seam chunk, and the harness agent loop executes it under the harness's own tools, session log, read barrier, budget policy, and approvals — which is the whole point of putting this at the LLM seam rather than the subagent seam.

The SDK-spawned CLI goes under `ctx.subprocess` through the same custom-spawn projection the subagent provider uses, so the harness owns the process tree, its environment scrub, and its termination ladder. The harness cancellation signal drives the SDK's abort controller.

### The turn bound

The query asks for `maxTurns: 2`, counted in assistant messages. What makes one `generate()` one model response is offering no tools: the product can speak and then deliver its structured answer, and it can never act between turns. The bound is two rather than one because the delivery costs an assistant message of its own — a one-turn bound refuses every reply that says anything before delivering, which is most of them. It is fixed rather than configurable because it belongs to the product's structured-output protocol, not to a deployment.

### What is logged

The rendering is a pure function of the messages the seam hands over, and those messages are themselves derived from the session log, so every model-visible input this process authors is reconstructable from the log — the [reconstructability](../../implemented/architecture/2026-07-05-reconstructable-requests.md) property holds unchanged.

One input is outside that: the product wraps the supplied system prompt with an envelope of its own, which this package neither authors nor can inspect. `request/header` records everything the harness sends and nothing about that wrapper. This is the one place where the route is weaker than a keyed adapter, and it is a property of driving a product rather than an API.

### Keeping the query alive

A query takes seconds before its first token. `includePartialMessages: true` makes the product publish partial assistant events while it works, and those events are what rearm the provider's own idle watchdog, so `queryTimeoutMs` bounds a silent installation rather than the answer's duration — the same posture as the keyed adapters' `streamIdleTimeoutMs`.

Those partials are not forwarded to the seam as chunks. The `StreamChunk` protocol has no block-neutral heartbeat: `BlockAssembler` opens a partial block for any delta, so an empty text delta would put a spurious empty text block in every tool-call-only response and log one `assistant/chunk` per partial. The cost is that first-token time equals whole-answer time for this route, which the stats projection reports honestly.

## Alternatives considered

**The trampoline: let the product's own loop call the harness tools through an in-process MCP server.** Another slice is building exactly that as a bridge in the subagent seam, where it belongs: it gives a delegated task the harness's tools while the product keeps its loop, its session, and its multi-step control. At the LLM seam it would be the wrong shape. `generate()` is one model response, and a trampolined query would run a whole nested agent loop behind it — tool calls the harness never logged as its own steps, budget the session-budget guard never counted, approvals the interaction seam never saw, and a `request/header` that no longer explains the response. Keeping this provider stateless is what makes every harness role work unchanged: the loop stays the harness's, so the read barrier, the plan-mode state, the compaction threshold, and the retry policy all keep meaning what they mean on a keyed route.

**Extend `dsh-subagent-claude-code` instead of adding a package.** The subagent provider answers a different Service Definition — it starts and settles a delegated run — and its capabilities, cancellation, and result vocabulary are the subagent seam's. Sharing a package would fuse two seams' contracts to save one dependency; the two do share the SDK pin and the custom-spawn projection, and that duplication is deliberate and marked, because neither package may depend on the other.

**Ask for tool calls in free text instead of a structured output.** It would remove the schema and the turn the product spends delivering it, but parsing tool calls out of prose is exactly the failure the seam's raw-JSON-argument contract avoids, and a malformed call would be indistinguishable from an answer. The structured output makes a missing or unreadable answer a provider failure with a code, never an empty turn.

**Let the product read the workspace and run its own tools for read-only work.** Cheaper per turn, and wrong: the harness's read barrier, observation policy, and approvals are the reason a tool result is trustworthy. A route that sometimes bypasses them would make the session log an incomplete account of what the agent did.

## Acceptance criteria

- `ctx.llm` serves the configured route end to end from a `cordis.yml` booted through the real Loader, with the SDK's `query` mocked: the route registers, a request returns text and tool-call chunks, and the CLI the SDK asks to spawn goes through the mounted subprocess seam.
- Unit specs hold per-file 100% coverage over `src/`, covering the rendering of a multi-turn conversation with tool calls and results, the tool section, structured-output parsing including tool calls, error mapping, cancellation, idle expiry, the unknown-model refusal, and config validation.
- An opt-in e2e (`DSH_E2E_CLAUDE_CODE=1`) composes `examples/headless-agent` over this route and drives a real installation: the agent creates a file and reads it back through the harness's own bash and editor tools, and the workspace file is verified outside the agent.
- No keyless snapshot accompanies this route. The snapshot harness replays recorded provider transcripts, and this route's provider is a local process whose answers are not recorded; adding one would mean recording the SDK message stream, which is a separate slice. The Loader-booted e2e and the opt-in real run are the evidence until then.

## Risks

**Latency and cost per turn.** Each turn pays the product's start-up plus a full answer, and the whole conversation is re-sent every turn with no prompt caching across turns, so a long session costs full input every step. A deployment with a key should still prefer a keyed route; this one exists for the host that has none.

**The product's envelope.** The system prompt the model actually reads is the harness prompt inside a wrapper this package cannot see or record. Prompt-sensitive behavior — a system-prompt change that a snapshot would pin on a keyed route — is only partly accounted for here.

**Quota.** The queries spend the operator's subscription, and the product reports rate-limit state this route does not yet surface as seam usage. A run that exhausts the subscription fails as a product error the harness retries under the normal policy.

**Turn-bound brittleness.** The bound is two assistant messages. A product-side structured-output retry would exceed it and surface as a failed query; if that proves common the bound is the field to revisit, not the design.
