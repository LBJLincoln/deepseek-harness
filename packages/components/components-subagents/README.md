# @deepseek-ai/dsh-components-subagents

English | [中文](README.zh.md)

Mirrors every subagent provider registered with `ctx.subagents` into the component registry as an `agent-provider` component, following the seam's own `subagent/provider-added` and `subagent/provider-removed` events so the inventory tracks the live registry.

## Config

```yaml
- id: subagents
  name: '@deepseek-ai/dsh-subagent'
- id: components
  name: '@deepseek-ai/dsh-components'
- id: components-subagents
  name: '@deepseek-ai/dsh-components-subagents'
```

The adapter takes no configuration and requires both services.

## Contract

At mount the adapter registers one component per name in `ctx.subagents.list()`; afterwards it registers on `subagent/provider-added` and disposes on `subagent/provider-removed`, ignoring a duplicate addition or an unknown removal. Each component has id `agent-provider:<provider>`, kind `agent-provider`, `provenance: 'curated'`, no `invoke` pointer, and `detail: { provider }`. Disposing the adapter fiber removes every component it registered. `agentProviderComponentId(provider)` builds the id for consumers.

This adapter owns the `agent-provider` canonical value beside its `ComponentKindMap` declaration: `[provider]`, addressed by `agentProviderDigest(provider)` with `digestBasis: 'registration'`. The digest covers the registration and not the agent a provider starts, because the subagent seam exposes a provider name and its lifecycle edges, never the composition behind them.

## Model Experience

None, as the adapter registers component metadata only; the subagent tool owns every model-visible effect of the mirrored providers.

#### KV Cache effect

None; the adapter neither adds to nor changes any model request.

## Known Limitations and Deferred Work

- **No callable route** — the `subagent` tool is mounted per provider under a configurable `toolName` and takes no `provider` argument, and the subagent seam does not expose which tool instance is bound to a provider; the component carries no `invoke` pointer until the tools adapter mirrors tool-subagent instances with their provider binding.
- **Names only** — the component detail carries the provider name; provider capabilities (`outputSchema`, `depthLimit`, `toolFilter`, `persona`) are not mirrored until a consumer needs them. The digest inherits that limit: two providers of the same name registered by different plugins address identically, and a provider whose capabilities change without a re-registration keeps its digest.
- **Global registrations only** — the adapter mounts on a host context, so its components land in the global layer; a per-agent subagent registry would need the adapter mounted through that agent's scope.
- **Curated provenance for every provider** — providers are composed plugins today; a synthesized provider registered at runtime would need its producer to declare its own provenance and lineage.
