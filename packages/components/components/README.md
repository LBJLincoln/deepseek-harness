# @deepseek-ai/dsh-components

English | [中文](README.zh.md)

Component registry: the composition-time inventory of every addressable unit — a plugin, or a plugin-provided member such as a tool, skill, subagent provider, workflow, MCP server, context provider, preset, or composition — with its kind, content address, provenance, lineage, membership, and the tool a model calls to reach it. The registry executes nothing. The [component-registry Agent Note](../../../.agents/notes/proposed/architecture/2026-09-01-component-registry-seam.md) owns the registry design; the [composition-manifest Agent Note](../../../.agents/notes/proposed/architecture/2026-09-05-composition-manifest.md) owns content addressing and the scoped layers.

## Config

```yaml
- id: components
  name: '@deepseek-ai/dsh-components'
```

The service takes no configuration; producers and consumers compose beside it.

## Service contract

`ctx.components.register(descriptor)` stores one `ComponentDescriptor` and returns the exact disposer that removes that registration and no later one under the same id. Registrations are effects: a producer keeps the disposer under its own fiber so disposal removes the component. `get(id, options?)` and `list(options?)` return detached copies in registration order, the global layer first; a caller cannot mutate stored member lists through them. Both reads take `scope` — the viewing agent — and `list` also takes `kind`.

A descriptor carries a branded `ComponentId`, a `kind` from the merge-extensible `ComponentKindMap` (each producer declares its kind and detail type by declaration merging on `@deepseek-ai/dsh-components/types`; this package declares none), a `digest` with its `digestBasis`, `name`, `description`, the owning package, `provenance` (`curated` or `synthesized`), an optional `lineage` parent id, optional `members` for compositions, an optional `invoke` pointer naming the existing tool and fixed arguments that reach the component, and kind-specific `detail`. A read adds `layer`.

## Content addressing

`componentDigest(kind, canonical)` returns the lowercase 64-character SHA-256 hex of the kind, a newline, and the JSON encoding of the producer's canonical value; the kind is inside the hashed bytes, so two kinds whose canonical values coincide never share an address. `componentAddress(id, digest)` joins them as `id@digest`. Digests are stored and compared at full length; truncating one for a card or a table is a presentation choice.

Each producer owns its kind's canonical value beside its `ComponentKindMap` declaration and computes the digest before registering — the registry never switches on kind, so a kind added downstream needs no change here. A canonical value covers only what identifies the component: the viewing scope, the working directory, a wall clock, an absolute path, and a discovery source or rank stay out, so two hosts that composed the same bytes address identically. `digestBasis` states what the digest covers — `content` for a component addressed by its own bytes, `registration` for one whose model-visible text is a function of the assembly rather than of stored bytes.

## Scoped layers

Registrations file into the layer of the calling context's scope, the shape [`ctx.tools`](../../core/tools/README.md) and [`ctx.skills`](../../skill/skill/README.md) already use: a host row or repository plugin registers globally, while an agent preset's standing mount registers for that scope alone. A read merges the global layer with the viewing scope's chain, farthest ancestor first, so the nearest layer's registration wins a duplicate id and each read-back descriptor carries `layer` — `global` when the winning registration sits in the global layer, `agent` when it sits anywhere on that agent's chain. Ids are unique per layer, so a duplicate id in one layer throws `ComponentError` with code `COMPONENT_DUPLICATE_ID` while the same id in a different layer shadows.

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
- **No change notification** — the registry emits no event when its layers change; a consumer that needs the current inventory reads it, and one that needs an edge would have to add the event with its first user.
