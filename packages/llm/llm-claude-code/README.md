# @deepseek-ai/dsh-llm-claude-code

English | [中文](README.zh.md)

Serves the harness LLM seam from a Claude Code installation the operator has already authenticated, so a host with no API key can still run every harness role — implementer agents, validators, judges, program departments, workflow workers, in-process subagents — on that subscription.

Every `generate()` on this route is one query to that installation through the official Agent SDK. The harness system prompt becomes the query's system prompt, the conversation becomes the query's prompt text, and the harness tools become native tools of an in-process MCP server the query mounts — so the model plans with the tool machinery it was trained on. The reply's text and tool calls become the seam's `StreamChunk` protocol. The product runs no tool of its own and reads no workspace, so every tool call returns to the harness agent loop and executes under the harness's own tools, session log, read barrier, budget policy, and approvals.

By default the steps of one harness session share one product session: each step resumes it with the newest turn alone, so the installation reads the conversation prefix from its prompt cache instead of being sent it again. The harness still owns the loop — one `generate()` is still one model response, and the harness still runs every tool call.

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
    sessionContinuity: per-session  # optional; per-session | per-query
    resumableSessionLimit: 64       # optional; product sessions kept resumable at once
    retryPolicy:             # optional; omission uses bounded normal defaults
      mode: normal
