# @deepseek-ai/dsh-subagent-claude-code

English | [中文](README.zh.md)

This package registers the fixed `claude-code` subagent provider. Each accepted run invokes the official Claude Agent SDK in the delegating Session's workspace, resolves the native `claude` executable through the shared subprocess service, submits one self-contained text task, and returns only the final answer through the shared [`dsh-subagent`](../subagent/README.md) result contract.

## Start and ownership

`start(request)` accepts only a non-empty sequence of text blocks and derives the child cwd from the parent Session. It creates one private `AbortController`, calls the official SDK `query()`, and publishes the run only after the SDK's `spawnClaudeCodeProcess` hook has supplied a live CLI handle owned by [`dsh-subprocess`](../../subprocess/subprocess/README.md). A failure or cancellation before publication closes the query, terminates any acquired process tree, waits for it to exit, and rejects `start()`.

The SDK receives the exact concatenated text task. The provider iterates the complete SDK message stream and accepts only a `result` message with `subtype: "success"`, `is_error: false`, and a nonblank `result`, followed by normal iterator completion. Every SDK error subtype, an error-marked success, a missing answer, iterator failure, protocol failure, or process failure maps to `error`; the provider produces neither `max-tokens` nor `refusal`.

Local cancellation wins the result race and maps to `aborted`. `dispose()` is idempotent: it aborts the run, asks the SDK query to close, invokes the shared process-tree termination escalation, and waits for whole-tree exit. SDK graceful close expresses protocol intent; the subprocess handle remains the authority for process quiescence. Result failure and independent teardown failure remain separate.

Before anything is spawned, `start()` asks the composed [read barrier](../../verification/read-barrier/README.md) whether this out-of-process child may run at all. An implementer session under a deployment claiming `process` or `host` isolation is refused with `SubagentError` `READ_BARRIER_REFUSED`, because a foreign agent brings its own tool stack and no fence this process installs reaches its reads; under a claim of `none` nothing is refused. The provider registers that refusal with the barrier, so the scope census reports `subagent`.

The refusal applies to both modes, bridge mode included. Bridge mode is what makes relaxing it conceivable — under it every read the external model performs is a harness tool call through this process's executor, where the barrier already denies — but it is not sufficient: the CLI process itself is unconfined, so it can open a denied path with its own runtime rather than through an MCP call. Confining that process is separate work against the sandbox seam.

## Native settings and interaction

Outside bridge mode the provider deliberately omits the SDK `settingSources` option. The official SDK therefore reads the host's normal user, project, and local Claude settings relative to the parent Session cwd, including native account state and product configuration. The provider neither copies nor filters those files and does not create or modify login state. Bridge mode passes `settingSources: []` instead, because a workspace setting that added a tool or a hook would reopen the surface bridge mode exists to close; authentication is unaffected, since the SDK resolves the account independently of that option.

Each query sets `persistSession: false` and disables `AskUserQuestion`. It supplies no elicitation or dialog callback, so unattended interactions fail through the SDK instead of waiting for a user interface this provider does not own. The only `canUseTool` the provider ever supplies is bridge mode's own tool fence, which asks nobody anything: it decides from the tool name alone.

## Bridge mode: the harness tool set, and nothing else

A request carrying `harnessTools: { only: true }` runs the same product against a completely different tool surface. The provider creates a child harness agent under the parent's lineage — the parent's cwd, its preset composition, its delegated sandbox and approval policy, the resolved delegation depth — serves that agent's tool registry through [`dsh-mcp-tool-server`](../../mcp/mcp-tool-server/README.md) as the SDK server named `dsh`, and pins the external model to it:

| SDK option | Value | Why |
|---|---|---|
| `tools` | `[]` | No built-in tool of the product's own. |
| `mcpServers` | `{ dsh: <in-process instance> }` | The harness registry, in this process. |
| `allowedTools` | `['mcp__dsh__*']` | Harness tools run without a product-side permission prompt. |
| `canUseTool` | denies every name outside `mcp__dsh__` | The fence. `allowedTools` decides what is auto-approved, not what may be called. |
| `strictMcpConfig` | `true` | No MCP server from the workspace, user settings, or plugins. |
| `settingSources` | `[]` | No project settings, hooks, CLAUDE.md, or agent frontmatter. |
| `maxTurns` | `agentOptions.maxTurns` when set | The caller's turn ceiling reaches the external loop. |

Every tool call the external model makes is therefore an ordinary harness execution on the child agent: authorized by the approval seam, filtered by the registry guards, bounded by the tool-call timeout, and recorded as the usual `tool/call`/`tool/result` pair. The final answer still returns through the shared result contract, and `SubagentRun.localAgent` is the published child, whose id is the run id.

The pinned SDK warns that a bare `allowedTools` entry auto-approves before `canUseTool` runs. That is the intended split: the served harness tools need no product-side prompt, while every other name falls through to the callback and is denied there.

