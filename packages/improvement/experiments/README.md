# @deepseek-ai/dsh-experiments

English | [中文](README.zh.md)

A frozen, paired, budgeted comparison of two arms. A plan names the environments, the repetition count, and the two arms — each a model route and who implements its cells; a content digest freezes it before any cell runs; both arms run through `ctx.fleet` at the same repetition indexes under stamp groups derived from that digest; and the paired certificate-rate delta comes back with a bootstrap confidence interval, the caps both arms ran under, and a `promote` / `reject` / `inconclusive` verdict. Nothing here calls a model. The [experiments](../../../.agents/notes/proposed/architecture/2026-09-05-experiments.md) and [budget-parity](../../../.agents/notes/proposed/architecture/2026-09-08-budget-parity-for-delegated-cells.md) Agent Notes own the design rationale.

## Config

```yaml
- id: environments
  name: '@deepseek-ai/dsh-environments'
- id: environment-runner
  name: '@deepseek-ai/dsh-environment-runner'
  config:
    isolation: none
- id: fleet
  name: '@deepseek-ai/dsh-fleet'
  config:
    maxConcurrent: 4
- id: experiments
  name: '@deepseek-ai/dsh-experiments'
  config:
    bootstrapResamples: 2000
    confidenceLevel: 0.95
    minimumDelta: 0.05
    cellTokenCap: 200000
    tokenBudget: 20000000
```

| Key | Default | Meaning |
|---|---|---|
| `bootstrapResamples` | `1000` | Resamples drawn per interval. Below convergence the interval still moves with the digest; raising it narrows that movement at linear cost. |
| `confidenceLevel` | `0.95` | Coverage of every reported interval. |
| `minimumDelta` | `0` | Certificate-rate delta the overall interval's lower bound must exceed to promote. |
| `cellTokenCap` | none | Tokens one cell may spend. Required: it is what the plan's projection multiplies. |
| `tokenBudget` | none | Tokens one plan's projection may reach. Required: a plan projecting more is refused before it starts. |

The service requires `environments` and `fleet`. `resolveConfig(config)` is the exported defaulting step; it returns the four `thresholds` the plan digest freezes beside the `tokenBudget`, which stays outside the digest because it bounds what a deployment pays for rather than what the comparison measures.

## Service contract

`ctx.experiments.run(plan)` takes `environments` (registered ids, each named once), a positive integer `repetitions`, the `baseline` and `candidate` arms, an existing absolute `workspaceRoot`, and optionally a `policyVersion` both arms' routes serve, a base `seed`, a `digest` the caller froze earlier, a `signal`, and a `sink`.

Each arm is a model route — `provider` and `model` — and an optional `implementer`, the same value a fleet plan takes: `{ kind: 'route' }`, which an arm naming none runs, has every attempt of every cell of that arm driven on the arm's own route, while `{ kind: 'subagent', provider, label? }` delegates each attempt to that registered subagent provider. The [runner README](../environment-runner/README.md#the-two-implementers) owns what a delegated certificate proves and which providers an isolation claim above `none` refuses. Nothing here re-validates the provider: an implementer the composition cannot honor fails every cell of its arm through the runner, so every repetition of that arm goes unpaired and the verdict is `inconclusive`.

It rejects with `ExperimentError` before running any cell: `EXPERIMENT_INVALID_PLAN` for a non-positive or fractional `repetitions`, a `seed` that is not a safe non-negative integer, an empty environment list, an id named twice, or an id the registry does not hold; `EXPERIMENT_UNEQUAL_CAPS` when the two arms would run their cells under different caps; `EXPERIMENT_PLAN_NOT_FROZEN` when a declared `digest` differs from the recomputed one; `EXPERIMENT_OVER_BUDGET` when `environments × repetitions × 2 × cellTokenCap` exceeds `tokenBudget`.

Both arms are forwarded the same `policyVersion` and the same base `seed`, and each arm's cell samples with `seed + repetition`, so the paired repetitions of the two arms differ only in the arm itself, its route and its implementer — the [fleet README](../fleet/README.md#policy-version-and-the-base-seed) owns the arithmetic and the [runner README](../environment-runner/README.md#sampling-and-what-a-replay-reproduces) what a replay reproduces.

Both arms then run as two `ctx.fleet.run` calls over the same ids at the same repetition count, baseline first, each carrying its own arm's route and implementer. A cell the fleet kept as an error leaves its repetition unpaired rather than failing the experiment. The result is written to `sink` as one JSON line and the sink is closed exactly once; the sink is the trajectory exporter's `TrajectorySink`, so `jsonlFileSink(path)` from `@deepseek-ai/dsh-trajectories` serves both exports.

The result restates each arm beside its stamp group: `arms.baseline` and `arms.candidate` carry the `model` route and the `implementer` the arm ran under, with an omitted one stated as `{ kind: 'route' }`, so a stored result tells a harness-native arm from a delegated one without the plan that produced it. `caps` states the ceilings every cell of both arms ran under, in cap evaluation order, so a reader of a stored result sees the budget the comparison was measured inside without finding the composition behind it.

### The arms run under one budget

