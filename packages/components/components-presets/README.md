# @deepseek-ai/dsh-components-presets

English | [中文](README.zh.md)

Mirrors every standing agent-preset mount into the component registry as a `preset` component, addressed by the composition the mount actually installed.

## Config

```yaml
- id: agent-presets
  name: '@deepseek-ai/dsh-agent-presets'
  config:
    default: standard
- id: components
  name: '@deepseek-ai/dsh-components'
- id: components-presets
  name: '@deepseek-ai/dsh-components-presets'
```

The adapter takes no configuration and requires both services.

## Contract

The roster publishes no mount notification, and its authoritative reading — `livePresetMounts()` — prunes the record of every subtree whose fiber is gone. The adapter therefore reconciles against that reading at mount and at the two edges a session's composition changes at: `agent/created`, emitted after the agent factory's setup installed the join, and `agent-preset/selected`, committed when a blank session switches preset. Each component has id `preset:<id>`, kind `preset`, no `invoke` pointer, and `detail: { trust, rows }`; `presetComponentId(id)` builds the id for consumers. A `system` preset ships with the deployment and is `curated`; a `user` preset was authored locally, by a person or by an agent, and is recorded as `synthesized`. Disposing the adapter fiber removes every component it registered.

This adapter owns the `preset` canonical value beside its `ComponentKindMap` declaration: `[id, trust, rows]`, where `rows` is the mounted composition after `include` resolution as `[id, name, config, disabled]` per row, addressed by `presetDigest(mount)` with `digestBasis: 'content'`. A row `name` that is an absolute path is rewritten relative to the preset directory, so two hosts that mounted the same composition under different roots address identically; a row whose `config` is absent or does not survive the lossless-JSON boundary contributes `null`.

## Model Experience

None, as the adapter registers component metadata only; a preset's rows own every model-visible effect of the composition they install.

#### KV Cache effect

None; the adapter neither adds to nor changes any model request.

## Known Limitations and Deferred Work

- **Reconciled at a join, not at a teardown** — a standing mount torn down with no later agent creation or preset selection stays listed until the next reconcile. Standing mounts live until whole-tree teardown, so the window is bounded in practice; a mount notification on the roster would close it.
- **A `!!js` row config pools with an absent one** — both contribute `null`, so two compositions differing only in a config no JSON encoding preserves address identically.
- **Trust stands in for authorship** — the roster records the root a preset was discovered under, never who wrote it, so every `user` preset is recorded as synthesized and carries no lineage to the preset it was copied from.
