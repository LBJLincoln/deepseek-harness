# Agent Note: The external-agent bridge

Status: proposed

English | [中文](2026-09-06-external-agent-bridge.zh.md)

## Problem

[`dsh-subagent-claude-code`](../../../../packages/subagent/subagent-claude-code/README.md) starts one Claude Code run through the pinned official Agent SDK in the delegating Session's workspace and returns only the final answer. Every operation the external agent performs in between belongs to that product: its own tool stack reads and writes the workspace directly, and nothing it does passes the harness's [read barrier](2026-09-05-read-barrier.md), the [filesystem policy](../../../../packages/fs/fs/README.md), the [approval seam](../../../../packages/interaction/user-approval/README.md), the [budget policy](2026-09-05-budget-policy.md), or the session log. The provider's README states this as a limitation ("Final text only — reasoning, intermediate messages, tool traffic, usage, stderr, and workspace diffs remain product-local"), and the read-barrier note states its consequence: an out-of-process provider can only enforce by refusing to start, because no fence this process installs reaches a foreign agent's reads.

That is the whole cost of the black box. A delegation whose child edits files under a policy the harness never applied leaves the parent's session log describing a result it cannot reconstruct, which is exactly what **model-visible ⟺ logged** forbids. The [read-barrier note](2026-09-05-read-barrier.md) records the same arrangement from the other side: the four out-of-process providers "launch a foreign agent with its own tool stack and no harness policy", so an `implementer` session refuses them entirely above the `none` isolation claim rather than confining them.

The inverse direction already exists. [`dsh-mcp-client`](../../../../packages/mcp/mcp-client/README.md) registers an external MCP server's tools on `ctx.tools` under `mcp__<server>__<name>`, so a foreign capability reaches the harness model through the harness's own registry, policy, and log. Nothing runs the arrow the other way: the harness has no way to hand its own tool set to a foreign model.

## Proposal

Serve the harness tool registry to the external agent as an MCP server, and give that agent nothing else. The external product keeps its model, its prompt assembly, and its loop; the harness keeps every operation those produce.

### `@deepseek-ai/dsh-mcp-tool-server` — the Service Definition and its one provider

A new package at `packages/mcp/mcp-tool-server/` registers `ctx.mcpToolServer`. It builds, for ONE harness agent, an official [`@modelcontextprotocol/sdk`](../../../../packages/mcp/mcp-tool-server/README.md) `McpServer` whose tool list is exactly the tools that agent sees through `ctx.tools`, and whose call handler executes each call through `ctx.tools.execute()` on that agent. It is the mirror of `dsh-mcp-client`: the same `mcp__<server>__<name>` public naming, read in the opposite direction.

`instance(agent, options)` returns an `McpToolServerHandle` carrying the in-process server configuration the Agent SDK accepts (`{ type: 'sdk', name, instance }`), the snapshot of exposed tool names, and `dispose()`. Tool identity is snapshotted at creation rather than tracked live: the run's tool surface is what the external model was told about in its first `tools/list`, and a set that changed underneath it would make the durable `bridge/start` record wrong.

