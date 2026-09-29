# Agent Note: The external-agent bridge

Status: implemented

English | [中文](2026-09-06-external-agent-bridge.zh.md)

## Problem

Without bridge mode, [`dsh-subagent-claude-code`](../../../../packages/subagent/subagent-claude-code/README.md) starts one Claude Code run through the pinned official Agent SDK in the delegating Session's workspace and returns only the final answer. Every operation the external agent performs in between belongs to that product: its own tool stack reads and writes the workspace directly, and nothing it does passes the harness's [read barrier](../../proposed/architecture/2026-09-05-read-barrier.md), the [filesystem policy](../../../../packages/fs/fs/README.md), the [approval seam](../../../../packages/interaction/user-approval/README.md), the [budget policy](../../proposed/architecture/2026-09-05-budget-policy.md), or the session log. The provider's README states this as a limitation ("Final text only outside bridge mode — without `harnessTools`, reasoning, intermediate messages, tool traffic, usage, stderr, and workspace diffs remain product-local"), and the read-barrier note states its consequence: an out-of-process provider can only enforce by refusing to start, because no fence this process installs reaches a foreign agent's reads.

That is the whole cost of the black box. A delegation whose child edits files under a policy the harness never applied leaves the parent's session log describing a result it cannot reconstruct, which is exactly what **model-visible ⟺ logged** forbids. The [read-barrier note](../../proposed/architecture/2026-09-05-read-barrier.md) records the same arrangement from the other side: the four out-of-process providers "launch a foreign agent with its own tool stack and no harness policy", so an `implementer` session refuses them entirely above the `none` isolation claim rather than confining them.

The inverse direction already exists. [`dsh-mcp-client`](../../../../packages/mcp/mcp-client/README.md) registers an external MCP server's tools on `ctx.tools` under `mcp__<server>__<name>`, so a foreign capability reaches the harness model through the harness's own registry, policy, and log. Nothing ran the arrow the other way: the harness had no way to hand its own tool set to a foreign model.

## Decision

The harness tool registry is served to the external agent as an MCP server, and the agent gets nothing else. The external product keeps its model, its prompt assembly, and its loop; the harness keeps every operation those produce.

### `@deepseek-ai/dsh-mcp-tool-server` — the Service Definition and its one provider

The package at `packages/mcp/mcp-tool-server/` registers `ctx.mcpToolServer`. It builds, for ONE harness agent, an official [`@modelcontextprotocol/sdk`](../../../../packages/mcp/mcp-tool-server/README.md) `McpServer` whose tool list is exactly the tools that agent sees through `ctx.tools`, and whose call handler executes each call through `ctx.tools.execute()` on that agent. It is the mirror of `dsh-mcp-client`: tools are served under their harness names, and the consuming client qualifies them as `mcp__<server>__<name>`, the same public naming read in the opposite direction.

`instance(agent, request)` returns an `McpToolServerHandle` carrying `serverName`, `serves` (the agent), `config` (the in-process server configuration the Agent SDK accepts, `{ type: 'sdk', name, instance }`), `toolNames` (the snapshot of exposed tool names), and `dispose()`. Tool identity is snapshotted at creation rather than tracked live: the run's tool surface is what the external model was told about in its first `tools/list`, and a set that changed underneath it would make the durable `bridge/start` record wrong.

