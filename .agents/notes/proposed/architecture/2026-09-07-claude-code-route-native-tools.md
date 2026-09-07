# Agent Note: native tool use on the Claude Code route

Status: proposed

English | [中文](2026-09-07-claude-code-route-native-tools.zh.md)

## Problem

The [Claude Code route](2026-09-06-llm-claude-code.md) offers the harness tools to the installation as prompt text and asks for the answer as a structured output — `{ content, toolCalls: [{ name, arguments }] }` with `arguments` a JSON string — under a bound of two assistant messages.

A model trained on native tool use does not follow that protocol. Offered tools in prose, it answers with a native `tool_use` block naming one of them; the product replies `No such tool available: bash`, the model tries the same call again, and the second attempt exhausts the turn bound. The SDK then throws `Reached maximum number of turns (2)` *after* publishing the result, so the adapter's catch classifies the throw as `TRANSPORT` and the result's own `error_max_turns` is never read.

The measurements: three probe queries over the same prompt material produced zero usable answers, each ending in that two-call loop; one real bench cell lost 11 of its 12 queries the same way. Adding an explicit instruction that the structured-output tool is the only tool available does make the query succeed, but never in the first assistant message — each such run still spends one API call on the refused native call first — and the smallest model tried broke the protocol twice in one query, first sending `arguments` as an object where the schema demands a string, then sending bytes that did not parse as JSON at all, and failed. Prompt wording cannot restore a protocol the model was trained past.

## Proposal

Offer the harness tools to the product as real tools, and read the answer out of the reply the product already publishes.

Each request's `GenerateOptions.tools` become the tools of an in-process MCP server named `dsh`, built for that request and mounted as the query's only MCP server; the query allows exactly the names it serves, qualified `mcp__dsh__<tool>`, and the product's own tools stay off. A request offering no tools builds no server. The structured-output option and the prompt's tool section are both dropped: the prompt is the reading guide plus the conversation, and nothing in it describes a tool.

