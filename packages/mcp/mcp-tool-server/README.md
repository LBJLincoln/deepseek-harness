# @deepseek-ai/dsh-mcp-tool-server

English | [中文](README.zh.md)

Serves ONE harness agent's own tool registry to an external agent as a [Model Context Protocol](https://modelcontextprotocol.io/) server, and executes every call it receives through `ctx.tools.execute()` on that agent. It is the inverse of [`dsh-mcp-client`](../mcp-client/README.md), which registers a foreign server's tools on `ctx.tools`: here a foreign model reaches the harness's tools instead, so approval, the registry guards, the filesystem policy each tool dispatches, the around-dispatch wrappers, and the durable `tool/call`/`tool/result` pair all apply to work a model outside this process asked for.

The [external-agent bridge Agent Note](../../../.agents/notes/proposed/architecture/2026-09-06-external-agent-bridge.md) owns the design rationale. Its first consumer is [`dsh-subagent-claude-code`](../../subagent/subagent-claude-code/README.md) in bridge mode.

## Usage

```yaml
- id: mcp-tool-server
  name: '@deepseek-ai/dsh-mcp-tool-server'
  config:
    serverName: dsh
```

A consumer calls `instance(agent)`, hands the handle's `config` — `{ type: 'sdk', name, instance }`, the in-process server configuration an Agent SDK accepts verbatim — to whatever runs the external model under the handle's `serverName`, and awaits `dispose()` when the run ends. `toolNames` reports what was served, for the consumer's own record of the run.

## Config

| Key | Default | Meaning |
|---|---|---|
| `serverName` | `dsh` | MCP namespace a served run answers under when its request omits one. Matches `[A-Za-z0-9_-]{1,32}`, because the consuming client qualifies every served tool as `mcp__<serverName>__<tool>`. |

`instance(agent, request)` takes the same namespace per run; `resolve(request)` is the one place that defaults it, and a namespace outside the pattern is refused there rather than at the first tool call.

## The served run is one turn

`tool/call` and `tool/result` are step-scoped events: the [session invariant](../../core/session/README.md) requires each to name the open turn and step. A handle therefore owns exactly one turn of the served agent's session — creation appends `turn/start` and `step/start`, `dispose()` appends `step/end` and `turn/end` — which is what makes an external agent's calls durable at all. It is also the honest record: an external agent's run IS one turn of the harness session that authorized it.

That holds because the served agent is a child created for one run and driven by nobody else. Serving an agent whose session already has a turn open is refused at `instance()`, as is a second live run on one agent. Plugin disposal releases every run the service still owns, so a disposed composition leaves no open turn behind.

## What a served call actually does

The tool list is the agent's own registry view (`ctx.tools.schemas(agent)`), snapshotted at `instance()`: it is what the external model plans against and what a consumer's durable record names, so a set that changed underneath it would make both wrong. Names are served verbatim; the `mcp__<serverName>__` qualification is the consuming client's.

A `tools/call` appends `tool/call`, awaits `ctx.tools.execute({ callId, name, arguments, agent, signal })`, appends `tool/result` citing that call, and returns the executor's rendered content. A name outside the served snapshot is refused, and would still fail `UNKNOWN_TOOL` at the executor if it were reached: the list is presentation, the executor is the authority.

## Model Experience

### The served tool list

#### What the model sees

The external model sees one MCP tool per tool the served agent sees, with the harness description and JSON Schema verbatim. It sees no harness prompt, no persona, and no session history — the served surface is tools and nothing else.

#### Token effect

The external product pays for those schemas in its own context. Nothing is added to any harness model's context.

#### KV Cache effect

Independent of every harness request cache. The snapshot is fixed for the life of the run, so the external product's own prefix stays stable across its turns.

### The result of a served call

#### What the model sees

The tool's model-facing content, flattened to one text payload — the same projection a harness model would receive. A non-text block is named rather than dropped, and an executor failure (a denial, a guard, a tool error) arrives as an MCP error result carrying that message.

#### Token effect

Paid in the external product's context. The harness session records the same content durably; because the `tool/*` pair is log-only for that agent — it drives no model there — it enters no harness request.

#### KV Cache effect

Append-only in the served agent's log, and unrelated to any harness request prefix.

## Known Limitations and Deferred Work

- **No HTTP face yet** — `serve(agent)`, the same server over the SDK's Streamable HTTP transport on a loopback port with a per-run bearer token, is what an external agent that takes an MCP endpoint rather than an in-process instance needs (Codex, ACP). It needs a listener, a token comparison, per-run transport bookkeeping, and its own denial tests, none of it shared with the in-process face, so it waits for the consumer that requires it.
- **The tool set is a snapshot** — a tool registered, unregistered, or restricted after `instance()` does not reach the running external model, and no `tools/list_changed` notification is sent.
- **No MCP resources, prompts, or completions** — the server declares the `tools` capability only; a client asking for anything else gets the SDK's unsupported-method error.
- **One run per agent** — concurrent served runs on one agent are refused rather than multiplexed, because they would share one turn.
- **Cancellation is the client's** — a served call follows the MCP request's own signal; there is no way to cancel one run's outstanding calls except by disposing the handle, which the consumer owns.
