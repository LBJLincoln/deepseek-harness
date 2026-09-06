# components/ — every addressable unit of a composition

English | [中文](README.zh.md)

One registry for what a composition contains and how a model reaches each part: plugins and plugin-provided members carry a stable id, a content address, a kind, provenance, lineage, membership, and a callable route, filed in the global layer or an agent's own. Producers are adapters that mirror one seam's live registry and own their kind's canonical value; consumers read the inventory for humans, models, and the seams that score components.

| Package | Role | ctx key |
|---|---|---|
| [`components/`](components/README.md) | Component registry: descriptors, kinds, lineage, callable routes | `ctx.components` |
| [`components-tools/`](components-tools/README.md) | Mirrors visible tools as `tool` components | — |
| [`components-prompt/`](components-prompt/README.md) | Mirrors system-prompt sections as `prompt-section` components | — |
| [`components-presets/`](components-presets/README.md) | Mirrors standing agent-preset mounts as `preset` components | — |
| [`components-skills/`](components-skills/README.md) | Mirrors loaded skill bodies as `skill` components | — |
| [`components-packages/`](components-packages/README.md) | Mirrors Loader entries and runtime-written packages as `plugin` and `dynamic-package` components | — |
| [`components-subagents/`](components-subagents/README.md) | Mirrors subagent providers as `agent-provider` components | — |
| [`components-manifest/`](components-manifest/README.md) | Records the composition in play as a `composition/manifest` event | — |
| [`command-components/`](command-components/README.md) | Human-facing `/components` inventory | — |
