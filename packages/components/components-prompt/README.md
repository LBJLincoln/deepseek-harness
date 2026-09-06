# @deepseek-ai/dsh-components-prompt

English | [中文](README.zh.md)

Mirrors the system-prompt sections one scope resolves into the component registry as `prompt-section` components, following the prompt registry's own `system-prompt/change` notification.

## Config

```yaml
- id: system-prompt
  name: '@deepseek-ai/dsh-system-prompt'
- id: components
  name: '@deepseek-ai/dsh-components'
- id: components-prompt
  name: '@deepseek-ai/dsh-components-prompt'
```

The adapter takes no configuration and requires both services.

## Contract

The adapter reads `ctx.systemPrompt.sections(scope)` for its own context's scope: mounted on a host row it mirrors the global layer, and mounted through an agent preset's context it mirrors that agent's resolved sections into that agent's layer. Each component has id `prompt-section:<name>`, kind `prompt-section`, `provenance: 'curated'`, no `invoke` pointer, and `detail: { order, complete, static }`; `promptSectionComponentId(name)` builds the id for consumers.

`system-prompt/change` carries no diff, so every notification re-reads the resolved sections and reconciles: an unchanged section keeps its registration, a changed one is replaced under the same id, and one that left the scope is disposed. Disposing the adapter fiber removes every component it registered.

This adapter owns the `prompt-section` canonical value beside its `ComponentKindMap` declaration: `[name, order, complete === true, text]` when the registered text is a string and `[name, order, complete === true, null]` when it is a provider evaluated per assembly, addressed by `promptSectionDigest(section)`. `promptSectionDigestBasis(section)` reports `content` for stored text and `registration` for a provider — the honest statement for a section whose model-visible bytes are a function of the assembly. Those bytes stay where they already are, in `request/header`.

## Model Experience

None, as the adapter registers component metadata only; the mirrored sections reach the model through `ctx.systemPrompt.assemble()` exactly as they did before.

#### KV Cache effect

None; the adapter neither adds to nor changes any model request.

## Known Limitations and Deferred Work

- **A provider-text section addresses its registration** — two runs whose dynamic section rendered different text share one address, and replacing a provider with another provider under the same name, order, and completeness does not move the digest. A comparison that needs the rendered bytes reads `request/header`.
- **Sections only** — prompt contexts, variables, and tool providers are registrations of the same registry and are not mirrored; each would need its own canonical value and a consumer that reads it.
- **One reading per scope** — the adapter mirrors the scope of the context it was mounted on; a deployment that wants both the global set and one agent's own mounts the adapter twice, once per context, and the two registrations shadow by layer.
