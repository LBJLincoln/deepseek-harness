# Agent Note: Budget parity for delegated cells

Status: proposed

English | [中文](2026-09-08-budget-parity-for-delegated-cells.zh.md)

## Problem

A cell the harness's own loop implements is bounded by [the budget policy](../../../../packages/guard/budget-policy/README.md), which folds the session log on `agent/pre-step`. On the bench's tier 5 that bound held: the composition's `maxWallMs: 1200000` was breached on four cell sessions and the remaining attempts were blocked, each recording `budget/breach {cap: "maxWallMs", measured: 1257380, limit: 1200000}` and two more per cell ([harness-loop sessions](../../../../data/proving-ground/2026-09-08-bench-h1-harness-loop-t5/sessions)).

A cell delegated to an external implementer never reaches `agent/pre-step`, so nothing bounds it. On the same tier the product loop's misses ran 3,459 s, 3,234 s, 2,152 s and 1,918 s over three attempts each and cost up to 5.60 USD per cell ([product-loop sessions](../../../../data/proving-ground/2026-09-08-bench-h1-product-loop-t5/sessions)); the `environment/delegation` events carry the `reportedUsage` and `reportedCostUsd` those figures come from. The composition that ran both arms says so in its own comment: an external implementer's "spend is outside every limit this harness enforces".

Two consequences follow. A delegated arm is unbounded where a route arm is not, so a paired experiment whose arms differ in implementer compares the arms *and* the ceilings — and today nothing refuses such a plan. And a delegated cell that ran out of budget is indistinguishable from one that simply took longer, because the fact that stopped a route cell has no counterpart in the delegated cell's log.

## Proposal

### One home for the caps

The budget policy publishes `ctx.sessionBudgets`, the smallest Service Definition that answers what a session runs under and enforces it:

- `configuredCaps()` — the deployment's enforced caps, in cap evaluation order.
- `capsFor(session)` — those caps tightened by the latest `budget/caps` the session's own log records.
- `pricesForeignCost()` — whether a `foreignCostEurPerUsd` rate is configured.
- `recordForeignSpend(session, spend)` — record what an implementer outside the session's own route spent for it.
- `enforce(agent)` — measure, and on the first exceeded cap append `budget/breach` and block the goal, returning the caps, the breach, and `remainingWallMs`.

The policy's own `agent/pre-step` listener calls `enforce` too, so a route step and a delegated attempt are stopped by one implementation rather than two that can drift. The package stays a function plugin and gains a named service class, following `dsh-shell-env`.

### The runner applies them to a delegated attempt

`EnvironmentRunner.delegate` measures before each attempt, arms the attempt's cancellation with the wall budget the cell has left, and charges what the child reported before measuring again:

- **Wall.** `remainingWallMs` is the deadline on the delegation's signal, plus one millisecond so the recorded span strictly exceeds the cap the policy compares against. An attempt the deadline ends records `stopReason: 'budget-deadline'` — apart from the seam's own `aborted`, which an operator's cancellation also produces — followed by the `budget/breach` that stopped the run.
- **Tokens.** `reportedUsage`, or the in-process child's summed `usage` when the backend reports none, becomes a `usage/foreign` record. `foldBudgetSpend` adds it, so `maxTotalTokens` bounds a delegated cell exactly as it bounds a route cell.
- **Cost.** `reportedCostUsd` converts at the deployment's `foreignCostEurPerUsd` into the same record. A deployment that states no rate cannot express a foreign price in the cost cap's currency, so `maxCostEur` does not bound a delegated cell there, and `cellCaps` says so.

A delegated run without a composed budget policy is refused at `run()` with `ENVIRONMENT_RUN_IMPLEMENTER_UNBOUNDED`, before a stamped session exists. The asymmetry with a route run is deliberate: a route attempt reaches the policy whenever one is composed, so a deployment composing none has chosen no budgets; a delegated attempt reaches it never.

### A fair comparison is a checkable invariant

