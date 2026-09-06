# @deepseek-ai/dsh-components-skills

English | [中文](README.zh.md)

Mirrors every skill body this composition has loaded into the component registry as a `skill` component, re-addressing those skills whenever the skill registry reports a catalog change.

## Config

```yaml
- id: skills
  name: '@deepseek-ai/dsh-skill'
- id: tool-skill
  name: '@deepseek-ai/dsh-tool-skill'
- id: components
  name: '@deepseek-ai/dsh-components'
- id: components-skills
  name: '@deepseek-ai/dsh-components-skills'
```

The adapter takes no configuration and requires `ctx.agents`, `ctx.components`, `ctx.skills`, and `ctx.tools`.

## Contract

A skill is in play once its body is loaded, not once it is listed: `ctx.skills.list()` returns summaries without bodies, so a catalog entry names knowledge the session has not received. The adapter therefore takes the loaded skill's name from the record of each load — the settled `tools/result` of the `skill` tool for a model-driven load, and the `skill-invocation` message source for a user-explicit `/name` load — reads that body back through `ctx.skills`, and addresses it with `skillDigest()`. It never re-parses the rendered `<skill_content>` block and never reads an address off the record, so no digest has to travel on the model-visible tool result. A record naming no skill, and a name the registry cannot resolve, register nothing.

Each component has id `skill:<name>`, kind `skill`, `provenance: 'curated'`, `digestBasis: 'content'`, `invoke: { tool: 'skill', arguments: { name } }`, and `detail: { skillName }`. Every field except the digest is a function of the name, so both load paths produce one identical descriptor for one generation. `skillComponentId(name)` builds the id for consumers.

`skills/change` is an unfiltered invalidation carrying no diff, so each notification replays the lookup that produced each in-play generation: a body edited in place is re-registered under the same id at its new address, a skill the registry no longer resolves leaves the inventory, and a read that fails leaves its generation as it stands and reports through the context logger. Every read is asynchronous, so one settling after the adapter's fiber is disposed, or after a later load or replay superseded it, changes nothing. Disposing the adapter fiber removes every component it registered.

The `skill` canonical value belongs to [`dsh-skill`](../../skill/skill/README.md), which exports `skillDigest(definition)` over the loaded definition; this adapter computes the address from its own read rather than trusting one it was handed.

## Model Experience

None, as the adapter registers component metadata only; a loaded skill body reaches the model through the `skill` tool result and the user-explicit injection exactly as it did before.

#### KV Cache effect

None; the adapter neither adds to nor changes any model request.

## Known Limitations and Deferred Work

- **A reachable skill is not an addressed one** — a skill the catalog advertised and no step loaded is absent from the inventory, so a consumer asking what a session *could* have used reads the `skill-catalog` message source instead.
- **One reading per scope** — the adapter files into the layer of the context it was mounted on, so a host-mounted adapter records every agent's loads in the global layer; a deployment that wants per-agent skill inventories mounts it through each agent's composition.
- **Addressing lags its trigger** — every registration is one asynchronous body read, so a manifest written in the same tick as a load or a `skills/change` can still omit the generation or name the previous one; the next step's manifest carries the new address.
- **Curated provenance for every load** — a skill body an agent wrote into a discovery root is loaded exactly like a curated one, and the skill seam records no author; provenance for synthesized bodies needs the writing path to declare it.
