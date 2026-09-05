# @deepseek-ai/dsh-environments

English | [中文](README.zh.md)

Environment registry: the composition-time inventory of tasks with executable verifiers. Each environment declares a task statement and fixture, its checks in the verification seam's completion-standard vocabulary, whether it is held out for evaluation, its owner, and its provenance. The registry executes nothing; the [trajectory-export Agent Note](../../../.agents/notes/proposed/architecture/2026-09-05-trajectory-export-and-environment-registry.md) owns the design rationale.

## Config

```yaml
- id: environments
  name: '@deepseek-ai/dsh-environments'
```

The service takes no configuration; producers and consumers compose beside it.

## Service contract

`ctx.environments.register(definition)` stores one `EnvironmentDefinition` and returns the exact disposer that removes that registration and no later one under the same id. It throws `EnvironmentError` with code `ENVIRONMENT_DUPLICATE_ID` for a registered id, `ENVIRONMENT_NO_CHECKS` for an empty check list, and `ENVIRONMENT_DUPLICATE_CHECK` when two checks share an id. Registrations are effects: a producer keeps the disposer under its own fiber so disposal removes the environment. `get(id)` and `list(filter?)` return detached copies in registration order; `filter` selects by `kind` and by `heldOut`, and a caller cannot mutate stored check lists through the returned values.

A definition carries a branded `EnvironmentId`, a `kind` from the merge-extensible `EnvironmentKindMap` (each producer declares its kind and detail type by declaration merging on `@deepseek-ai/dsh-environments/types`; this package declares none), `name`, `description`, the `task` (`prompt` plus an optional workspace `fixture`), the `checks` a validator authors the task's completion standard from, the `heldOut` flag, the owning package, `provenance` (`curated` or `synthesized`), an optional `lineage` parent id, and kind-specific `detail`.

## Extension points

Producers register environments from curated suites or from synthesis; consumers are the environment runner that mounts a task as a session, the trajectory exporter that filters training data by held-out status, and the component registry adapter that lists environments as components.

## Model Experience

None, as the registry holds composition-time task definitions and registers nothing model-facing; the runner that mounts an environment owns every model-visible effect.

#### KV Cache effect

None; the registry neither adds to nor changes any model request.

## Known Limitations and Deferred Work

- **No runner** — nothing in this package mounts an environment as a session; the runner that authors the completion standard from `checks`, runs the agent, and records the run is the next slice of the improvement seam.
- **Fixture is a name** — `task.fixture` is an identifier the runner resolves; the registry does not verify that it exists.
- **Kinds arrive with producers** — a program with no producer composed sees `EnvironmentKind` as `string` and an empty inventory.