### What the child session records

`src/types.ts` declares three log-only events, none of which enters any harness model's context:

| Event | Payload | When |
|---|---|---|
| `bridge/start` | `provider`, `tools` (the names as the external model sees them) | Once, after the server is attached. |
| `bridge/assistant` | `text`, optional `usage` | Per assistant message with text. Tool calls are absent: the executor already logged each as the durable pair. |
| `bridge/end` | `stopReason`, optional `usage`, `model`, `costUsd` | Once, when the run settles or is released. |

The whole run is one turn of that child session, because the durable tool pair is step-scoped; [`dsh-mcp-tool-server`](../../mcp/mcp-tool-server/README.md) owns that turn and closes it on disposal.

The log does NOT hold the external model's hidden reasoning, its assembled system prompt, or its own context: none of it is observable from this process. A reader of the child log sees what the external agent said and did, never why.

## Capabilities and context

The provider advertises `harnessTools` and `model`, and reports `inheritsParentContext: false`. `harnessTools` is honored because the harness composes the child agent whose tools it serves rather than asking the product to enforce anything. `outputSchema`, `maxDepth`, `toolFilter`, and `persona` are still rejected by the shared service for this provider, in both modes.

## Selecting the model, and what the product reports back

A start naming `model` sets the SDK's `model` option, which the CLI takes as `--model`, in both modes. The identifier is the product's own — an alias such as `sonnet` or a full model id — and it replaces whatever the host's settings would have selected for that run alone; a run naming none leaves those settings in place. The product refuses an identifier it does not accept, so a run either used the named model or failed.

Every run reports back what the product said about itself, on every settlement path — completed, error, and cancelled alike:

| Result field | Source | Meaning |
|---|---|---|
| `reportedModel` | the `system`/`init` message's `model` | the model the product opened the run on, as a full product model id. |
| `reportedUsage` | the terminal `result` message's `usage` | input, output, and cache tokens the product accounted for. |
| `reportedCostUsd` | that message's `total_cost_usd` | what the product priced the run at, in its own accounting. |

Each is absent when the product stated none — a run that failed before the CLI opened reports no model, one killed before its terminal message reports no spend. These are the only account of a Claude Code run this process can hold: its tokens are spent in another product and never reach a harness log, so a caller measuring an external implementer reads spend here or nowhere. In bridge mode the same three land in the child session's own `bridge/end` record.

Without `harnessTools`, Claude Code receives the standalone text task, the parent Session cwd, and the model when a start named one, but not the parent conversation, persona, tool filter, depth policy, or structured-output contract. Every run has an independent SDK query, cancellation controller, CLI process, and non-persisted product session.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `env` | `{}` | Explicit SDK/CLI environment layered over the shared credential-scrubbed parent environment. |
| `disposeGraceMs` | `3000` | Positive finite grace in milliseconds, no greater than [`MAX_TIMER_DELAY_MS`](../../util/timeout/README.md), between the shared process-tree owner's termination tiers; disposal then waits for whole-tree exit. |
| `permissionMode` | absent | The product's own permission mode for both modes, one of the pinned SDK's values (`default`, `acceptEdits`, `bypassPermissions`, `plan`, `dontAsk`, `auto`); any other value is refused at load. Absent leaves the product's default. |
| `allowedTools` | `[]` | Tool names the product auto-approves in the BLACK-BOX mode only; empty leaves the product's default. Bridge mode ignores it and keeps its own allowlist and denial callback. |

