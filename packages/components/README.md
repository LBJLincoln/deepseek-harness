# components/ — every addressable unit of a composition

English | [中文](README.zh.md)

One registry for what a composition contains and how a model reaches each part: plugins and plugin-provided members carry a stable id, a kind, provenance, lineage, membership, and a callable route. Producers are adapters that mirror one seam's live registry; consumers read the inventory for humans, models, and the seams that score components.

| Package | Role | ctx key |
|---|---|---|
| [`components/`](components/README.md) | Component registry: descriptors, kinds, lineage, callable routes | `ctx.components` |
| [`components-subagents/`](components-subagents/README.md) | Mirrors subagent providers as `agent-provider` components | — |
| [`command-components/`](command-components/README.md) | Human-facing `/components` inventory | — |
