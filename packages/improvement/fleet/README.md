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
```

| Field | Meaning |
|---|---|
| `maxConcurrent` (default `1`) | Cells in flight at the same time; each cell is its own session and workspace directory, so the bound is a budget on agents and check processes, not on correctness. |

The service requires `environments`, `environmentRuns`, and `agentDefaultModel`. `resolveConfig(config)` is the exported defaulting step.

## Service contract

`ctx.fleet.run(plan)` takes `environments` (`{ ids }` in the given order, or `{ filter }` resolved against the registry in registration order), `models` (an empty list runs the composition's default route from `agentDefaultModel`), a positive integer `repetitions`, an existing absolute `workspaceRoot`, an optional `group`, and an optional `signal`. It rejects with `FleetError` before running any cell: `FLEET_INVALID_PLAN` for a non-positive or fractional `repetitions` or an id the registry does not hold, `FLEET_EMPTY_PLAN` when the selection matches nothing.

Cells are enumerated environment-major, then model, then repetition from `0`, and run through `ctx.environmentRuns.run` with at most `maxConcurrent` in flight. Each cell gets a fresh `cell-*` directory under `workspaceRoot` and carries the plan's `group` (or a minted `fleet-<uuid>`) and its repetition index into the run stamp, so every session of the batch is grouped durably in its own log. A cell whose run throws is kept as `{ cell, error }` with the harness error code when the error had one; the fleet run itself never fails because of one cell.

The report carries the `group`, every cell outcome in plan order, and the `leaderboard`: per model route and environment, the environment kind and `heldOut` flag, the `isolation` the runs declared (absent when every cell of the row failed before a run), `runs`, `errors`, `certified`, `certificateRate`, `attemptsMean`, and the summed `inputTokens` and `outputTokens`. `leaderboardMarkdown(report)` renders the same rows as one Markdown table for people; the report stays the record and the session logs stay the authority.

## Model Experience

None, as the fleet only schedules environment runs; the environment runner owns every model-visible effect of each cell, and nothing the fleet holds enters a model request.

#### KV Cache effect

None; the fleet neither adds to nor changes any model request.

## Known Limitations and Deferred Work

- **The leaderboard is a fold of one fleet run** — cross-run comparison, paired designs across variants, and confidence intervals read the `environment/run` stamps and certificates from the session logs; this package folds only the reports it just produced.
- **Sampling is by repetition count** — group sampling with early stop, per-cell budgets, and retry policies are the caller's until a policy plugin exists.
- **Workspaces are never removed** — every `cell-*` directory stays under `workspaceRoot` for inspection; a caller that wants a clean root removes it.
- **A cell error carries only code and message** — the thrown error's stack and cause stay in the process; a durable failure record per cell arrives with the `verification/run` event.
