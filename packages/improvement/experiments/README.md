# @deepseek-ai/dsh-experiments

English | [中文](README.zh.md)

A frozen, paired, budgeted comparison of two arms. A plan names the environments, the repetition count, and the two model routes; a content digest freezes it before any cell runs; both arms run through `ctx.fleet` at the same repetition indexes under stamp groups derived from that digest; and the paired certificate-rate delta comes back with a bootstrap confidence interval and a `promote` / `reject` / `inconclusive` verdict. Nothing here calls a model. The [experiments Agent Note](../../../.agents/notes/proposed/architecture/2026-09-05-experiments.md) owns the design rationale.

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

`ctx.experiments.run(plan)` takes `environments` (registered ids, each named once), a positive integer `repetitions`, the `baseline` and `candidate` model routes, an existing absolute `workspaceRoot`, and optionally a `digest` the caller froze earlier, a `signal`, and a `sink`.

It rejects with `ExperimentError` before running any cell: `EXPERIMENT_INVALID_PLAN` for a non-positive or fractional `repetitions`, an empty environment list, an id named twice, or an id the registry does not hold; `EXPERIMENT_PLAN_NOT_FROZEN` when a declared `digest` differs from the recomputed one; `EXPERIMENT_OVER_BUDGET` when `environments × repetitions × 2 × cellTokenCap` exceeds `tokenBudget`.

Both arms then run as two `ctx.fleet.run` calls over the same ids at the same repetition count, baseline first. A cell the fleet kept as an error leaves its repetition unpaired rather than failing the experiment. The result is written to `sink` as one JSON line and the sink is closed exactly once; the sink is the trajectory exporter's `TrajectorySink`, so `jsonlFileSink(path)` from `@deepseek-ai/dsh-trajectories` serves both exports.

`foldExperiment(request)` is the pure fold behind the run and is exported for tests and offline tools, together with `planDigest`, `experimentGroup`, `parseExperimentGroup`, `projectedTokens`, `EXPERIMENT_ARM_ROLES`, `EXPERIMENT_GROUP_PREFIX`, and the `bootstrapIntervals` pass.

## Freezing and the group scheme

`planDigest(plan, thresholds)` is the SHA-256 hex digest over a format version, the two arm routes in role order, the environment ids **sorted**, the repetition count, and the four thresholds. Sorting makes the digest independent of the order a caller listed the ids in; the workspace root, the abort signal, and the sink are not digested because they change nothing the comparison measures.

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

- **An arm is a model route** — `EnvironmentRunRequest` carries no agent preset, so a preset cannot be an arm until the runner and the fleet cell carry one; the plan gains an optional preset per arm with that field, never before.
- **The arms run in sequence** — baseline completes before candidate starts, so a provider-side drift between them lands entirely on the candidate. Interleaving both routes in one fleet call yields the same pairs and stays available to a caller.
- **Paired repetition indexes are not paired seeds** — the `environment/run` stamp carries no seed, so pairing removes environment variance but not run-to-run variance.
- **The budget is projected, not enforced** — the refusal multiplies `cellTokenCap` by the cell count; capping what a cell actually spends is `@deepseek-ai/dsh-budget-policy`'s job, and wiring the per-cell cap into each cell's policy is not done here.
- **The digest freezes the plan, not the world** — the harness commit, the environment content hashes, and the provider's model version behind a route are outside it, so two runs of one digest are comparable only under an unchanged harness and registry.
- **No ladder and no archive** — one plan runs one stage; the staged evaluation ladder, the variant archive, and cells derived from diagnosis evidence are named by the [four-goal-workflows note](../../../.agents/notes/proposed/architecture/2026-09-05-four-goal-workflows.md) and live outside this package.
