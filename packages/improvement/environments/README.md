# @deepseek-ai/dsh-environments

English | [中文](README.zh.md)

Environment registry: the composition-time inventory of tasks with executable verifiers. Each environment declares a task statement and fixture, its checks in the verification seam's completion-standard vocabulary, whether it is held out for evaluation, its owner, and its provenance. The registry executes nothing; the [trajectory-export Agent Note](../../../.agents/notes/proposed/architecture/2026-09-05-trajectory-export-and-environment-registry.md) owns the design rationale.

## Config

```yaml
- id: environments
  name: '@deepseek-ai/dsh-environments'
  config:
    nearDuplicate:
      threshold: 0.8
```

| Field | Meaning |
|---|---|
| `nearDuplicate.threshold` (optional) | Word 5-gram Jaccard similarity, between 0 and 1, at which a registration is refused against the opposite side of the held-out split. Absent registers whatever a producer declares. |

Producers and consumers compose beside the service.

## Service contract

`ctx.environments.register(definition)` stores one `EnvironmentDefinition` and returns the exact disposer that removes that registration and no later one under the same id. It throws `EnvironmentError` with code `ENVIRONMENT_DUPLICATE_ID` for a registered id, `ENVIRONMENT_NO_CHECKS` for an empty check list, `ENVIRONMENT_DUPLICATE_CHECK` when two checks share an id, `ENVIRONMENT_INVALID_IMMUTABLE` for a declared immutable path that is not workspace-relative and normalized, `ENVIRONMENT_INVALID_REFERENCE` for a [task reference](#the-reference-directory) that is missing, unanchored, or not a directory inside the fixture, and `ENVIRONMENT_NEAR_DUPLICATE` for a prompt a [configured threshold](#near-duplicate-admission) refuses. Registrations are effects: a producer keeps the disposer under its own fiber so disposal removes the environment. `get(id)` and `list(filter?)` return detached copies in registration order; `filter` selects by `kind` and by `heldOut`, and a caller cannot mutate stored check lists or immutable sets through the returned values.

A definition carries a branded `EnvironmentId`, a `kind` from the merge-extensible `EnvironmentKindMap` (each producer declares its kind and detail type by declaration merging on `@deepseek-ai/dsh-environments/types`; this package declares none), `name`, `description`, the `task` (`prompt`, an optional workspace `fixture`, an optional `immutable` set, and an optional `reference` directory), the `checks` a validator authors the task's completion standard from, the `heldOut` flag, the owning package, `provenance` (`curated` or `synthesized`), an optional `lineage` parent id, and kind-specific `detail`.

## Near-duplicate admission

With `nearDuplicate.threshold` configured, registering a training-eligible environment whose prompt reaches the threshold against any registered held-out environment is refused, and so is a held-out environment that reaches it against a registered training-eligible one: contamination is symmetric, and which side is registered second is an accident of composition order. Similarity is the Jaccard coefficient of word 5-gram shingles over a prompt lower-cased, with each run of non-alphanumeric characters read as one separator and the resulting whitespace collapsed; a prompt shorter than five words contributes its whole word list as one shingle. The refusal names both environment ids, the similarity, and the threshold. Without the config nothing is compared and today's behaviour stands.

`nearestHeldOut(prompt)` returns `{ environment, similarity }` for the closest registered held-out environment, or `undefined` when none is registered. It answers whether or not a threshold is configured, so a curator can score a proposal before paying for a run; it is a floor rather than proof of independence, because shingles catch restatement and miss paraphrase.

## The immutable set

`task.immutable` lists the workspace-relative paths the fixture supplies and the implementer must not author — the tests, the reference outputs, and any overlaid check script. Each entry is a `/`-separated relative path with no empty, `.`, or `..` segment, no backslash, and no drive prefix, naming either a file or a directory tree; duplicates and every other form are refused at registration, because the check-owned set decides whether a run counts and a path the registry cannot resolve must not reach the run that would measure it. The [environment runner](../environment-runner/README.md) digests these paths beside the validator's own directory before the first turn and again at each validation, and records an attempt that changed them as `tampered`.

## The reference directory

`task.reference` names the fixture-relative directory holding the reference program a validator may execute and an implementer may never read. It is a `/`-separated relative path with no empty, `.`, or `..` segment, no backslash, and no drive prefix, and it must resolve to an existing directory inside `task.fixture`; a reference on a task with no fixture, and one the registry cannot resolve, are both refused with `ENVIRONMENT_INVALID_REFERENCE` at registration rather than at the run that could not hide it.

A `recreation` environment must declare one: its completion standard is derived from the reference by [the instrument](../../verification/tool-standard-author/README.md) rather than written by hand, so a `recreation` registration without a reference has nothing to derive from. The registry holds the kind's name because it enforces that rule; the kind itself is declared by the package that produces such environments.

The reference lives under the fixture, so `fixtureSha256` — and through it the decontamination key — covers the reference tree: changing the reference program changes what the environment measures. The [environment runner](../environment-runner/README.md) copies it beneath the barrier root at reservation time and removes it from every workspace overlay.

## Weighted cases

A check may sample the candidate's behaviour instead of reducing to one exit code. Such a check carries the [`cases` reference](../../verification/verification/README.md#weighted-cases) the log records and, beside it, the `caseBodies` the reference digests; the registry stores and detaches both, and the [environment runner](../environment-runner/README.md#weighted-cases-and-the-reservation) writes the bodies into the validator's reservation and runs the candidate once per case. Registration hashes the definition as it stands and validates nothing about the bodies: authorship is the operation that decides whether cases are usable, so a reference that does not describe its bodies fails the run at `completionStandards.author()`, before the implementer's first turn.

## Run stamp

The `environment/run` session event is the durable link from a session to the environment it ran. The runner appends one `EnvironmentRunStamp` before the run's first turn: the environment id and kind, the `heldOut` flag, the content hashes, the zero-based `repetition` and optional `group` of the run inside its batch, the optional `district` the run belongs to, the optional `policyVersion` naming the checkpoint the route served and the optional `seed` the run's requests asked for, the model route of the first attempt and the optional `ladder` of one model route per attempt over it, the isolation the deployment declared, and the optional `implementer` naming who did the work — `ROUTE_IMPLEMENTER` (`route`) for the session's own model route, a subagent provider name for a delegated run, absent in a payload that states neither, which is the route. A seed records the request, not the outcome: providers may ignore it and none promise identical tokens across model or infrastructure versions, so a replay reproduces the session log rather than a fresh sample. `isSeed(value)` is the exported test every producer of a seed shares. `environmentContentHashes(environment, fixtureSha256?)` computes the prompt, check-inventory, and combined `contentSha256` digests deterministically; `checksSha256` covers each check's tree scope, case reference, and case bodies, so changing one case changes the combined digest, which is the decontamination key a curator compares against held-out environments. A check without cases digests exactly the three fields every check has always carried. `decodeEnvironmentRun(value)` validates a durable payload at the log boundary: unrelated values return `undefined`, a malformed stamp throws, so a fold never reads a partial stamp.

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