The handler is where the harness's authority actually applies. It appends `tool/call`, awaits `ctx.tools.execute({ callId, name, arguments, agent, signal })`, appends `tool/result`, and returns the executor's rendered content as the MCP result. That one call carries the whole pipeline: `tools/pre-execute` (approval, permission, plan mode), the registry guards (the read barrier's authority guard among them), `tools/execute` wrappers (tool-call timeout), the fs policy the tool itself dispatches, `tools/post-execute`, and the definition-owned content projection. A tool the agent's scope does not see is not registered on the server at all, and would still fail `UNKNOWN_TOOL` at the executor if it were named — the decision is enforced in the operation that makes it, not by the tool list.

**The run is one turn of the child's session.** `tool/call` and `tool/result` are step-scoped events: the [session invariant](../../../../packages/core/session/src/invariant.ts) requires each to name the open turn and step. The handle therefore owns exactly one turn: creation appends `turn/start` and `step/start`, disposal appends `step/end` and `turn/end`. The agent this serves is a child created for one bridge run and driven by nobody else, so no loop-owned turn can collide with it; `serves` on the handle names the agent, and a second concurrent handle on one agent is refused at creation. This is the only structure under which the executor's calls are durable at all, and it is also the honest one: an external agent's run IS one turn of the harness session that authorized it.

`serve(agent, options)` — the same server over the SDK's Streamable HTTP transport on a loopback port with a per-run bearer token, for the Codex and ACP providers, which take an MCP endpoint rather than an in-process instance — is **deferred**. It needs an HTTP listener, a token comparison, per-session transport bookkeeping, and its own denial tests; none of that is shared with the in-process face, and the bridge's first consumer does not use it. The package README carries it under Known Limitations.

Disposal closes the transport, closes the turn, and makes every later call fail: a handler that ran after the turn closed would append a step-scoped event outside its step.

### The seam capability: `harnessTools`

`SubagentCapabilities` gains `harnessTools`, and `SubagentStartRequest` gains `harnessTools?: { only: true }`. The service rejects the request on a provider without the capability with the existing `UNSUPPORTED_CAPABILITY` error, exactly as `outputSchema` is rejected — the same "fail loud, no silent degradation" rule, checked before `start` runs.

The option is an object rather than a boolean because `only: true` is the semantics, not a flag: when it is requested, the child model's tool surface IS the harness tool set of a child harness agent the provider creates under the parent's lineage, **and nothing else**. The provider composes that child the way the in-process drivers do — the parent's preset join, the delegation-scope statement, the delegated policy overrides, the resolved depth, the parent's cwd, `toolFilter` honoured through `ctx.tools.restrict()` — and its session is the durable record of the run. A later member of the object (a partial surface, a named subset) would then be a widening rather than a redefinition.

### `subagent-claude-code` in bridge mode

With `harnessTools` absent the provider behaves exactly as it does today, down to the SDK options: this is one added mode, not a replacement.

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

The SDK message stream folds into the child session as three package-owned log-only events declared by `SessionEventMap` merging in `subagent-claude-code/src/types.ts`:

- `bridge/start { provider, tools }` — one per run, naming the provider and the exact tool names served.
- `bridge/assistant { text, usage? }` — one per assistant message, text blocks only. Tool calls are not repeated here: the executor already logged each as the `tool/call`/`tool/result` pair, and a second copy would be a second source for one fact.
- `bridge/end { stopReason, usage? }` — one per run, carrying the seam's own stop reason.

They are log-only: `deriveMessages()` ignores them, so the external model's text never re-enters any harness model's context. The final answer still returns through the existing `SubagentResult` contract, unchanged.

### The black-box mode's own permission policy

Bridge mode removes the product's permission question by answering every tool call at the harness executor. The black-box mode still has it, and under the host's native settings the product's default mode prompts before a file write — so an unattended black-box child reports that it lacks permission instead of doing the work. Two `subagent-claude-code` config fields make that deployable: `permissionMode`, one of the pinned SDK's values, passed in BOTH modes and absent by default; and `allowedTools`, a black-box-only auto-approval list, because bridge mode's allowlist and denial callback are the fence and a deployment list must not widen them. `bypassPermissions` additionally sets the SDK's `allowDangerouslySkipPermissions`, since a deployment naming that mode in `cordis.yml` IS the intent that flag asks for.

An unattended implementer at `isolation: none` therefore runs at `acceptEdits` or `bypassPermissions` — it hands the product's own confinement away, which is exactly the confinement bridge mode replaces with the harness's.

### What bridge mode does and does not change about the read barrier

This slice keeps the refusal exactly as it is: `assertOutOfProcessAllowed` runs first in both modes, so an `implementer` session under a `process` or `host` claim is refused whether or not it asked for harness tools.

Bridge mode is nonetheless the precondition for relaxing it later. Under `harnessTools: { only: true }` every read the external model performs is a `read` or `grep` through this process's executor, where `fs/read-intent` and the barrier's tool guard already deny — so the child could register `enforce('subagent')` and the census could record `denied-at-executor` for it, which is the evidence `process` isolation asks for.

What still prevents the relaxation is the foreign process itself. The CLI runs unconfined: it is not wrapped by `ctx.sandbox.confine()`, it inherits a working directory and a filesystem, and nothing stops it opening a denied path with its own runtime rather than through an MCP call — the harness fences the tools it serves, not the process it started. Closing that needs the process under the sandbox seam with `deniedReadRoots` expressed by the backend, which is a separate slice against `dsh-subprocess` and `dsh-sandbox-local`, not a consequence of this one.

## Alternatives considered

**Proxy the product's own tools instead of replacing them.** Intercepting Read/Write/Bash through `canUseTool` and re-running them through the harness would keep the product's prompt and tool descriptions intact. It fails at the operation that matters: `canUseTool` can only allow or deny, so an allowed call still runs the product's implementation with the product's policy, and a denied one leaves the model with no route to the work. Serving the harness's own tools is the only arrangement where the call the model makes IS the call the harness executes.

**Give the external agent an MCP server over stdio or HTTP from the start.** An out-of-process transport is what Codex and ACP will need, and it is the general answer. It is also strictly more surface — a listener, a token, transport lifecycle — for a first consumer that accepts an in-process instance directly. The in-process face lands first and the HTTP face is named as deferred work rather than half-built.

**Log the external agent's tool traffic by parsing the SDK message stream.** The stream carries `tool_use` blocks, so a provider could record them without executing anything. That records what the product did without authorizing it: no approval, no fs policy, no guard, and no way to deny. The bridge exists precisely because observation is not authority.

**Reuse `tool/code-dispatch` instead of `tool/call`/`tool/result`.** Those events are not step-scoped, so they would need no turn. They are also the `run_code` transport's own vocabulary, carrying a `rootCallId` and a parent call that a bridged call does not have, and a UI that renders them would present harness tool calls as Code Mode sub-dispatches. The bridged call is an ordinary tool call by an agent, so it takes the ordinary pair and the turn that pair requires.

**Let the child harness agent's own loop drive the turn.** A turn opened by the loop would need a model request, and the whole point of bridge mode is that the model is external. The handle owning one turn keeps the log well-formed without inventing a request that never happened.

**Track the tool set live and send `tools/list_changed`.** MCP supports it and `dsh-mcp-client` consumes it in the other direction. Here the set is the run's own contract: it is recorded in `bridge/start`, it is what the external model planned against, and a mid-run change would leave that record describing a surface the model never had.

**A boolean `harnessTools: true`.** It reads as "also expose harness tools", which is exactly the thing this capability does not mean. `{ only: true }` states the exclusivity at the call site and leaves room for a non-exclusive member later.

## Acceptance criteria

- `ctx.subagents.start('claude-code', { …, harnessTools: { only: true } })` on a provider advertising the capability creates a child harness agent under the parent's lineage; the same request against a provider without it is refused with `SubagentError('UNSUPPORTED_CAPABILITY')` before any process starts.
- In a Loader-booted composition over `examples/headless-agent/tests/fixtures/agent-bridge/`, an official MCP `Client` over an in-memory transport lists exactly the tools the child agent sees, calls one of them, and the child's session log carries the `tool/call`/`tool/result` pair inside one open turn and step — proving the call reached the harness executor rather than a stub.
- The same fixture proves the denial is at the executor: a tool name absent from the child's scope is refused, and the handle rejects every call after `dispose()`.
- The provider's unit specs pin the SDK options bridge mode passes (`tools: []`, `allowedTools`, `strictMcpConfig`, `settingSources`, `maxTurns`), prove `canUseTool` denies a non-`mcp__dsh__` name, and assert `bridge/start`, `bridge/assistant`, `bridge/end` appear in that order in the child's log.
- Black-box mode is unchanged: the existing provider specs pass untouched.

## Risks

The turn the handle opens is a durable structure written by something other than the agent loop. It is correct while the served agent is the bridge's own child, and it would desynchronize from a live loop's turn counter if a composition ever handed `instance()` an agent that something else drives. The handle names the agent it serves and refuses a second concurrent handle on it; a deployment that violates the remaining precondition gets a loud invariant failure on the child's log rather than a silent one.

The external process stays unconfined. Bridge mode fences the tools, not the process, so a product that reads a file with its own runtime rather than through an MCP call is outside everything this note adds — which is why the read-barrier refusal stays exactly where it is.

The child session records the external agent's text but not its reasoning or its system prompt. `bridge/assistant` carries what the SDK reports as assistant text; the product's hidden thinking, its assembled prompt, and its own context are not observable from this process, so a reader of the child log sees what the external agent said and did, never why.

Tool descriptions written for the harness's own model reach a foreign one. They are model-facing prose tuned to this deployment's prompt, and a different model may read them differently; the bridge changes neither the descriptions nor the schemas, so the mismatch is visible as ordinary tool-use error rather than as silent divergence.
