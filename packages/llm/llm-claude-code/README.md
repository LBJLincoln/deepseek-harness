# @deepseek-ai/dsh-llm-claude-code

English | [中文](README.zh.md)

Serves the harness LLM seam from a Claude Code installation the operator has already authenticated, so a host with no API key can still run every harness role — implementer agents, validators, judges, program departments, workflow workers, in-process subagents — on that subscription.

Every `generate()` on this route is one stateless query to that installation through the official Agent SDK. The harness system prompt becomes the query's system prompt, the conversation and the harness tool definitions become the query's prompt text, and the answer comes back as a structured output this package parses into the seam's `StreamChunk` protocol. The product runs no tool of its own and reads no workspace, so every tool call returns to the harness agent loop and executes under the harness's own tools, session log, read barrier, budget policy, and approvals.

The package root exposes the Cordis plugin contract, `ClaudeCodeAdapter`, and the request/response helpers those two use; the SDK is a runtime dependency of this package, not of the seam.

## Config

```yaml
- id: llm-claude-code
  name: '@deepseek-ai/dsh-llm-claude-code'
  config:
    provider: claude-code    # required; the route registered on ctx.llm
    displayName: Claude Code # optional; the route name when omitted
    models:                  # required; a request naming any other model fails with UNKNOWN_MODEL
      - id: default          # the id harness requests select
        name: Claude Code default
        contextWindow: 200000 # optional; what the token meter and compaction threshold read
      # productModel names what the installation is asked to run; omit it and
      # the installation runs whatever it is configured to run.
      - id: fast
        productModel: <a model id this installation accepts>
    env:                     # optional; explicit entries over the scrubbed parent environment
      CLAUDE_AGENT_SDK_CLIENT_APP: deepseek-harness/1
    effort: high             # optional; low | medium | high | xhigh | max
    thinking:                # optional; adaptive | enabled (with budgetTokens) | disabled
      type: adaptive
    queryTimeoutMs: 300000   # optional; maximum idle interval between messages of one query
    disposeGraceMs: 3000     # optional; CLI process-tree termination grace
    retryPolicy:             # optional; omission uses bounded normal defaults
      mode: normal
```

`provider` is required and has no default: the route name is the composition's statement of which seam key this installation answers on, and two installations configured side by side must be able to name themselves differently.

`models` is required and has no default either. The harness cannot interrogate an installation for the models its subscription entitles, so the catalog is operator configuration. `ctx.llm.listModels(provider)` returns these entries, `ctx.llm.resolveModelInfo(provider, id)` returns the exact entry with its `contextWindow`, and — unlike the keyed adapters, whose catalogs are advisory — a request naming an unlisted model fails with `LlmError('UNKNOWN_MODEL')` before any query starts. Each entry declares `inputModalities: ['text']`, so image content is refused as a declared negative capability. An entry's optional `productModel` is passed to the installation as the product's `model` option; omitting it leaves that option off, which is the configuration a deployment wants when the installation's own default is the intended model.

`effort` and `thinking` pass straight through to the query for every request on this route. They are route-level rather than per-request because this route publishes no reasoning efforts: a request that sets `GenerateOptions.reasoningEffort` fails with `UNSUPPORTED_REASONING_EFFORT` at the seam.

`queryTimeoutMs` bounds the gap between messages of one query, not the answer's duration. The query asks for partial assistant events, which arrive while the installation is still working, so the watchdog rearms on evidence of progress and only expires on a silent installation. Expiry throws `LlmError('TIMEOUT')`; an earlier caller abort throws `ABORTED`.

## How a request is rendered

The rendering is a pure function of the request the seam hands over, and that request is itself derived from the session log, so everything this package sends is reconstructable from the log. Two things enter the query:

- **The system prompt.** `GenerateOptions.system` becomes the query's custom system prompt, replacing the product's own preset rather than appending to it. A request with no system prompt sends an empty one, which still replaces the preset.
- **The prompt text.** One reading-guide line, then the tool section when the request carries tools, then the whole conversation in log order. Each element is framed by tags prefixed `dsh-`: `<dsh-user>`, `<dsh-assistant>` with a nested `<dsh-tool-call id name>` per requested call, `<dsh-tool-result id status>` per result, and `<dsh-system>` for a system message that arrived inside the conversation. Attribute values are escaped; when any rendered content itself contains the prefix, the whole rendering moves to the first free numbered prefix (`dsh2-`, `dsh3-`, …), so no message can be read as framing.

The query asks for a structured output of `{ content: string, toolCalls: [{ name, arguments }] }`, where `arguments` is the call's JSON object encoded as a JSON string — the form the seam carries end to end. Built-in tools, MCP servers, filesystem settings, and session persistence are all switched off (`tools: []`, `mcpServers: {}`, `strictMcpConfig: true`, `settingSources: []`, `persistSession: false`), and the permission mode never prompts and denies anything not pre-approved. The harness cancellation signal drives the SDK's abort controller, and the SDK-spawned CLI is placed under `ctx.subprocess`, which owns its process tree and termination ladder.

