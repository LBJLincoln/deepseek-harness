# @deepseek-ai/dsh-components

English | [中文](README.zh.md)

Component registry: the composition-time inventory of every addressable unit — a plugin, or a plugin-provided member such as a tool, skill, subagent provider, workflow, MCP server, context provider, preset, or composition — with its kind, provenance, lineage, membership, and the tool a model calls to reach it. The registry executes nothing. The [component-registry Agent Note](../../../.agents/notes/proposed/architecture/2026-09-01-component-registry-seam.md) owns the design rationale.

## Config

```yaml
- id: components
  name: '@deepseek-ai/dsh-components'
```

The service takes no configuration; producers and consumers compose beside it.

## Service contract

`ctx.components.register(descriptor)` stores one `ComponentDescriptor` and returns the exact disposer that removes that registration and no later one under the same id; a duplicate id throws `ComponentError` with code `COMPONENT_DUPLICATE_ID`. Registrations are effects: a producer keeps the disposer under its own fiber so disposal removes the component. `get(id)` and `list(kind?)` return detached copies in registration order; a caller cannot mutate stored member lists through them.

A descriptor carries a branded `ComponentId`, a `kind` from the merge-extensible `ComponentKindMap` (each producer declares its kind and detail type by declaration merging on `@deepseek-ai/dsh-components/types`; this package declares none), `name`, `description`, the owning package, `provenance` (`curated` or `synthesized`), an optional `lineage` parent id, optional `members` for compositions, an optional `invoke` pointer naming the existing tool and fixed arguments that reach the component, and kind-specific `detail`.

## Extension points

Producers are adapter packages that mirror one seam's live registry and follow that seam's own events; `@deepseek-ai/dsh-components-subagents` is the first. Consumers read the inventory: `@deepseek-ai/dsh-command-components` renders it for humans, and the verification, improvement, and oversight seams take component ids as the subject of certificates, scores, and audits.

## Model Experience

None, as the registry holds composition-time inventory and registers nothing model-facing; consumers own any rendered use.

#### KV Cache effect

None; the registry neither adds to nor changes any model request.

## Known Limitations and Deferred Work

- **Composition-time only** — the registry holds no durable record; promotion records and per-component evidence ride session events and the storage domain in the improvement seam's promotion slice.
- **No dispatch** — the `invoke` pointer is data for consumers; the `component_invoke` tool that follows it is a later Consumer.
- **Kinds arrive with producers** — a program with no adapter composed sees `ComponentKind` as `string` and an empty inventory.
