# Agent Note: A budget share per ladder rung

Status: implemented

English | [中文](2026-09-18-per-rung-budget-share.zh.md)

## Problem

Every rung of an attempt ladder ran under the composition's caps for the whole cell. `dsh-budget-policy` enforces `maxTotalTokens`, `maxWallMs`, and an optional cost cap on `agent/pre-step` over the session's cumulative usage, and the environment runner applies the same caps around each delegated attempt through `ctx.sessionBudgets` — `enforce`, `remainingWallMs`, and `recordForeignSpend`. Nothing divided that budget between the rungs, so the first attempt could spend all of it. On 2026-09-08 the drop arm of the routing experiment (record `data/proving-ground/2026-09-08-bench-e5-drop-candidate-t5`, a haiku-then-opus ladder against an opus arm, both delegated to the spawn implementer) missed two cells: the cheap first rung alone spent 1,493,040 and 1,472,984 of the cell's 1,500,000 billed tokens rereading its own transcript, and the runner refused the strong second rung on the breached cap. A ladder that escalates only if the cheap rung leaves budget for the escalation measures the cheap rung, not the routing.

## Decision

A rung states `share`: a number in `(0, 1]`, the fraction of every configured cap its attempt may consume, measured from the cell's caps rather than from what is left of them, so a cheap first rung cannot spend the strong rung's budget. `resolveLadder` refuses a share outside the range and a ladder whose shares sum above 1 with `ENVIRONMENT_RUN_INVALID_LADDER`, and `run()` refuses any share in a composition with no budget policy to take a share of. The stamped ladder becomes `EnvironmentRunStampRung[]` — `EnvironmentRunModel` plus the optional `share` — so a cell's arm identity includes how it divided its budget; `EnvironmentRunModel` is untouched, and the stamp keeps `version: 1` because an optional field on a rung is not a structural format change. The scorekeeper's facts and row key, the fleet leaderboard row and its Markdown cell, the observatory's published row, its sort key and its ladder cell, and the experiments plan digest all carry the share.

The policy gains one public method. `ctx.sessionBudgets.boundAttempt(agent, share)` arms one set of ceilings on the session — each the spend already made plus `share` of that cap — and returns the wall budget the work may consume with the disposer that releases the bound. While a bound stands, `enforce` measures the session's own caps first and those ceilings second, and a ceiling's breach records `budget/breach` with `scope: 'attempt'`, rejects the step, and leaves the goal active. The runner arms the bound around exactly one attempt and disposes it before the validation: a route attempt is stopped by the policy's own pre-step check, and a delegated one is cancelled at the smaller of the cell's remaining wall budget and its share of the wall cap, then measured once more against its ceilings right after the child's spend is charged. The `usage/foreign` fold is unchanged, and no share exists outside a ladder.

## Alternatives considered

- **Tighten the session's caps per attempt with a `budget/caps` record.** Rejected: the record can only ever narrow, so the cell could never get its remaining budget back for the next rung, and a breach of a tightened cap blocks the goal — which ends the cell, exactly the behaviour the shares exist to avoid.
- **Give the runner its own token counter and stop an attempt itself.** Rejected: the pre-step check is where a route attempt is stopped, and a second measurement of the same log would drift from the policy's fold. The decision belongs to the operation that makes it.
- **Make the share a fraction of what the cell has left.** Rejected: a ladder's shares would then depend on what the earlier rungs happened to spend, so two cells of one arm would divide their budgets differently and the arm would measure the first rung's appetite along with its routing.
- **Split the budget evenly across the ladder's rungs.** Rejected: a ladder exists to escalate, and an escalation is worth more budget than the cheap rung it follows. A deployment-fixed split is also a hardcoded tunable in a plan file's place.

## Consequences

A plan can state what each rung of a cell may spend, and a rung that overruns it ends with an attempt-scoped `budget/breach` while the run moves to the next rung on the budget the cell kept. Two plans differing only in their shares are two experiments, because `planDigest` covers them; `EXPERIMENT_PLAN_VERSION` moves to `6` for the changed digested fields. A reader of a `budget/breach` now distinguishes the cell's own caps, which block the goal, from a share of them, which does not; a record stating no scope is the session's caps, which is every record written before this. A delegated rung's token and cost share is measured only once its child has returned, because nothing here observes an out-of-band child's spend while it runs; the wall share is the only ceiling that cuts such an attempt short, and the runner README states the limit.

## Testing

The runner's unit tests cover the share refusals at the resolution boundary and through `run()`, a route attempt stopped at its token share followed by the next rung, a delegated child charged past its share, a delegated attempt cancelled at its share of the wall cap, and one cancelled at what the cell had left instead. The budget policy's tests cover the ceilings, their measurement from the caps rather than from what is left, the wall share, the session caps' precedence, and the rejected step. The keyless `attempt-ladder` fixture runs a third cell whose first rung holds half a percent of the composition's token cap, and its e2e reads the cell log back: one attempt-scoped breach, no goal block, the second rung's own two requests, and a stamp carrying the share.