Under the host's native settings the product's default permission mode prompts before a file write, so an unattended black-box child reports that it lacks permission rather than doing the work. An unattended implementer at `isolation: none` therefore needs `acceptEdits` (file edits) or `bypassPermissions` (everything, and the provider pairs it with the SDK's required `allowDangerouslySkipPermissions`). Both hand the product's own confinement away — which is exactly what bridge mode replaces: there the harness authorizes each call at its own executor, so no product-side permission decision is involved at all.

Production resolves `claude` from the subprocess execution world's credential-scrubbed `PATH`, with explicit `env` entries applied, and passes the resulting path to the SDK as `pathToClaudeCodeExecutable`. On Windows, a resolved `.cmd` or `.bat` path is carried as a quoted, per-spawn environment value that `cmd.exe /v:off` expands once, so valid path metacharacters remain data. The pinned SDK's fixed flags then occupy cmd's command tail and contain no cmd metacharacters; they are not ordinary Windows argv. Native settings and authentication remain authoritative. The plugin does not install another CLI, create a product home, log in, or probe an account; it selects a model only when a start names one. Credential-shaped ambient variables are removed before the explicit `env` overlay is applied, so an API key or token intended for the child must be supplied there. Non-credential endpoint variables such as `ANTHROPIC_BASE_URL`, along with ordinary ambient values such as `PATH` and `HOME`, remain inherited unless overridden.

Shipped profiles load this provider once on the host and start no Claude process until a tool call. Full Agent Presets carry the tool row below with `disabled: true`; copy a preset and remove that field to expose `subagent_claude_code` only to agents composed from the copy. A custom host composition can still use both rows directly.

```yaml
- id: subagent-claude-code
  name: '@deepseek-ai/dsh-subagent-claude-code'
  config:
    env:
      ANTHROPIC_API_KEY: !!js process.env.ANTHROPIC_API_KEY

- id: tool-subagent-claude-code
  name: '@deepseek-ai/dsh-tool-subagent'
  disabled: true
  config:
    provider: claude-code
    toolName: subagent_claude_code
    enableRunInBackground: false
    maxDepth: provider-managed
```

## Product compatibility and evidence

The runtime dependency is pinned to `@anthropic-ai/claude-agent-sdk@0.3.220`. Production runs the native `claude` installation. The keyless real-product test uses the SDK-distributed Claude Code 2.1.220 CLI as a deterministic fixture, routed through the same native executable-resolution and Windows batch-shim path; it does not claim compatibility with every independently installed version. Loader composition proves that both product packages coexist without starting either product.

The project owner's identity-scoped distribution authorization covers the official SDK and the official CLI/platform payloads declared by each SDK version. [`THIRD_PARTY_NOTICES.md`](../../../THIRD_PARTY_NOTICES.md) discloses the current optional payload closure without classifying its declared terms as permissive; unrelated non-permissive runtime dependencies continue to fail the notices gate.

## Model Experience

### Child request

#### What the model sees

The Claude Code child receives the standalone text task as one fresh SDK query. Its workspace is the parent Session cwd and its model is the one the start named, while its system instructions, tools, permissions, authentication, and — for a start naming no model — its model come from the host's native Claude settings and product installation. Under `harnessTools: { only: true }` the tools instead come from the child harness agent's registry, and the host's settings, hooks, project files, and MCP servers are excluded — only the model and the authentication remain the product's.

#### Token effect

The child pays for an independent Claude Code context and query. Child tokens do not enter the parent's context.

#### KV Cache effect

Independent of the parent request cache. Reuse depends only on Claude Code's own model, instructions, tools, native settings, and fresh query.

### Parent tool result, indirectly

#### What the model sees

Through `dsh-tool-subagent`, the parent sees only the strict final Claude Code answer or the consumer's exact error for a non-completed result. Claude Code reasoning, tool activity, intermediate messages, stderr, workspace diffs, and product ids are not copied into the parent Session; the model, usage, and cost the product reported reach the caller through the run result, not the parent's context.

#### Token effect

Parent input grows only by the final answer or error retained in the tool result. This provider adds no parent tool schema by itself.

#### KV Cache effect

Append-only: the new tool result follows the reusable parent request prefix.

## Known Limitations and Deferred Work

- **One fresh query and process per run** — there is no continuation, resume, pooling, progress stream, or product-session persistence.
- **Host settings are intentionally authoritative** — project and user settings can change model, tools, and behavior; the provider does not provide a filtered or hermetic production mode.
- **Product installation and account state remain native** — a missing or incompatible `claude`, configuration error, or authentication failure is surfaced as a startup or run error; the plugin provides no installer or login flow.
- **The SDK platform CLI remains in the install closure** — production ignores it in favor of the host `claude`, but the current SDK optional dependency is still installed and supplies the keyless compatibility fixture. Removing that payload belongs to the separate product installation-closure follow-up.
- **No human interaction path** — `AskUserQuestion` is disabled and other interactive callbacks are absent, so tasks requiring new approval or input fail instead of suspending.
- **Final text only outside bridge mode** — without `harnessTools`, reasoning, intermediate messages, tool traffic, usage, stderr, and workspace diffs remain product-local. Bridge mode records the tool traffic, the assistant text, and the usage; the reasoning and the product's own prompt stay unobservable in both.
- **No optional shared capabilities besides `harnessTools` and `model`** — output schemas, child personas, tool filtering, and harness depth enforcement are rejected by the shared service for this provider. `toolFilter` is meaningful in bridge mode and refused there too: capability flags are per provider rather than per mode, so advertising it would accept it in the black-box mode as well, where it would be silently ignored.
- **Bridge mode needs the tool server composed** — a deployment that requests `harnessTools` without [`dsh-mcp-tool-server`](../../mcp/mcp-tool-server/README.md) is refused at start with `SubagentError` `BRIDGE_UNAVAILABLE`, because the provider cannot serve a registry that is not there.
- **The bridged process is unconfined** — bridge mode fences the tools the external model is given, not the process it runs in.
- **No wall-clock timeout or side-effect rollback** — the caller cancels long work, and files or external systems changed before cancellation are not restored.
