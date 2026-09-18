# Agent Note: Interleaved experiment arms

Status: implemented

English | [中文](2026-09-18-interleaved-experiment-arms.zh.md)

## Problem

An experiment ran its baseline arm to completion and then its candidate arm, as two `ctx.fleet.run` calls over the same environments and repetition indexes. The pairing that follows removes environment variance, because a repetition enters the statistics only when both arms reported it, but it cannot remove what changed between the two calls: on a shared subscription, queueing, available capacity, and the build behind a model route all move within a day, and every such move lands entirely on whichever arm ran second. Every experiment recorded under `data/proving-ground/` on 2026-09-08 ran its two arms 30 to 80 minutes apart, so each of those deltas carries an unmeasured arm-versus-hour term, and the [results note](../../proposed/architecture/2026-09-08-hypothesis-program-results.md) queues the slice that removes it.

## Decision

`FleetService.runPaired(first, second)` runs two plans as one batch and returns one report per plan, in the order the plans were given. It validates each plan exactly as `run` does, refuses the pair with `FLEET_INVALID_PLAN` when the two plans select different environments or ask for different repetitions, and orders the cells environment-major, then repetition, then plan, so the two plans' cells of one environment and one repetition are adjacent and both plans draw on the one configured `maxConcurrent` pool. Both entry points prepare a plan, fill one outcome slot per cell, and fold the report off the same record, so each report — its group, its cells in its own plan order, its leaderboard, its spend — its `fleet/cell` events, its route breaker, and its token ceiling are what that plan's own `run` produces. `ExperimentService.run` builds both arms' plans as before and makes one `runPaired` call, so the digest, the arm stamp groups, the fold, `ExperimentResult`, and every stored result's format are unchanged and only when a cell runs is different.

## Alternatives considered

- **Alternate the arms in the experiments service, one fleet call per cell.** Rejected: the group, the ledger's token ceiling and route breaker, the enumeration that gives a cell its repetition index, and the workspace retention are all per plan, so per-cell plans would restart each of them and the arms would lose the per-arm accounting the result states.
- **Run both arms as one fleet plan naming both routes in `models`.** Rejected: one plan carries one group, one implementer, and one ladder, while the arms carry their own of each and are found in the session logs by their own group; the single report would also fold both arms into one leaderboard and one spend, which is not what the fold reads.
- **Randomize the cell order across both arms.** Rejected: a random order removes the confound only in expectation, and two runs of one frozen digest would schedule differently, while the pairwise order is exact, deterministic, and the tightest pairing the design already assumes.
- **Leave the order alone and correct for the hour in the fold.** Rejected: the fold would need a model of provider drift that nothing measures, and the cheaper fix is to stop creating the term.

## Consequences

An arm is no longer confounded with the hour it ran in: a provider-side change between the start and the end of a batch now lands on both arms, and the paired delta measures the arms. A paired run holds no more cells in flight than a single run does, because both plans share the one pool, and a pair whose plans disagree is refused before either plan runs a cell, so an experiment is never half spent on a mismatch. `run` is unchanged for its other caller, the shift driver, which runs one plan per slot. A plan that names several routes has its cells started in the paired order rather than route-major, which is what the pairing trades for; the report still lists them in plan order.

## Testing

The fleet package tests cover the pairwise order of two plans' cells, each report deep-equal to what two separate `run` calls produce on the same stub script, the refusals of a mismatched pair before any cell runs, one bounded pool across both plans with the two cells of a pair in flight together, and a route breaker and a token ceiling that stay per plan. The experiments package test asserts one paired call per experiment and a result equal to folding two separately built stub reports. The keyless experiment e2e runs both arms through a real composition at `maxConcurrent: 2`.