The server executes nothing. Its call handler answers one fixed sentence, because the product runs the call it just requested before the query ends; the harness runs the real call afterwards, in the agent loop, exactly as it does for every other provider. That is what keeps this a Service Provider on the LLM seam rather than a nested agent loop — the objection that [the route's own note](2026-09-06-llm-claude-code.md) raised against trampolining, and it still stands: nothing here gives the product a loop, a session, or a second model request.

### Serving the schema verbatim

The tools are served through the low-level MCP request handlers (`ListToolsRequestSchema`, `CallToolRequestSchema`), not the high-level registration, which takes a Zod shape. Harness tool definitions carry JSON Schema, and `request/header` records those exact schemas, so serving them verbatim is what keeps model-visible equal to logged. A Zod round trip would put a converted schema in front of the model and leave the log describing a different one.

### One turn per query

`maxTurns` becomes one. A reply that calls tools reaches that bound — the product answers, runs the offered call against the fixed handler, and has no turn left — and the SDK reports `error_max_turns` carrying the reply. That terminal is this route's normal end for a tool-calling answer, so the adapter delivers the answer when the query published a `tool_use` block and codes `MAX_TURNS` only when it did not. A text-only reply ends the query as `success`.

### Reading the answer

The answer is the query's `assistant` messages in order: text blocks joined become the content, `tool_use` blocks become tool calls with the `mcp__dsh__` qualification stripped (a bare harness name is accepted too), and thinking blocks are ignored. One API message may arrive as several assistant messages, one per block, so both are read across the whole query. Arguments are the API's parsed input re-serialized, which is what every adapter of this seam does when it assembles arguments. A name the request did not offer is `MALFORMED_RESPONSE`; a query with no assistant message at all stays `EMPTY_RESPONSE`.

### Two failures the old classification got wrong

A throw that follows a published result is a second account of one query, and the result is the better one: the adapter keeps the result and discards the throw, and classifies a throw only when no result arrived or when the harness itself stopped the query, where the timeout and cancellation codes outrank anything the product published. A `success` result the product marked `is_error` carries an API failure of the product's own request in `result` (a connection failure, for instance); that text joins the classified detail and the residue is `TRANSPORT`, which the default retry policy retries, rather than the terminal `PRODUCT_ERROR` it was.

## Alternatives considered

**Keep the prompt protocol and instruct harder.** The probe measured it: an explicit "you have exactly one native tool" instruction does produce a structured answer, but only after the model has spent an assistant message on a native call the product refuses. That is one wasted API call per step, a permanently higher turn bound, and a protocol the smallest model broke twice in one query anyway. Native tool use is the interface these models are trained on; matching it costs less than fighting it.

**Raise `maxTurns` so the refusal loop has room to recover.** Tried at four turns: the model repeats the native call and the query still ends without an answer. More turns buy more refused calls, not a different reply, and they widen the window in which the product can act between turns — which this seam must not allow.

**Convert each harness schema to Zod and use the SDK's `createSdkMcpServer` tool helper.** It is the documented path and the probe used it, but the conversion is a lossy step between what `request/header` recorded and what the model reads, and a schema the converter cannot express would have to fail the request. The low-level handlers take JSON Schema directly, so the conversion is unnecessary.

**Reuse `dsh-mcp-tool-server` instead of building a server here.** That package serves one *agent's* registry and executes every call through `ctx.tools.execute()` against a durable turn of that agent's session. This route has no agent and must not execute anything: the harness's own loop runs the call, one step later, with its own logging and approvals. Sharing the package would mean either an executing server this route has to defeat, or a second non-executing mode inside a package whose whole contract is that a served call runs. The `mcp__<serverName>__` qualification the two share is the consuming client's convention, not a shared implementation.

**Let the product execute the calls and report what it did.** Cheaper per step and wrong for the same reason it was wrong before: the harness's read barrier, approvals, budget policy, and `tool/call`/`tool/result` pair are what make a tool result trustworthy, and a route that bypassed them would make the session log an incomplete account of what the agent did.

## Acceptance criteria

- A request that offers tools mounts one MCP server named `dsh`, allows only `mcp__dsh__<tool>`, and serves each harness description and JSON Schema verbatim to a real MCP client over an in-memory transport; a request that offers none builds no server and allows nothing.
- A tool-calling reply that ends the query at the turn bound returns text and tool-call chunks with a `tool-calls` finish; a turn bound with no call still fails `MAX_TURNS`; a throw published after a result does not change either outcome.
- A `success` result the product marked failed maps to a retryable code carrying the product's API failure text.
- Unit specs hold per-file 100% coverage over `src/`, including the served MCP surface, the reply reading, and every result classification.
- The opt-in real-installation e2e (`DSH_E2E_CLAUDE_CODE=1`) offers a `bash` schema over the mounted route and gets back exactly one tool call whose arguments parse as JSON, and the headless-agent case still writes and reads its workspace file through the harness's own tools.
- No keyless snapshot accompanies this change, for the reason [the route's note](2026-09-06-llm-claude-code.md) already records: the snapshot harness replays recorded provider transcripts, and this provider is a local process whose answers are not recorded.

## Risks

**The product still runs the offered call.** The handler executes nothing, but the round trip is spent, and a reply requesting several calls has all of them answered that way before the query ends. It costs latency inside a query that was already seconds long, and it means the product's transcript contains a tool result no model ever reads.

**The turn bound is now the normal terminal for a tool-calling answer.** The route reads a documented error subtype as success, which is correct for this product but brittle: a future product that reports the same terminal differently, or that stops running the offered call, changes what a delivered answer looks like. The classification is one function, and the real-installation e2e is what would catch the change.

**Tool schemas are re-sent every query.** They were prompt text before and are native definitions now, so the token cost is comparable, but it is still paid on every step of a stateless route with no cross-turn caching.

**The evidence is one probe generation.** Four of four probe queries called a tool in their first assistant message, across three models of the installation's family and 5–6 seconds each. That is a small sample against one product version; the route's behavior under a product update is only guaranteed by the opt-in e2e that a maintainer must run.
