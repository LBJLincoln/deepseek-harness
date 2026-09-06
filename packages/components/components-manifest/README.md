# @deepseek-ai/dsh-components-manifest

English | [中文](README.zh.md)

Records every component one agent has in play as a durable `composition/manifest` session event, so what produced a session's model requests is reconstructable from its log alone.

## Config

```yaml
- id: components
  name: '@deepseek-ai/dsh-components'
- id: components-manifest
  name: '@deepseek-ai/dsh-components-manifest'
```

The plugin takes no configuration and requires `ctx.agents` and `ctx.components`. Composed alone it records an empty composition; the adapters under [`packages/components/`](../README.md) are what put components in the registry for it to record.

## Contract

On `agent/pre-step` the writer calls `next()` first — so the reading covers what the whole pre-step chain settled on — then recomputes `ctx.components.list({ scope: agent })` and appends one `composition/manifest` event only when its `compositionSha256` differs from the last manifest in that session's log. Deduplication is log-derived, so a stable composition records exactly one event, a resumed session re-emits nothing, and a step a later policy rejected still records the composition that was in play.

Recomputing rather than tracking incrementally is what keeps the record correct across a producer's HMR disposal, a preset mounted after creation, and scope shadowing: the writer holds no subscription state any of those orderings could invalidate.

The payload carries `version`, one `components` entry per component — `id`, `digest`, `kind`, `digestBasis`, `provenance`, optional `lineage`, and the registry `layer` the winning registration sat in — ordered by `id@digest` address, and `compositionSha256` over exactly that ordered address list joined by newlines. `buildCompositionManifest(views)` builds it, `lastCompositionManifest(events)` folds the newest one out of a log, `compositionSha256(addresses)` recomputes the hash, and `isComponentAddress(address)` tests whether an address is one a generation comparison can key on.

The event is required on read: a build that does not know `composition/manifest` refuses a log containing it, because the alternative is treating a composition it cannot name as a known one.

## Model Experience

None, as the manifest is log-only; it names what produced the model's inputs and adds nothing to any request.

#### KV Cache effect

None; the writer neither adds to nor changes any model request.

## Known Limitations and Deferred Work

- **Names components, not their transitive effects** — an MCP server whose remote tool descriptions change without a re-registration, or a skill whose body references a file that changed, keeps its digest. Only what each kind's canonical value covers is addressed.
- **One manifest per composition change, however small** — a composition that churns its visible tool set every step writes one event per step. That is a real change in what the model can call, but a scoped restriction toggled per step inflates a log with events no consumer distinguishes yet.
- **No quarantine fields yet** — the payload carries no `reason`, `presetId`, `dynamicPackagesMounted`, or `synthesized` roll-up; each waits for the slice that produces its input, and a consumer that needs one derives it from `components` in the meantime.
