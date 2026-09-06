# @deepseek-ai/dsh-components-tools

English | [中文](README.zh.md)

Mirrors the tools one scope sees into the component registry as `tool` components, following the registry's own `tools/change` notification so the inventory tracks what the model can actually call.

## Config

```yaml
- id: tools
  name: '@deepseek-ai/dsh-tools'
- id: components
  name: '@deepseek-ai/dsh-components'
- id: components-tools
  name: '@deepseek-ai/dsh-components-tools'
```

The adapter takes no configuration and requires both services.

## Contract

The adapter reads `ctx.tools.schemas(scope)` for its own context's scope: mounted on a host row it mirrors the global layer, and mounted through an agent preset's context it mirrors that agent's visible set into that agent's layer. Each component has id `tool:<name>`, kind `tool`, `provenance: 'curated'`, `invoke: { tool: <name> }`, and `detail: { toolName }`; `toolComponentId(name)` builds the id for consumers.

`tools/change` carries no diff, so every notification recomputes the visible set and reconciles: an unchanged schema keeps its registration, a changed one is replaced under the same id, and a tool that left the scope — unregistered, restricted away, or collapsed by a presentation mode — is disposed. Disposing the adapter fiber removes every component it registered.

This adapter owns the `tool` canonical value beside its `ComponentKindMap` declaration: the model-facing schema exactly as `ctx.tools.schemas()` projects it — name, description, and parameter schema in the registry's own field order — addressed by `toolDigest(schema)` with `digestBasis: 'content'`. One byte changed in a parameter description moves the digest; nothing the registry computes per assembly enters it.

## Model Experience

None, as the adapter registers component metadata only; each mirrored tool owns every model-visible effect of its own registration.

#### KV Cache effect

None; the adapter neither adds to nor changes any model request.

## Known Limitations and Deferred Work

- **No output schema in the address** — `ToolSchema` is what the model receives, and it carries name, description, and parameters alone, so a tool whose canonical output declaration changed without a model-facing change keeps its digest. Addressing the output would need the registry to project it beside the wire schema.
- **One reading per scope** — the adapter mirrors the scope of the context it was mounted on; a deployment that wants both the global set and one agent's own mounts the adapter twice, once per context, and the two registrations shadow by layer.
- **Curated provenance for every tool** — tools are composed plugins today; a synthesized tool registered at runtime would need its producer to declare its own provenance and lineage.
