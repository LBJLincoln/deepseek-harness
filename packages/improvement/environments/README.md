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

`ctx.environments.register(definition)` stores one `EnvironmentDefinition` and returns the exact disposer that removes that registration and no later one under the same id. It throws `EnvironmentError` with code `ENVIRONMENT_DUPLICATE_ID` for a registered id, `ENVIRONMENT_NO_CHECKS` for an empty check list, `ENVIRONMENT_DUPLICATE_CHECK` when two checks share an id, and `ENVIRONMENT_INVALID_IMMUTABLE` for a declared immutable path that is not workspace-relative and normalized. Registrations are effects: a producer keeps the disposer under its own fiber so disposal removes the environment. `get(id)` and `list(filter?)` return detached copies in registration order; `filter` selects by `kind` and by `heldOut`, and a caller cannot mutate stored check lists or immutable sets through the returned values.

A definition carries a branded `EnvironmentId`, a `kind` from the merge-extensible `EnvironmentKindMap` (each producer declares its kind and detail type by declaration merging on `@deepseek-ai/dsh-environments/types`; this package declares none), `name`, `description`, the `task` (`prompt`, an optional workspace `fixture`, and an optional `immutable` set), the `checks` a validator authors the task's completion standard from, the `heldOut` flag, the owning package, `provenance` (`curated` or `synthesized`), an optional `lineage` parent id, and kind-specific `detail`.

## The immutable set

`task.immutable` lists the workspace-relative paths the fixture supplies and the implementer must not author — the tests, the reference outputs, and any overlaid check script. Each entry is a `/`-separated relative path with no empty, `.`, or `..` segment, no backslash, and no drive prefix, naming either a file or a directory tree; duplicates and every other form are refused at registration, because the check-owned set decides whether a run counts and a path the registry cannot resolve must not reach the run that would measure it. The [environment runner](../environment-runner/README.md) digests these paths beside the validator's own directory before the first turn and again at each validation, and records an attempt that changed them as `tampered`.

## Run stamp

The `environment/run` session event is the durable link from a session to the environment it ran. The runner appends one `EnvironmentRunStamp` before the run's first turn: the environment id and kind, the `heldOut` flag, the content hashes, the zero-based `repetition` and optional `group` of the run inside its batch, the optional `district` the run belongs to, the model route, and the isolation the deployment declared. `environmentContentHashes(environment, fixtureSha256?)` computes the prompt, check-inventory, and combined `contentSha256` digests deterministically; the combined digest is the decontamination key a curator compares against held-out environments. `decodeEnvironmentRun(value)` validates a durable payload at the log boundary: unrelated values return `undefined`, a malformed stamp throws, so a fold never reads a partial stamp.

## Extension points

Producers register environments from curated suites or from synthesis; consumers are the environment runner that mounts a task as a session and writes the run stamp, the trajectory exporter that reads the stamp to attribute sessions and withhold held-out ones and the districts a deployment withholds, and the component registry adapter that lists environments as components.

## Model Experience

None, as the registry holds composition-time task definitions and registers nothing model-facing; the runner that mounts an environment owns every model-visible effect.

#### KV Cache effect

None; the registry neither adds to nor changes any model request.

## Known Limitations and Deferred Work

- **Executes nothing** — the environment runner (`@deepseek-ai/dsh-environment-runner`) mounts an environment as a session, authors the standard from `checks`, executes them, and writes the run stamp; this package only holds the vocabulary.
- **Fixture is a path the runner resolves** — `task.fixture` names an absolute directory the runner overlays and hashes; the registry does not verify that it exists.
- **No registration events** — adapters and observers cannot yet follow registrations; the stamp records what ran, not what was registered.
- **Kinds arrive with producers** — a program with no producer composed sees `EnvironmentKind` as `string` and an empty inventory.