A cell stopped at one wall or token ceiling measures something different from the same cell stopped at another, so two arms bounded differently compare the ceilings as much as the arms. `ctx.environmentRuns.cellCaps` answers what one cell of an arm runs under — [the runner README](../environment-runner/README.md#the-budget-a-delegated-attempt-runs-under) owns how a delegated cell is bounded and which cap it can lose — and a plan whose two arms resolve to different lists is refused with `EXPERIMENT_UNEQUAL_CAPS` before either arm starts. The refusal spends nothing, which is the point: the arms would otherwise run in full to produce a comparison a reader must then discount.

`foldExperiment(request)` is the pure fold behind the run and is exported for tests and offline tools, together with `planDigest`, `capsAgree`, `describeCaps`, `experimentGroup`, `parseExperimentGroup`, `projectedTokens`, `EXPERIMENT_ARM_ROLES`, `EXPERIMENT_GROUP_PREFIX`, and the `bootstrapIntervals` pass.

## Freezing and the group scheme

`planDigest(plan, thresholds, caps)` is the SHA-256 hex digest over a format version, the two arms in role order — each its model route and its implementer — the environment ids **sorted**, the repetition count, the `policyVersion` and base `seed`, the four thresholds, and the caps both arms agreed on. Sorting makes the digest independent of the order a caller listed the ids in; the workspace root, the abort signal, and the sink are not digested because they change nothing the comparison measures. The policy version and the seed are digested because both arms' sessions are found in the logs by the groups the digest mints, so two comparisons that differ in either must not collide on one group. The caps are digested because they decide when a cell stops; the deployment's `tokenBudget` stays outside, because it bounds what a deployment pays for across plans rather than what one comparison measures.

An arm's implementer enters the digest as the default `{ kind: 'route' }` when the arm names none, so a plan that omits the field and one that spells it out are one experiment; a delegated arm digests its subagent provider and label, in fixed positions that the key order a caller wrote cannot change. Which arm delegates is part of the identity, because the roles are digested in order.

Each arm runs under the stamp `group` `experiment-<digest>-baseline` or `experiment-<digest>-candidate`, which the environment runner writes into the `environment/run` event of every session of that arm before its first turn. That group is the durable link from a result back to its sessions: `ctx.scorekeeper.leaderboard({ group })` selects one arm out of every persisted log, and the trajectory export carries the same string. The `experiment-` prefix is this package's reserved namespace, and the package invariant rejects a stamp that claims it without a 64-hex digest and a known arm role.

## Statistics and verdict

A repetition pairs when both arms reported it. Per environment the result states `pairs`, `unpaired`, the `baselineRate` and `candidateRate` over the paired repetitions, their `delta`, the mean `attemptsDelta`, and the summed `inputTokenDelta` and `outputTokenDelta`; the overall `delta` is the mean over every paired repetition of every environment.

Each interval is a percentile bootstrap over the paired deltas: a resample draws, within every environment, as many paired deltas as that environment holds, with replacement, and the overall statistic of a resample is the mean over every drawn delta, so an environment weighs by its paired count and an environment with no pair contributes nothing rather than a zero. Every draw comes from a mulberry32 generator seeded with the 32-bit FNV-1a hash of `<digest>:<environmentId>`, so the same frozen plan over the same certificates replays to the same interval in any process; a fold with no pair at all reports no interval.

The verdict reads the overall interval: `promote` when its lower bound exceeds `minimumDelta`, `reject` when its upper bound is below zero, `inconclusive` otherwise — including when nothing paired. `promote` is tested first, so a negative `minimumDelta` still promotes rather than producing an order-dependent answer.

## Model Experience

None, as an experiment schedules fleet runs and folds their reports; the environment runner owns every model-visible effect of each cell.

#### KV Cache effect

None; the service neither adds to nor changes any model request.

## Known Limitations and Deferred Work

- **A preset cannot be an arm** — an arm names a model route and an implementer, and `EnvironmentRunRequest` carries no agent preset, so two compositions over one route stay incomparable until the runner and the fleet cell carry one; the plan gains an optional preset per arm with that field, never before.
- **A delegated arm reports no tokens** — an external implementer spends in another product, so its cells carry no `usage`: the `spend` and the token deltas measure the harness-native side alone, while the projection still reserves `cellTokenCap` for every cell of both arms. What the child reported spending bounds the cell through its `usage/foreign` record, but this fold does not read it.
- **The arms run in sequence** — baseline completes before candidate starts, so a provider-side drift between them lands entirely on the candidate. Interleaving both routes in one fleet call yields the same pairs and stays available to a caller.
- **Paired repetition indexes are not paired seeds** — the `environment/run` stamp carries no seed, so pairing removes environment variance but not run-to-run variance.
- **The plan's token budget is projected, not enforced** — the refusal multiplies `cellTokenCap` by the cell count, while what a cell actually spends is capped by [the budget policy](../../guard/budget-policy/README.md) whose caps `caps` states. The two are independent numbers: nothing writes a plan's `cellTokenCap` into the per-cell policy, so a plan can project less than its cells are allowed to spend.
- **The digest freezes the plan, not the world** — the harness commit, the environment content hashes, and the provider's model version behind a route are outside it, so two runs of one digest are comparable only under an unchanged harness and registry.
- **No ladder and no archive** — one plan runs one stage; the staged evaluation ladder, the variant archive, and cells derived from diagnosis evidence are named by the [four-goal-workflows note](../../../.agents/notes/proposed/architecture/2026-09-05-four-goal-workflows.md) and live outside this package.
