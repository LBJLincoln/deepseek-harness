# components/ — every addressable unit of a composition

English | [中文](README.zh.md)

One registry for what a composition contains and how a model reaches each part: plugins and plugin-provided members carry a stable id, a content address, a kind, provenance, lineage, membership, and a callable route, filed in the global layer or an agent's own. Producers are adapters that mirror one seam's live registry and own their kind's canonical value; consumers read the inventory for humans, models, and the seams that score components.

| Package | Role | ctx key |
|---|---|---|
| [`components/`](components/README.md) | Component registry: descriptors, kinds, lineage, callable routes | `ctx.components` |
| [`components-subagents/`](components-subagents/README.md) | Mirrors subagent providers as `agent-provider` components | — |
| [`command-components/`](command-components/README.md) | Human-facing `/components` inventory | — |
