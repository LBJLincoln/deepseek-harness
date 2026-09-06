# @deepseek-ai/dsh-fleet

English | [中文](README.zh.md)

Fleet runs: the deterministic spine of the harness capability program. A plan names environments, model routes, and a repetition count; the fleet runs every environment × model × repetition cell through the environment runner in its own fresh workspace, keeps every cell's report or failure in plan order, and folds a leaderboard with one row per model route and environment. Rows are never averaged across isolation levels or across the held-out split; both stay columns a consumer partitions by. The [four-goal-workflows Agent Note](../../../.agents/notes/proposed/architecture/2026-09-05-four-goal-workflows.md) owns the design rationale.

## Config

```yaml
- id: environments
  name: '@deepseek-ai/dsh-environments'
- id: agent-default-model
  name: '@deepseek-ai/dsh-agent-default-model'
  config:
    provider: deepseek-official
    model: deepseek-v4-flash
- id: environment-runner
  name: '@deepseek-ai/dsh-environment-runner'
  config:
    isolation: none
- id: fleet
  name: '@deepseek-ai/dsh-fleet'
  config:
    maxConcurrent: 4
    routeBreaker:
      consecutiveErrors: 3
    workspaceRetention: remove-certified
```

| Field | Meaning |
|---|---|
| `maxConcurrent` (default `1`) | Cells in flight at the same time; each cell is its own session and workspace directory, so the bound is a budget on agents and check processes, not on correctness. |
| `routeBreaker.consecutiveErrors` (optional) | Consecutive error cells on one model route inside one plan before the fleet stops scheduling that route. Absent keeps scheduling a route however often it fails, so a provider outage spends the whole plan on it. |
| `workspaceRetention` (required) | `keep`, `remove-certified`, or `remove-all`: what happens to each cell's `cell-*` directory once its outcome is recorded. The session log, not the checkout, is the record, so a long-running deployment states how much of the checkout it keeps for inspection. |

The service requires `environments`, `environmentRuns`, and `agentDefaultModel`. `resolveConfig(config)` is the exported defaulting step.

## Service contract