`EnvironmentRunner.cellCaps(implementer)` answers what one cell of an arm runs under: the configured caps for a route implementer, and for a delegated one the same list minus a cost cap the runner cannot measure. `ExperimentService.freeze` resolves both arms, refuses a plan whose two lists differ with `EXPERIMENT_UNEQUAL_CAPS` before either arm starts, and digests the agreed caps into the plan (plan format version 4). `ExperimentResult.caps` and `EnvironmentRunReport.caps` carry them, so a reader of `data/proving-ground` sees the ceilings a comparison was measured inside without finding the composition that produced it.

### The scorekeeper needs no change

`SessionFactsOutcome.budgetBreachCap` already folds `budget/breach` out of any session log. Because the runner records the policy's own event on the cell session, a delegated cell's fact shows its breach through the representation that already exists.

## Alternatives considered

**Let the runner enforce the caps itself, reading its own configuration.** Rejected: the numbers would exist twice, and a deployment that tightened one would silently compare a route arm against a delegated arm bounded by the other. The measured problem is precisely that two enforcement paths disagree.

**Have `foldBudgetSpend` read `environment/delegation` directly.** Rejected: the event is owned by `dsh-environment-runner`, which depends on `dsh-budget-policy`; reading it would make the dependency circular and put improvement-layer vocabulary in a guard package. `usage/foreign` is the guard package's own vocabulary and any implementer can write it.

**Pass the delegated spend to `enforce` as an in-memory addend instead of recording it.** Rejected: the breach's `measured` would then not equal the fold over the events preceding it, which is the relation the invariant companion checks and the property that makes a recorded measurement reproducible by anyone holding the log.

**Add `budget-deadline` to `SubagentStopReasonMap`.** Rejected: no subagent backend produces it — the runner does, after cancelling the child — and widening the seam's union would change every consumer's exhaustiveness handling and the generated Cordis API catalog for a value none of them can observe. The runner widens its own `EnvironmentDelegation.stopReason` instead.

**Report unequal caps on the experiment result rather than refusing the plan.** Rejected: the arms would still have run, at the cost the problem statement measures, to produce a comparison a reader must then discount. Refusing at plan time spends nothing.

**Convert foreign USD cost with a hardcoded rate.** Rejected: an exchange rate is a deployment-varying choice, so it is a validated `Config` field with no default; a deployment that states none gets a cost cap that honestly does not cover foreign work rather than one that silently mis-measures it.

## Acceptance criteria

- A delegated attempt whose cell has no wall budget left is cancelled at the deadline, its `environment/delegation` records `stopReason: 'budget-deadline'`, a `budget/breach` naming `maxWallMs` follows it, the goal is blocked, and no further attempt starts.
- After a delegated attempt, the child's reported usage is a `usage/foreign` record, and a cell whose reported tokens exceed `maxTotalTokens` blocks its remaining attempts with a `budget/breach` naming that cap.
- `ctx.experiments.run` throws `EXPERIMENT_UNEQUAL_CAPS` for two arms resolving to different caps, having started neither arm, and a plan digest computed at different caps differs.
- `ExperimentResult.caps` and `EnvironmentRunReport.caps` state the caps the cells ran under.
- `scorekeeper.facts(session).outcome.budgetBreachCap` names the cap for a delegated cell, through the same fold a route cell uses.
- The keyless external-implementer e2e asserts a tiny cap ends a delegated cell with the breach recorded and the cell uncertified.

## Risks

- **A `usage/foreign` record restates tokens the `environment/delegation` beside it already carries.** The two say different things — what the child reported, and what this deployment charged for it — and `usage/priced` already sets that precedent against `assistant/message`. A reader summing both would double-count; the record's JSDoc and the runner README say which is which.
- **The deadline is a wall-clock timer, while `maxWallMs` measures a log span.** A delegated cell appends events sparsely, so the two can drift by the gap between the last event and the child's end. The deadline is armed from the log's first event, the same anchor the policy measures from, which bounds the drift to the overshoot; a cell that appends nothing for longer than its cap is still stopped at the cap.
- **A provider that reports neither usage nor cost is bounded by the wall cap alone.** Nothing here can invent an accounting a foreign backend does not publish; `cellCaps` cannot express "this cap applies but measures zero", so the report states the cap and the README states the limitation.
- **Refusing an unbounded delegated run is a new way for a composition to fail loud.** Every composition that runs the runner already must compose the budget policy under `verify-village-composition`, so the refusal is reachable only by a composition that gate does not cover.