The handler is where the harness's authority actually applies. It appends `tool/call`, awaits `ctx.tools.execute({ callId, name, arguments, agent, signal })`, appends `tool/result`, and returns the executor's rendered content as the MCP result. That one call carries the whole pipeline: `tools/pre-execute` (approval, permission, plan mode), the registry guards (the read barrier's authority guard among them), `tools/execute` wrappers (tool-call timeout), the fs policy the tool itself dispatches, `tools/post-execute`, and the definition-owned content projection. A tool the agent's scope does not see is not served, and the server refuses a call that names one; it would still fail `UNKNOWN_TOOL` at the executor if the call reached it. The tool list is presentation and the executor is the authority: every other denial (approval, permission, guards) is made in the operation that would run the call.

**The run is one turn of the child's session.** `tool/call` and `tool/result` are step-scoped events: the [session invariant](../../../../packages/core/session/src/invariant.ts) requires each to name the open turn and step. The handle therefore owns exactly one turn: creation appends `turn/start` and `step/start`, disposal appends `step/end` and `turn/end`. The agent this serves is a child created for one bridge run and driven by nobody else, so no loop-owned turn can collide with it; `serves` on the handle names the agent, and a second concurrent handle on one agent, or a handle on an agent whose session already has a turn open, is refused at creation. Disposing the plugin releases every run the service still owns. This is the only structure under which the executor's calls are durable at all, and it is also the honest one: an external agent's run IS one turn of the harness session that authorized it.

`serve(agent, options)` — the same server over the SDK's Streamable HTTP transport on a loopback port with a per-run bearer token, for the Codex and ACP providers, which take an MCP endpoint rather than an in-process instance — is **not shipped**. It needs an HTTP listener, a token comparison, per-session transport bookkeeping, and its own denial tests; none of that is shared with the in-process face, and the bridge's first consumer does not use it. The package README carries it under Known Limitations.

Disposal closes the transport, closes the turn, and makes every later call fail: a handler that ran after the turn closed would append a step-scoped event outside its step.

### The seam capability: `harnessTools`

`SubagentCapabilities` carries `harnessTools`, and `SubagentStartRequest` carries `harnessTools?: { only: true }`. The service rejects the request on a provider without the capability with the existing `UNSUPPORTED_CAPABILITY` error, through the same capability check as `outputSchema` — the same "fail loud, no silent degradation" rule, checked before `start` runs.

The option is an object rather than a boolean because `only: true` is the semantics, not a flag: when it is requested, the child model's tool surface IS the harness tool set of a child harness agent the provider creates under the parent's lineage, **and nothing else**. The provider composes that child the way the in-process drivers do — the parent's preset join, the delegation-scope statement, the delegated policy overrides, the resolved depth, the parent's cwd — and its session is the durable record of the run. The composition carries no per-child persona or tool filter: `subagent-claude-code` advertises neither `toolFilter` nor `persona`, so the service rejects a request naming either, in both modes, because capability flags are per provider rather than per mode. A later member of the object (a partial surface, a named subset) would be a widening rather than a redefinition.

### `subagent-claude-code` in bridge mode

With `harnessTools` absent the provider runs its black-box mode, down to the SDK options: bridge is one added mode, not a replacement.

With `harnessTools` requested it creates the child harness agent and session first, attaches `mcpToolServer.instance(child)` as the SDK server named `dsh`, and pins the external agent's surface shut:

| Option | Value | Why |
|---|---|---|
| `tools` | `[]` | No built-in tool of the product's own. |
| `mcpServers` | `{ dsh: <instance> }` | The harness registry, in process. |
| `allowedTools` | `['mcp__dsh__*']` | Harness tools run without a product-side prompt. |
| `canUseTool` | denies every name outside `mcp__dsh__` | The enforcement. `allowedTools` is a prompt-suppression list, not a fence. |
| `strictMcpConfig` | `true` | No MCP server from the workspace, user settings, or plugins. |
| `settingSources` | `[]` | No project settings, hooks, CLAUDE.md, or agent frontmatter. |
| `persistSession` | `false` | Unchanged from the black-box mode. |
| `maxTurns` | from `agentOptions` when present | The caller's turn ceiling reaches the external loop. |

`canUseTool` is what makes the surface a fence rather than a prompt: `tools: []` and `allowedTools` decide what the model is TOLD about, and a model that names something else anyway is denied by the callback in the operation that would run it.

The provider exports `BRIDGE_TOOL_PREFIX` (`mcp__dsh__`) and `BRIDGE_TOOL_DENIAL`, the message every denied name receives. A composition without `dsh-mcp-tool-server` is refused at start, before any agent is created, with a `SubagentError` whose code is `BRIDGE_UNAVAILABLE`, exported as `SUBAGENT_BRIDGE_UNAVAILABLE`.

The SDK message stream folds into the child session as three package-owned log-only events declared by `SessionEventMap` merging in `subagent-claude-code/src/types.ts`:

- `bridge/start { provider, tools }` — one per run, naming the provider and the exact tool names served, each with the `mcp__dsh__` prefix the external model sees.
- `bridge/assistant { text, usage? }` — one per assistant message, text blocks only. Tool calls are not repeated here: the executor already logged each as the `tool/call`/`tool/result` pair, and a second copy would be a second source for one fact.
- `bridge/end { stopReason, usage?, model?, costUsd? }` — one per run, carrying the seam's own stop reason and the model, usage, and cost the product reported when it reported any.

They are log-only: `deriveMessages()` ignores them, so the external model's text never re-enters any harness model's context. The final answer still returns through the existing `SubagentResult` contract, unchanged.

### The black-box mode's own permission policy

Bridge mode removes the product's permission question by answering every tool call at the harness executor. The black-box mode still has it, and under the host's native settings the product's default mode prompts before a file write — so an unattended black-box child reports that it lacks permission instead of doing the work. Two `subagent-claude-code` config fields make that deployable: `permissionMode`, one of the pinned SDK's values, passed in BOTH modes and absent by default; and `allowedTools`, a black-box-only auto-approval list, because bridge mode's allowlist and denial callback are the fence and a deployment list must not widen them. `bypassPermissions` additionally sets the SDK's `allowDangerouslySkipPermissions`, since a deployment naming that mode in `cordis.yml` IS the intent that flag asks for.

An unattended implementer at `isolation: none` therefore runs at `acceptEdits` or `bypassPermissions` — it hands the product's own confinement away, which is exactly the confinement bridge mode replaces with the harness's.

### What bridge mode does and does not change about the read barrier

The refusal is unchanged by bridge mode: `assertOutOfProcessAllowed` runs first in both modes, so an `implementer` session under a `process` or `host` claim is refused whether or not it asked for harness tools.

Bridge mode is nonetheless the precondition for relaxing it. Under `harnessTools: { only: true }` every read the external model performs is a `read` or `grep` through this process's executor, where `fs/read-intent` and the barrier's tool guard already deny — so the child could register `enforce('subagent')` and the census could record `denied-at-executor` for it, which is the evidence `process` isolation asks for.

What still prevents the relaxation is the foreign process itself. The CLI runs unconfined: it is not wrapped by `ctx.sandbox.confine()`, it inherits a working directory and a filesystem, and nothing stops it opening a denied path with its own runtime rather than through an MCP call — the harness fences the tools it serves, not the process it started. Closing that needs the process under the sandbox seam with `deniedReadRoots` expressed by the backend, which is separate work against `dsh-subprocess` and `dsh-sandbox-local`, not a consequence of bridge mode.

## Alternatives considered

**Proxy the product's own tools instead of replacing them.** Intercepting Read/Write/Bash through `canUseTool` and re-running them through the harness would keep the product's prompt and tool descriptions intact. It fails at the operation that matters: `canUseTool` can only allow or deny, so an allowed call still runs the product's implementation with the product's policy, and a denied one leaves the model with no route to the work. Serving the harness's own tools is the only arrangement where the call the model makes IS the call the harness executes.

**Give the external agent an MCP server over stdio or HTTP from the start.** An out-of-process transport is what Codex and ACP will need, and it is the general answer. It is also strictly more surface — a listener, a token, transport lifecycle — for a first consumer that accepts an in-process instance directly. The in-process face shipped first and the HTTP face is named as deferred work rather than half-built.

**Log the external agent's tool traffic by parsing the SDK message stream.** The stream carries `tool_use` blocks, so a provider could record them without executing anything. That records what the product did without authorizing it: no approval, no fs policy, no guard, and no way to deny. The bridge exists precisely because observation is not authority.

**Reuse `tool/code-dispatch` instead of `tool/call`/`tool/result`.** Those events are not step-scoped, so they would need no turn. They are also the `run_code` transport's own vocabulary, carrying a `rootCallId` and a parent call that a bridged call does not have, and a UI that renders them would present harness tool calls as Code Mode sub-dispatches. The bridged call is an ordinary tool call by an agent, so it takes the ordinary pair and the turn that pair requires.

**Let the child harness agent's own loop drive the turn.** A turn opened by the loop would need a model request, and the whole point of bridge mode is that the model is external. The handle owning one turn keeps the log well-formed without inventing a request that never happened.

**Track the tool set live and send `tools/list_changed`.** MCP supports it and `dsh-mcp-client` consumes it in the other direction. Here the set is the run's own contract: it is recorded in `bridge/start`, it is what the external model planned against, and a mid-run change would leave that record describing a surface the model never had.

**A boolean `harnessTools: true`.** It reads as "also expose harness tools", which is exactly the thing this capability does not mean. `{ only: true }` states the exclusivity at the call site and leaves room for a non-exclusive member later.

## Consequences

Every tool call a bridged external agent makes is an ordinary harness execution on the child agent: authorized by the approval seam, filtered by the registry guards, bounded by the tool-call timeout, and recorded as the usual `tool/call`/`tool/result` pair. The child's session is a reconstructable record of the run, which restores **model-visible ⟺ logged** for the delegation. Black-box mode is unchanged.

The turn the handle opens is a durable structure written by something other than the agent loop. It is correct while the served agent is the bridge's own child, and it would desynchronize from a live loop's turn counter if a composition handed `instance()` an agent that something else drives. The handle names the agent it serves, and the service refuses a second concurrent handle on it and an agent whose session already has a turn open; a deployment that violates the remaining precondition gets a loud invariant failure on the child's log rather than a silent one.

The external process stays unconfined. Bridge mode fences the tools, not the process, so a product that reads a file with its own runtime rather than through an MCP call is outside everything bridge mode adds — which is why the read-barrier refusal stays exactly where it is.

The child session records the external agent's text but not its reasoning or its system prompt. `bridge/assistant` carries what the SDK reports as assistant text; the product's hidden thinking, its assembled prompt, and its own context are not observable from this process, so a reader of the child log sees what the external agent said and did, never why.

Tool descriptions written for the harness's own model reach a foreign one. They are model-facing prose tuned to this deployment's prompt, and a different model may read them differently; the bridge changes neither the descriptions nor the schemas, so the mismatch is visible as ordinary tool-use error rather than as silent divergence.

## Testing

- The service's capability check refuses a request carrying `harnessTools` on a provider whose `harnessTools` capability is false with `SubagentError('UNSUPPORTED_CAPABILITY')` before `start` runs. It is the same check the capability table in `packages/subagent/subagent/tests/service.spec.ts` exercises for the other gated options; that table does not list `harnessTools`.
- `packages/mcp/mcp-tool-server/tests/agent-bridge.e2e.ts` boots `examples/headless-agent/tests/fixtures/agent-bridge/` through the Loader. An official MCP `Client` over an in-memory transport lists exactly the tools the served agent sees, calls `read`, and is refused for a name outside the agent's registry; the agent's session log is `turn/start`, `step/start`, `tool/call`, `tool/result`, `step/end`, `turn/end`, with the pair inside the one open turn and step.
- `packages/mcp/mcp-tool-server/tests/mcp-tool-server.spec.ts` covers the executor's denial arriving as an MCP error result, the refusal of a name outside the snapshot, and a disposed run refusing every request.
- `packages/subagent/subagent-claude-code/tests/bridge.spec.ts` pins the SDK options bridge mode passes (`tools: []`, `allowedTools`, `strictMcpConfig`, `settingSources`, `maxTurns`), proves `canUseTool` allows `mcp__dsh__` names and denies others, and asserts the child's log holds `bridge/start`, `bridge/assistant`, `bridge/end` in that order. It also asserts a start without `harnessTools` passes none of those options.
- The black-box provider specs in `packages/subagent/subagent-claude-code/tests/subagent-claude-code.spec.ts` run against the unchanged black-box mode.