`ctx.fleet.run(plan)` takes `environments` (`{ ids }` in the given order, or `{ filter }` resolved against the registry in registration order), `models` (an empty list runs the composition's default route from `agentDefaultModel`), an optional `implementer` every cell is run by, a positive integer `repetitions`, an optional exact `cells` selection, an existing absolute `workspaceRoot`, an optional `group`, an optional `district`, an optional `policyVersion`, an optional base `seed`, an optional positive integer `tokenCeiling`, and an optional `signal`. It rejects with `FleetError` before running any cell: `FLEET_INVALID_PLAN` for a non-positive or fractional `repetitions` or `tokenCeiling`, a `seed` that is not a safe non-negative integer, an id the registry does not hold, or a `cells` selection that is empty or names a cell the plan does not enumerate; `FLEET_EMPTY_PLAN` when the environment selection matches nothing.

## Policy version and the base seed

`policyVersion` names the checkpoint or policy the plan's routes serve; every cell's run stamp carries it verbatim, so a fold can key measured difficulty by it. `seed` is the plan's **base** seed and each cell runs with `seed + repetition`, so one repetition index means one seed across every route and every environment of the plan — which is what lets a paired design compare like with like. The base is validated once, at the plan boundary, because the arithmetic is the fleet's: a base the runner would refuse must not surface as every cell failing separately. A seed records what a run asked for, never what a provider did with it; the [runner README](../environment-runner/README.md#sampling-and-what-a-replay-reproduces) owns what a replay can and cannot reproduce.

Cells are enumerated environment-major, then model, then repetition from `0`, and run through `ctx.environmentRuns.run` with at most `maxConcurrent` in flight. A plan that names `cells` runs only those, still in plan order, so a driver resuming a partly run plan keeps every cell's environment, route, and repetition index instead of restating them as a smaller plan whose repetition indexes would start again at zero. `fleetCellKey(cell)` is the identity a consumer indexes cells by, inside the ledger it keeps or against the run stamps already in the session logs. Each cell gets a fresh `cell-*` directory under `workspaceRoot` and carries the plan's `group` (or a minted `fleet-<uuid>`), its repetition index, and the plan's `district` into the run stamp, so every session of the batch is grouped durably in its own log. A cell whose run throws is kept as `{ cell, error }` with the harness error code when the error had one; the fleet run itself never fails because of one cell.

Two conditions refuse a cell before it starts, so every plan keeps a row for every cell and the runs and errors columns stay honest. Once one model route has produced `routeBreaker.consecutiveErrors` error outcomes in a row, its remaining cells are recorded as `FLEET_ROUTE_BREAKER_OPEN` errors naming the route and the count; a reported cell resets that route's count, and the breaker is per plan. Once the reports in hand sum past `tokenCeiling` input plus output tokens, every cell that has not started is recorded as a `FLEET_TOKEN_CEILING_REACHED` error, while the cells already in flight complete. A refused cell mints no workspace and folds into neither the breaker nor the spend.

`implementer` is forwarded verbatim to every cell, so one plan is one implementer and the row folded from it never mixes two: `{ kind: 'route' }` (the default) runs each cell on its own model route, while `{ kind: 'subagent', provider, label? }` delegates every attempt of every cell to that registered subagent provider. The [runner README](../environment-runner/README.md#the-two-implementers) owns what a delegated certificate proves and which providers an isolation claim above `none` refuses.

The report carries the `group`, every cell outcome in plan order, the `spend` (`inputTokens` and `outputTokens` of the whole run), and the `leaderboard`: per model route and environment, the environment kind and `heldOut` flag, the `isolation` the runs declared and the `implementer` they were stamped with (both absent when every cell of the row failed before a run), `runs`, `errors`, `certified`, `certificateRate`, `attemptsMean`, and the summed `inputTokens` and `outputTokens`. `leaderboardMarkdown(report)` renders the same rows as one Markdown table for people; the report stays the record and the session logs stay the authority.

Workspace retention runs once a cell's outcome is in hand: `remove-certified` removes the `cell-*` directory of a cell whose run certified, `remove-all` removes it whether the cell reported or failed, and `keep` removes nothing.

## The `fleet/cell` event

Right after a cell's outcome is recorded and its retention has run, the fleet emits the observe-only Cordis event `fleet/cell` with the plan's `group`, its `district` when it has one, the `cell`, and an `outcome` of `reported` with the runner's `sessionId` and `certified` flag or `error` with the failing code and message. One event per cell, in settle order — which equals plan order only while `maxConcurrent` is `1`. A listener cannot change the outcome and its failure is contained, so an observer such as [the shift driver](../shifts/README.md) writes its own per-cell record without holding this report; the [Cordis catalog](../../../docs/subsystems/improvement.md#cordis-surface) carries the declaration.

## Model Experience

None, as the fleet only schedules environment runs; the environment runner owns every model-visible effect of each cell, and nothing the fleet holds enters a model request.

#### KV Cache effect

None; the fleet neither adds to nor changes any model request.

## Known Limitations and Deferred Work

- **The leaderboard is a fold of one fleet run** — cross-run comparison, paired designs across variants, and confidence intervals read the `environment/run` stamps and certificates from the session logs; this package folds only the reports it just produced.
- **Sampling is by repetition count** — group sampling with early stop, per-cell budgets, and retry policies are the caller's until a policy plugin exists.
- **The ceiling and the breaker are per plan** — both start fresh on every `run()` call, so a shift that spans several plans folds its own spend and its own route health across them.
- **A cell error carries only code and message** — the thrown error's stack and cause stay in the process, and a cell that failed before its run leaves no session; a cell that ran has every attempt as a `verification/run` event in its own session log, which is where a cross-run fold reads run evidence from.