The query's turn bound is two assistant messages. Offering no tools is what makes one `generate()` one model response; the bound is two rather than one because the product's structured-output delivery costs an assistant message of its own, so a reply that says anything before it needs both.

## What comes back

`structured_output` becomes the chunk stream: the visible text as one text block when it is non-empty, then one tool-call block per returned call, then usage, then the finish (`tool-calls` when the answer requested any, `stop` otherwise). Call ids are minted per response as `<result uuid>-<position>`, so they are unique across the session and stable for the tool result that answers them. Token counts map straight across — the product already reports uncached input separately from cache reads and writes, which is the seam's own disjoint convention.

A missing or unreadable structured output is a provider failure, never an empty answer: `MALFORMED_RESPONSE`. An answer with neither text nor tool calls is `EMPTY_RESPONSE`, which the default retry policy retries.

## Errors

`UNKNOWN_MODEL` for a model the catalog does not declare, and `UNSUPPORTED_CONTENT` for image content, both before any query. `MISSING_EXECUTABLE` when the host has no `claude` on the subprocess seam's PATH. `TIMEOUT` and `ABORTED` for idle expiry and caller cancellation. `MALFORMED_RESPONSE` and `EMPTY_RESPONSE` for an unusable answer, and `STREAM_CLOSED` for a query that ended without publishing a result. A failed product result is classified from every code, terminal reason, stop reason, and message it carried: `CONTEXT_WINDOW_EXCEEDED` and `QUOTA` through the seam's shared classifiers, then `MAX_TURNS`, `QUOTA`, `MALFORMED_RESPONSE`, or `PRODUCT_ERROR` by result subtype. A failure the SDK raises by throwing rather than by publishing a result becomes `TRANSPORT` with the rendered cause chain in its message.

## Model Experience

### The query prompt

#### What the model sees

The installation's model reads the harness system prompt verbatim as its system prompt — inside an envelope of the product's own that this package neither authors nor can inspect, the one model-visible input here that the session log does not reconstruct — then a prompt text carrying the reading guide, the tool section, and the conversation. Named placeholders below stand for the request's own data: `{ns}` is the tag prefix (`dsh` unless content collides with it), `{tool name}`, `{tool description}`, and `{tool schema}` come from `GenerateOptions.tools`, and message text, call ids, and arguments come from the conversation.

##### Verbatim guide and tool section

```markdown
Answer the last turn of the conversation below. Elements tagged `<{ns}-…>` are the harness's framing; everything between them is the conversation.
<{ns}-tools>
The harness runs these tools, not you. Ask for a call by putting it in `toolCalls`; its result arrives in the next request.
<{ns}-tool name="{tool name}">
{tool description}
Arguments (JSON Schema):
{tool schema}
</{ns}-tool>
</{ns}-tools>
```

#### Token effect

The conversation and tool definitions are rendered on every request, so input grows with history exactly as it does on a keyed route, plus the fixed framing tags and the two guide sentences. The structured-output schema and the product's own envelope add a further fixed amount this package does not measure.

#### KV Cache effect

Each query is independent: the installation is asked for one stateless answer with no persisted session, so nothing this route sends reuses a prefix across turns. Cache reads and writes the product reports are passed through to the seam's usage, but this package makes no claim about which prefix produced them.

### The structured answer

#### What the model sees

Nothing this package adds. The parsed text and tool calls become harness content blocks the agent loop logs and assembles, and the tool results the harness produces return in the next request's conversation.

#### Token effect

Generated tokens follow the route's configured effort and thinking policy; only the blocks the loop retains affect later input.

#### KV Cache effect

Retained response blocks append to the next request's rendered conversation. Because each query is stateless, that growth changes the next prompt rather than extending a reusable prefix.

## Known Limitations and Deferred Work

- **No prompt caching across turns** — one `generate()` is one stateless query, so the whole conversation is re-sent and re-read every turn. A conversation that a keyed route would serve mostly from cache costs full input here, and latency per turn is the product's own start-up plus answer time.
- **The product's system-prompt envelope is not reconstructable from the session log** — the harness authors the system prompt, but the installation wraps it with text this package neither writes nor sees, so `request/header` records everything except that wrapper.
- **`maxTokens`, `temperature`, `topP`, `seed`, and `stop` are dropped** — the product's query options carry no equivalent, and the seam's contract is that an adapter whose wire has no equivalent drops the field.
- **No reasoning efforts are published** — `effort` and `thinking` are route-level configuration, so `agent/request` cannot vary reasoning per step the way it can on the keyed routes.
- **A product-side structured-output retry exceeds the turn bound** — the bound is two assistant messages, which covers one answer and its delivery; a retry surfaces as a failed query the harness retries as a whole request.
- **No settings-seam hot reload** — route facts resolve once at load, unlike the keyed adapters, which re-read a `ctx.settings` section per request. Adding it needs a settings namespace and the atomic route replacement the keyed adapters use.