```

`provider` is required and has no default: the route name is the composition's statement of which seam key this installation answers on, and two installations configured side by side must be able to name themselves differently.

`models` is required and has no default either. The harness cannot interrogate an installation for the models its subscription entitles, so the catalog is operator configuration. `ctx.llm.listModels(provider)` returns these entries, `ctx.llm.resolveModelInfo(provider, id)` returns the exact entry with its `contextWindow`, and — unlike the keyed adapters, whose catalogs are advisory — a request naming an unlisted model fails with `LlmError('UNKNOWN_MODEL')` before any query starts. Each entry declares `inputModalities: ['text']`, so image content is refused as a declared negative capability. An entry's optional `productModel` is passed to the installation as the product's `model` option; omitting it leaves that option off, which is the configuration a deployment wants when the installation's own default is the intended model.

`effort` and `thinking` pass straight through to the query for every request on this route. They are route-level rather than per-request because this route publishes no reasoning efforts: a request that sets `GenerateOptions.reasoningEffort` fails with `UNSUPPORTED_REASONING_EFFORT` at the seam.

`queryTimeoutMs` bounds the gap between messages of one query, not the answer's duration. The query asks for partial assistant events, which arrive while the installation is still working, so the watchdog rearms on evidence of progress and only expires on a silent installation. Expiry throws `LlmError('TIMEOUT')`; an earlier caller abort throws `ABORTED`.

`sessionContinuity` chooses what a step sends. Under `per-session`, the default, the steps of one harness session share one product session and each step sends only the turn that session does not yet hold, so the installation reads the prefix from its prompt cache. Under `per-query` each step sends the whole conversation to a query of its own, which persists nothing and reads nothing back; a ten-step probe measured 114,439 cache-write tokens and no cache read that way, against 14,606 written and 69,212 read when resuming. Take `per-query` when an installation's resume misbehaves, or when writing a transcript to the operator's configuration directory is unacceptable.

`resumableSessionLimit` bounds how many product sessions the route keeps resumable at once. It is a cleanup policy as much as a memory bound: evicting the least recently used one deletes its transcript, which is what a harness process whose sessions never end relies on. The default of 64 leaves room for several concurrent runs of the widest fan-out a current consumer has — the Proving Ground bench's 18 cells.

## How a request is rendered

The rendering is a pure function of the request the seam hands over, and that request is itself derived from the session log, so everything this package sends is reconstructable from the log. Three things enter the query:

- **The system prompt.** `GenerateOptions.system` becomes the query's custom system prompt, replacing the product's own preset rather than appending to it. A request with no system prompt sends an empty one, which still replaces the preset.
- **The prompt text.** One reading-guide line, then the whole conversation in log order. Each element is framed by tags prefixed `dsh-`: `<dsh-user>`, `<dsh-assistant>` with a nested `<dsh-tool-call id name>` per requested call, `<dsh-tool-result id status>` per result, and `<dsh-system>` for a system message that arrived inside the conversation. Attribute values are escaped; when any rendered content itself contains the prefix, the whole rendering moves to the first free numbered prefix (`dsh2-`, `dsh3-`, …), so no message can be read as framing.
- **The tools.** `GenerateOptions.tools` become the tools of an in-process MCP server named `dsh`, served through the low-level MCP handlers so each harness description and JSON Schema reaches the model verbatim — the same bytes `request/header` recorded. The query mounts that server and allows exactly the names it serves, qualified `mcp__dsh__<tool>`. A request that offers no tools builds no server and allows nothing.

That server executes nothing. Its handler answers every call with one fixed sentence, because the product runs the call it just asked for before the query ends; the harness runs the real call afterwards, exactly as it does for every other provider. The product's own tools stay off (`tools: []`), as do filesystem settings (`strictMcpConfig: true`, `settingSources: []`), and the permission mode never prompts and denies anything not pre-approved. The harness cancellation signal drives the SDK's abort controller, and the SDK-spawned CLI is placed under `ctx.subprocess`, which owns its process tree and termination ladder.

The query's turn bound is one assistant message, which is what makes one `generate()` one model response. A reply that calls tools reaches that bound — the product answers, runs the offered call, and has no turn left — and the SDK reports it as `error_max_turns` carrying the reply. That is this route's normal terminal for a tool-calling answer, not a failure.

## How a step reaches the installation

A step under `per-query` sends the whole prompt above to a query that persists nothing. A step under `per-session` sends it only when no product session holds this conversation yet; otherwise it resumes the one that does and sends the framed elements after the product's own answer — the same tags, without the reading guide and without the `<{ns}-conversation>` wrapper, because the conversation they belong to is already open in that session.

Resuming is only correct while the product session holds exactly the conversation the harness log holds, and the route proves that per step. With each product session it records how many of the request's messages that session was sent, and a SHA-256 digest over everything it sent for them: the system prompt, the offered tool definitions, the model id, and those messages' framed elements. The next step recomputes the digest from its own request and resumes only when the request grew past the record, carries the product's answer as the message right after it, carries no further assistant message the product did not write, and matches the digest. Compaction, a spliced message, a changed system prompt or tool set, and a rewound retry each fail one of those and run a fresh query with a new product session. A request with no `sessionId` — a hand-built one-shot — has no conversation to continue and is always fresh.

Which path a step took is on the answer: the finish chunk carries `{ continuity, productSessionId, fallback? }` as its adapter replay state, which the seam logs verbatim as an `assistant/chunk` and again on the assembled `assistant/message`. `fallback` names why a `per-session` route still ran fresh — `no-session-id`, `no-record`, `history-rewound`, `answer-missing`, or `prefix-changed`.

Resuming needs `persistSession: true`, so the installation writes the product session's transcript under the operator's own configuration directory. The route deletes each transcript it created when its record leaves the table: replaced after a mismatch, evicted past `resumableSessionLimit`, dropped after a step that delivered no answer, or released when the plugin unloads. Transcripts the route did not create are never touched, and a store that refuses a delete leaves one file behind rather than failing the step.

## What comes back

The query's assistant messages become the chunk stream: their text blocks joined as one text block when non-empty, then one tool-call block per `tool_use` block in published order, then usage, then the finish (`tool-calls` when the reply called any, `stop` otherwise). One API message may arrive as several assistant messages, one per block, so both are read across the whole query. Thinking blocks are ignored. A call's name has the `mcp__dsh__` qualification stripped — a reply that used the bare harness name is accepted too — and its arguments are the API's parsed input re-serialized, the form the seam carries end to end. Call ids are minted per response as `<result uuid>-<position>`, so they are unique across the session and stable for the tool result that answers them. Token counts map straight across — the product already reports uncached input separately from cache reads and writes, which is the seam's own disjoint convention.

A reply that called a name this request did not offer is a provider failure, never a silent drop: `MALFORMED_RESPONSE`. A query whose assistant messages carried neither text nor a call is `EMPTY_RESPONSE`, which the default retry policy retries.

## Errors

`UNKNOWN_MODEL` for a model the catalog does not declare, and `UNSUPPORTED_CONTENT` for image content, both before any query. `MISSING_EXECUTABLE` when the host has no `claude` on the subprocess seam's PATH. `TIMEOUT` and `ABORTED` for idle expiry and caller cancellation. `MALFORMED_RESPONSE` and `EMPTY_RESPONSE` for an unusable reply, and `STREAM_CLOSED` for a query that ended without publishing a result. A result that carries no answer is classified from every code, terminal reason, stop reason, and message it reported: `CONTEXT_WINDOW_EXCEEDED` and `QUOTA` through the seam's shared classifiers, then by result subtype — `MAX_TURNS` for a turn bound reached with no tool call, `QUOTA` for the budget bound, `MALFORMED_RESPONSE` for exhausted structured-output retries, `PRODUCT_ERROR` for a failure during execution, and `TRANSPORT` for a successful result the product itself marked failed, which carries an API failure of its own request and is worth repeating. A failure the SDK raises by throwing rather than by publishing a result becomes `TRANSPORT` with the rendered cause chain in its message; a throw that follows a published result is discarded, because the result is the query's account of itself — except when the harness stopped the query, where `TIMEOUT` and `ABORTED` outrank anything the product published.

## Model Experience

### The query prompt

#### What the model sees

The installation's model reads the harness system prompt verbatim as its system prompt — inside an envelope of the product's own that this package neither authors nor can inspect, the one model-visible input here that the session log does not reconstruct — then the conversation, where `{ns}` below is the tag prefix (`dsh` unless content collides with it) and message text, call ids, and arguments come from the conversation. A fresh step delivers it as one prompt text carrying the reading guide and every element; a resumed step delivers the newest element alone into the transcript the product session already holds, plus the fixed sentence that session recorded as the previous call's tool result before the harness ran the real one — a constant of this package placed where the log's own tool calls put it, superseded by the real result that follows as this step's `<{ns}-tool-result>`. Beside the conversation the model sees the request's harness tools as native tools named `mcp__dsh__<tool>`, each carrying the harness description and JSON Schema unchanged, and asks for a call the way it asks for any tool: one API turn per step, no prompt protocol, and no JSON-string encoding of arguments to satisfy.

##### Verbatim guide

```markdown
Answer the last turn of the conversation below. Elements tagged `<{ns}-…>` are the harness's framing; everything between them is the conversation.
```

#### Token effect

Input grows with history exactly as it does on a keyed route, plus the fixed framing tags and, on a fresh step, the one guide sentence. A resumed step sends only the newest turn's elements, so what this route transmits per step is the turn rather than the conversation; what the model reads is the same either way. The tool schemas are sent as native tool definitions on every request, as they are on a keyed route. The product's own envelope adds a further fixed amount this package does not measure.

#### KV Cache effect

Under `per-session` the conversation is a stable prefix the installation reads back: a ten-step probe conversation reported 69,212 cache-read tokens against 14,606 written, where sending the whole conversation every step reported 114,439 written and none read. Every step that starts a fresh product session — the first of a conversation, and every fallback the `continuity` record names — writes its whole prefix again. Under `per-query` no step reuses a prefix at all. Cache reads and writes the product reports are passed through to the seam's usage unchanged in both modes.

### The reply

#### What the model sees

Nothing this package adds. The reply's text and tool calls become harness content blocks the agent loop logs and assembles, and the tool results the harness produces return in the next request's conversation as `<{ns}-tool-result>` elements.

#### Token effect

Generated tokens follow the route's configured effort and thinking policy; only the blocks the loop retains affect later input.

#### KV Cache effect

Retained response blocks append to the next request's conversation. Under `per-session` the product session already holds the answer it wrote, so that growth extends the reusable prefix rather than changing the prompt; under `per-query` it changes the next prompt and nothing is reused.

## Known Limitations and Deferred Work

- **Each step still pays a fresh process start** — resuming reuses the conversation, not the process. A probe that held one streaming query open across the same ten steps measured the same cache-read share with one process start instead of ten and about 26 percent less wall time, but a held query freezes the system prompt, the mounted tools, and the model at creation while `GenerateOptions` carries them per request ([Agent Note](../../../.agents/notes/proposed/architecture/2026-09-08-claude-code-route-session-continuity.md)).
- **A product session the harness process abandons outlives it** — the route deletes each transcript it created when the record leaves its table, but a process killed between steps leaves one transcript per live conversation in the operator's configuration directory. The route does not sweep that directory for orphans, because a transcript it did not create may be the operator's own work.
- **A resumed conversation carries the queued-call sentence the harness log does not** — the product records the offered server's fixed answer as the previous call's tool result, so a resumed model reads it before the harness's real result. It is a constant inserted at positions the log's tool calls determine, not free text, but it is one model-visible string that is reconstructed from this package rather than read from the log.
- **The product's system-prompt envelope is not reconstructable from the session log** — the harness authors the system prompt, but the installation wraps it with text this package neither writes nor sees, so `request/header` records everything except that wrapper.
- **`maxTokens`, `temperature`, `topP`, `seed`, and `stop` are dropped** — the product's query options carry no equivalent, and the seam's contract is that an adapter whose wire has no equivalent drops the field.
- **No reasoning efforts are published** — `effort` and `thinking` are route-level configuration, so `agent/request` cannot vary reasoning per step the way it can on the keyed routes.
- **The product runs one offered call before the turn bound ends the query** — its handler executes nothing and returns a fixed sentence, but the product still spends the round trip, and a reply that requests several calls has them all answered that way before the query ends.
- **No settings-seam hot reload** — route facts resolve once at load, unlike the keyed adapters, which re-read a `ctx.settings` section per request. Adding it needs a settings namespace and the atomic route replacement the keyed adapters use.
