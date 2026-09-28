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

The service requires `environments`, `environmentRuns`, `agentDefaultModel`, and `llm`. `resolveConfig(config)` is the exported defaulting step.

## Service contract

`ctx.fleet.run(plan)` takes `environments` (`{ ids }` in the given order, or `{ filter }` resolved against the registry in registration order), `models` (an empty list runs the composition's default route from `agentDefaultModel` under no preset), each entry a model route each cell's FIRST attempt runs on plus an optional agent `preset` its cells compose from, an optional `ladder` of one rung per attempt, an optional `implementer` every cell is run by, a positive integer `repetitions`, an optional exact `cells` selection, an existing absolute `workspaceRoot`, an optional `group`, an optional `district`, an optional `policyVersion`, an optional base `seed`, an optional positive integer `tokenCeiling`, and an optional `signal`. It rejects with `FleetError` before running any cell: `FLEET_INVALID_PLAN` for a non-positive or fractional `repetitions` or `tokenCeiling`, a `seed` that is not a safe non-negative integer, a `ladder` with no rung, an id the registry does not hold, or a `cells` selection that is empty or names a cell the plan does not enumerate; `FLEET_EMPTY_PLAN` when the environment selection matches nothing.

`ctx.fleet.runPaired(first, second)` runs two plans as one batch and returns one report per plan, in the order the plans were given. Both plans are validated exactly as `run` validates one, and the pair itself is refused with `FLEET_INVALID_PLAN` when the two plans select different environments or ask for different repetitions — before either plan runs a cell, so a pair is never half spent. The batch runs environment-major, then repetition, then plan, so the two plans' cells of one environment and one repetition are adjacent, and both plans draw on the one `maxConcurrent` pool: at `maxConcurrent: 2` the two cells of a pair run at the same time. That is what keeps a plan from being confounded with the hour it ran in, which two `run` calls in a row cannot avoid. Each plan keeps its own group, district, ledger, and workspace retention, so each report — its group, its cells in its own plan order, its leaderboard, its spend — its `fleet/cell` events, its route breaker, and its token ceiling are what that plan's own `run` produces; only [a route limit](#a-route-limit-stops-the-route) is shared, stopping both plans at once.

## Policy version and the base seed

`policyVersion` names the checkpoint or policy the plan's routes serve; every cell's run stamp carries it verbatim, so a fold can key measured difficulty by it. `seed` is the plan's **base** seed and each cell runs with `seed + repetition`, so one repetition index means one seed across every route and every environment of the plan — which is what lets a paired design compare like with like. The base is validated once, at the plan boundary, because the arithmetic is the fleet's: a base the runner would refuse must not surface as every cell failing separately. A seed records what a run asked for, never what a provider did with it; the [runner README](../environment-runner/README.md#sampling-and-what-a-replay-reproduces) owns what a replay can and cannot reproduce.

Cells are enumerated environment-major, then model entry, then repetition from `0`, and run through `ctx.environmentRuns.run` with at most `maxConcurrent` in flight. A plan that names `cells` runs only those, still in plan order, so a driver resuming a partly run plan keeps every cell's environment, route, and repetition index instead of restating them as a smaller plan whose repetition indexes would start again at zero. `fleetCellKey(cell)` is the identity a consumer indexes cells by, inside the ledger it keeps or against the run stamps already in the session logs; it names the entry's agent preset only where the entry carries one, so a ledger written for a plan without presets still matches the plan it recorded. Each cell gets a fresh `cell-*` directory under `workspaceRoot` and carries the plan's `group` (or a minted `fleet-<uuid>`), its repetition index, and the plan's `district` into the run stamp, so every session of the batch is grouped durably in its own log. Every cell workspace is a sibling of every other under `workspaceRoot`, beside whatever the driver writes there, so the runner denies each cell everything above its own workspace for the length of its run ([`dsh-environment-runner`](../environment-runner/README.md)). A cell whose run throws is kept as `{ cell, error }` with the harness error code when the error had one; the fleet run itself never fails because of one cell.

Three conditions refuse a cell before it starts, so every plan keeps a row for every cell and the runs and errors columns stay honest. Once [a route's limit](#a-route-limit-stops-the-route) has ended one cell, every later cell of that route is recorded as a `FLEET_ROUTE_LIMIT_REACHED` error naming the route, the provider's own words, and the reset. Once one model route has produced `routeBreaker.consecutiveErrors` error outcomes in a row, its remaining cells are recorded as `FLEET_ROUTE_BREAKER_OPEN` errors naming the route and the count; a reported cell resets that route's count, and the breaker is per plan. Once the reports in hand sum past `tokenCeiling` input plus output tokens, every cell that has not started is recorded as a `FLEET_TOKEN_CEILING_REACHED` error, while the cells already in flight complete. A refused cell mints no workspace and folds into neither the breaker nor the spend; the limit is checked first, then the ceiling, then the breaker.

`ladder` is forwarded verbatim to every cell, so one plan is one ladder: attempt `i` of every cell runs on `ladder[i - 1].model` or on the cell's own route when that rung names none, and the ladder's length is each cell's attempt bound. A rung's `share` and `selfReview` ride through unchanged, and the leaderboard's ladder column renders a rung that asked for the specification review as `route @share +review` and one that asked for the probe review as `route @share +probe`. The rung ceiling belongs to the runner's config, so a ladder longer than it fails each cell rather than the plan; only a ladder with no rung at all is refused here, once, because that one is arithmetic no cell could complete. The [runner README](../environment-runner/README.md#the-attempt-ladder) owns what a rung means and how each implementer changes route.

An entry's `preset` is forwarded to the cells of that entry alone, so one plan may compare two agent compositions over one route: two entries naming one route and two presets are two arms, and the cell key, the leaderboard row, and the run stamp all keep them apart. Each distinct preset is preflighted once through `ctx.environmentRuns.checkPreset` before the first cell — the roster re-reads its roots on every resolution, so asking per cell would put one directory scan on each of them — and the runner's `EnvironmentRunError` propagates unchanged. The [runner README](../environment-runner/README.md#the-agent-preset-a-cell-composes-from) owns what the mount does and how each cell records it.

`implementer` is forwarded verbatim to every cell, so one plan is one implementer and the row folded from it never mixes two: `{ kind: 'route' }` (the default) runs each cell on its own model route, while `{ kind: 'subagent', provider, label? }` delegates every attempt of every cell to that registered subagent provider. The [runner README](../environment-runner/README.md#the-two-implementers) owns what a delegated certificate proves and which providers an isolation claim above `none` refuses.

The plan's implementer is checked through `ctx.environmentRuns.checkImplementer` before any cell is enumerated and before any workspace is minted, against every route the plan names — the plan's first ladder rung where it names a model, else each of the plan's own routes, which is what the runner stamps each cell with. The runner's `EnvironmentRunError` propagates unchanged, so a provider the composition does not hold refuses the plan instead of every cell of it: a plan of error cells spends the whole run to produce a leaderboard whose rows nothing ran.

Each route is checked there too, through [`ctx.llm.checkRoute`](../../llm/llm/README.md#public-api), which is why `llm` is an injection of this service rather than an optional seam. Every route a cell of the plan could run on is asked about once: the plan's own routes and each ladder rung naming another one. A route the composition does not hold, or one whose credential reference resolves to nothing, otherwise refuses every cell at that cell's first model request — after the workspace, the session, the stamp, and the goal already exist — which is the same plan of error cells the implementer check prevents. The seam's `LlmError` propagates unchanged, naming the route and, for a missing key, the credential reference; the check reaches no network, so it says nothing about whether the endpoint answers or the model id exists. A paired run prepares both plans this way before either plan's first cell, so an unreachable route in the second still refuses both.

The report carries the `group`, every cell outcome in plan order, the `spend` (`inputTokens` and `outputTokens` of the whole run), the `routeLimits` [a limit stopped](#a-route-limit-stops-the-route) (empty for a run no route refused), and the `leaderboard`: per model route and environment, the environment kind and `heldOut` flag, the `ladder` the runs escalated over, the `isolation` the runs declared and the `implementer` they were stamped with (all three absent when every cell of the row failed before a run, and the ladder also absent for a plan that named none), the `preset` the row's entry named (absent for an entry that named none, and stated even for a row whose cells all failed before a run, because it comes from the plan rather than from a report), `runs`, `errors`, `certified`, `certificateRate`, `attemptsMean`, and the summed `inputTokens` and `outputTokens`. `leaderboardMarkdown(report)` renders the same rows as one Markdown table for people; the report stays the record and the session logs stay the authority.

Workspace retention runs once a cell's outcome is in hand: `remove-certified` removes the `cell-*` directory of a cell whose run certified, `remove-all` removes it whether the cell reported or failed, and `keep` removes nothing.

## A route limit stops the route

A provider that refuses to serve until its own state changes — a subscription's usage window spent, a balance exhausted — refuses every cell of its route until then, so counting those cells as failed certificates would publish a measurement of the wall rather than of the model. [The runner](../environment-runner/README.md#a-route-limit-ends-the-run) ends such a cell with `ENVIRONMENT_RUN_ROUTE_LIMIT` instead of validating it, and the fleet keeps that cell as its error outcome exactly as any thrown cell; what the first such cell also does is wall its route. From then on every cell of the route that has not started is refused as `FLEET_ROUTE_LIMIT_REACHED`, before any workspace is minted, whatever `routeBreaker` says and however many cells the route had reported before: the breaker counts consecutive errors because an outage may pass, while a limit states that nothing on the route can succeed until the stated instant. Other routes keep running. Cells of the walled route already in flight finish on their own and are recorded as they end, which for a cell on a spent route is the same refusal.

The report names every walled route once under `routeLimits`, in the order the walls were hit — `{ provider, model, code, message, resetsAt? }`, the failure's seam code (`QUOTA`) and the provider's own words for the refusal, and the epoch instant the route stated its limit lifts when it stated one — so a driver exits non-zero naming the route and the reset ([the bench drivers](../../../examples/headless-agent/tests/fixtures/proving-ground-bench/fleet-driver.ts) do, and the `bench loop` ledger carries the same clause) instead of recording a plan the wall cut short as a measurement. The leaderboard's `runs`, `certified`, and `certificateRate` count neither the cut cell nor the refused ones; both sit in `errors`. The fleet neither waits for the reset nor resumes the refused cells: a driver that wants them measured names them in a later plan's `cells` after the instant `resetsAt` states.

A paired run shares one set of walls between its two plans and, once any route of either plan is walled, starts no later cell of either plan — the partner's refused cells say so in their message, `its pair's route … stopped at its limit` — because a pair with a refused side measures nothing, and both reports carry the same `routeLimits`. That is the one state a paired run does not keep per plan; the breaker and the ceiling stay per plan as before.

## The `fleet/cell` event

Right after a cell's outcome is recorded and its retention has run, the fleet emits the observe-only Cordis event `fleet/cell` with the plan's `group`, its `district` when it has one, the `cell`, and an `outcome` of `reported` with the runner's `sessionId` and `certified` flag or `error` with the failing code and message. One event per cell, in settle order — which equals plan order only while `maxConcurrent` is `1`, and which alternates between the two plans of a paired run, each event carrying its own plan's group and district. A listener cannot change the outcome and its failure is contained, so an observer such as [the shift driver](../shifts/README.md) writes its own per-cell record without holding this report; the [Cordis catalog](../../../docs/subsystems/improvement.md#cordis-surface) carries the declaration.

## Model Experience

None, as the fleet only schedules environment runs; the environment runner owns every model-visible effect of each cell, and nothing the fleet holds enters a model request.

#### KV Cache effect

None; the fleet neither adds to nor changes any model request.

## Known Limitations and Deferred Work

- **The leaderboard is a fold of one fleet run** — cross-run comparison, paired designs across variants, and confidence intervals read the `environment/run` stamps and certificates from the session logs; this package folds only the reports it just produced.
- **Sampling is by repetition count** — group sampling with early stop, per-cell budgets, and retry policies are the caller's until a policy plugin exists.
- **The ceiling, the breaker, and the route walls are per run** — all start fresh on every `run()` or `runPaired()` call, so a shift that spans several plans folds its own spend and its own route health across them, and a plan started after a wall was hit runs the walled route again until the provider refuses it once more.
- **A walled route is not resumed** — the report states when the route said its limit lifts, but the fleet neither waits for that instant nor reschedules the refused cells; a driver names them in a later plan's `cells`.
- **A cell error carries only code and message** — the thrown error's stack and cause stay in the process, and a cell that failed before its run leaves no session; a cell that ran has every attempt as a `verification/run` event in its own session log, which is where a cross-run fold reads run evidence from.
