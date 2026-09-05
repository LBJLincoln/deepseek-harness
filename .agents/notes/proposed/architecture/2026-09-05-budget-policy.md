# Agent Note: Session budgets as a durably enforced policy plugin

Status: proposed

English | [中文](2026-09-05-budget-policy.zh.md)

## Problem

A long-running agent session has no stated ceiling on what it may spend. Nothing in the harness says how many tokens, how much wall-clock time, or how much money one session is allowed to consume, and nothing stops a session that passes such a figure. The pressure valves that exist are adjacent but different: `dsh-tool-call-timeout-policy` bounds one tool call, `dsh-repeat-tool-reminder` nudges a model out of a repetition loop, and a goal's `maxGoalRounds` bounds continuation rounds rather than spend. A session can therefore exhaust an operator's budget inside a single goal round, and the operator learns about it from an invoice.

Two properties make this more than a counter. First, an enforcement that lives in process memory is lost on restart: a session resumed after a crash would start its accounting from zero and spend the budget again. Second, an enforcement the log cannot explain is unreviewable — a turn that stops without a model request looks identical to a turn that had nothing to do. A budget is only trustworthy when the number that stopped a session is reproducible from the same durable events a replay reads, and when a supervising process can find out which cap stopped it.

Blocking is also insufficient on its own. The harness already automates continuation: a goal-round driver reserves the next round whenever an armed goal is active. Stopping one turn while leaving the goal armed would have the driver immediately queue another one, so the budget would spend itself out through the continuation path it was meant to bound.

## Proposal

Ship `@deepseek-ai/dsh-budget-policy` in `packages/guard/`, next to the existing per-call policy plugins. It is a function plugin with no service of its own: deployment-varying caps in `Config`, a pure fold over the session log, and one enforcement point.

**Config.** `maxInputTokens`, `maxOutputTokens`, `maxTotalTokens`, `maxWallMs`, and `maxCostEur`, each optional and uncapped when omitted, plus a `pricing` table keyed by `provider/model` giving EUR per million input and output tokens. An empty configuration is a valid no-op policy. Validation runs at plugin load: a cap or rate that is not a finite non-negative number throws, and `maxCostEur` without a non-empty `pricing` table throws, because a route with no price has no cost cap and a ceiling over an empty table would silently enforce nothing. A route absent from a non-empty table still contributes its tokens to the token caps.

**Folding.** Spend is derived from the session log alone, never from in-memory counters, so the projection is recomputable by anyone holding the log. `assistant/message` is the single usage source: it carries a step's final provider accounting, so the earlier `assistant/chunk` usage sample for the same step is ignored rather than counted twice. Billed input is the disjoint sum of `inputTokens`, `cacheReadTokens`, and `cacheWriteTokens`. Each message prices against the `provider/model` provenance it already carries, so a mid-session route switch bills each step at the rate of the route that served it and the fold needs no cross-event route tracking. Wall time is the span between the log's first and last event times — it counts idle gaps, including across a restart, but not time elapsed since the newest event, which is exactly what makes it a function of the log rather than of the clock at read time.

**Enforcement.** One `agent/pre-step` listener, registered with `prepend: true`. That waterfall is the earliest documented extension point before the next model request, and prepending puts the budget decision ahead of every listener that would build request context or reserve continuation work for a step that cannot run. On a breach the listener does not call `next()`; it returns `{ kind: 'reject' }`, which is how `dsh-goal-round-driver` already stops a step, and the loop closes the turn with reason `blocked` having opened no step. `agent-loop` is unchanged.

**The durable record.** A breach appends `budget/breach` carrying `{ cap, measured, limit }` — the cap that tripped, the spend measured from the events preceding the record, and the configured value that spend exceeded. Caps are evaluated in the fixed order `maxInputTokens`, `maxOutputTokens`, `maxTotalTokens`, `maxWallMs`, `maxCostEur`, so the order is part of the durable record rather than an implementation detail. The event is appended before the goal is blocked, so a reader meets the explanation before its consequence.

**Blocking the goal.** `ctx.goals.block(agent, ref, { code: 'budget-exhausted', message })` is the existing goal-seam operation for exactly this: it is durable, it records a machine-routable code, and it disarms continuation, so `dsh-goal-round-driver` does not resume the goal afterwards. The goal domain is optional and read through `ctx.get('goals')`, because a hard `inject` would make an unsatisfied dependency silently disable the whole budget rather than fail loudly. A composition without `ctx.goals`, without a current goal, or whose goal already left `active` still gets the breach record and the stopped turn.

Spend never decreases, so a later step in the same session breaches again and records its own event. The durable log therefore states how many attempts the exhausted budget turned away. Raising a cap and reloading the deployment is how a session resumes; there is no runtime grant.

**Model experience.** The model sees nothing new. The decision happens before the step opens, so no prompt section, tool schema, or message text is added and no model request is made — the breach record and the block reason are durable state for humans and supervising processes. The loader-booted e2e proves the absence: one assistant message, one turn ending `blocked`, and no goal round.

## Alternatives considered

**Enforce at `agent/request` instead.** The request waterfall is closer to the spend it bounds, but it runs inside an already-opened step, after `step/start` and the entering `user/message` are durable. Stopping there would leave a half-formed step in the log and would need a way to unwind it; `agent/pre-step` rejects before any of that exists and already has a defined turn outcome.

**Count spend in memory.** A counter incremented per response is simpler and cheaper, and it is what a naive implementation reaches for. It fails the property that matters: a resumed session restarts at zero, and the number that stopped a session cannot be checked against anything. The fold costs one pass over the log per proposed step, which is the same order the loop already pays to assemble a request.

**Include `assistant/chunk` usage samples in the fold.** The chunk sample arrives earlier and survives a later request failure, which is why `dsh-token-meter`'s projection reads both. Counting both here would double-count a completed step, and reconciling them would put a same-step replacement rule into a policy whose whole value is that its arithmetic is obvious. The final `assistant/message` accounting is the conservative choice: a step whose response never completed is not billed by this policy.

**Pause the goal instead of blocking it.** `pause` also disarms continuation, but it reads as a reversible human action and carries no reason code. `block` is the phase the goal domain documents for provider limits and configured budgets, and its `GoalBlockReason` is how a supervisor tells an exhausted budget apart from every other stop.

**Cancel the agent rather than reject the step.** `agent.cancel` would stop work already in flight, but it is a lifecycle verb owned by a driver, it discards a running turn's partial results, and it produces an `aborted` outcome indistinguishable from a user interrupt. The budget is a decision about the *next* request, so declining to make it is the honest mechanism.

**A service with a runtime `grant()` operation.** Letting an operator raise a cap live would avoid a reload. It also makes the enforced ceiling a piece of undurable process state that the log cannot explain, which is the property this note exists to establish. Deferred until a consumer needs it, at which point the grant itself must become a logged event.

**Fold cost inside the invariant companion too.** The companion recomputes token and wall-clock measurements independently, but cost depends on the deployment `pricing` table, which the log does not carry. Embedding the rates in each breach event would make cost recomputable at the price of writing deployment pricing into every session log; the companion instead checks only the exceeded-its-limit relation for `maxCostEur`, and the README says so.

## Acceptance criteria

- A session whose log exceeds a configured cap records exactly one `budget/breach` per stopped step, carrying the cap, the measured spend, and the cap value.
- The recorded measurement equals this package's fold over exactly the events preceding the record, for every cap the log can derive; the `./invariant` companion rejects a stream where it does not, and rejects any breach whose measurement does not exceed its own limit.
- A current `active` goal is `blocked` with code `budget-exhausted` in the same step, after the breach event, and a composed `dsh-goal-round-driver` starts no further round.
- The stopped step makes no model request, and the turn ends with reason `blocked`.
- `maxCostEur` without a non-empty `pricing` table fails at plugin load, as does any cap or rate that is not a finite non-negative number.
- An empty configuration loads and never stops a step.
- The unit spec covers every branch of `src/` at 100% per file; a loader-booted e2e over `examples/headless-agent/tests/fixtures/budget-policy/` proves the breach, the block, the absent goal round, and the single assistant message through a real `cordis.yml` and process.

## Rollout

The plugin ships loaded by nothing. It is absent from `dsh-base` and from every shipped profile, so no existing deployment changes behavior; a deployment opts in by adding the row and its caps to its own `cordis.yml`. The e2e fixture is the reference composition.

The durable format is additive: `budget/breach` is a new `SessionEventMap` member, registered in the generated persistence catalog, and no existing event changes. A build that does not know the type refuses the log by the envelope's default required-on-read rule, which is the correct outcome — a reader that silently skipped the record would reconstruct a session whose stopped turn has no explanation. `SESSION_FORMAT_VERSION` is unchanged because no structural format change is involved.

Promotion into a shipped profile waits for a deployment that states real caps and real prices. The natural next step after that is the deferred advisory threshold below.

## Risks

**A cap that is too low stops useful work with no warning.** The policy has no advisory threshold telling the model to wrap up before the ceiling, so the first consequence of an exhausted budget is a turn that ends. An operator who sets a cap from a guess will meet it as an abrupt stop. The mitigation for now is that every cap is opt-in and absent by default; a warning threshold is a later, separate decision because it *is* model-visible and needs its own pinned text.

**Cost is only as good as the pricing table.** Usage on a route the deployment has not priced adds tokens but no cost, so `maxCostEur` alone cannot bound a deployment whose routes are not all priced. The load-time failure covers the empty-table case; a partially priced table is a legitimate configuration and the README says what it means. A single input rate per route also prices cache reads at the uncached rate, which overstates cost for a cache-heavy session.

**Wall time is a log property, not a stopwatch.** A session idle for an hour with no events registers no elapsed time until its next event lands. That keeps the measurement recomputable, and it means `maxWallMs` bounds the span the log covers rather than the time an operator waited.

**A repeatedly re-prompted exhausted session grows its log.** Every blocked step records its own breach. The growth is bounded by human re-prompting and each record is the durable statement that an attempt was refused, but a supervising process that retries automatically would append one event per retry.

**Budgets are per session.** Subagent sessions carry their own logs and their own independent budgets, so a parent cap does not bound the fleet it spawns. A deployment that needs a fleet-wide ceiling has no aggregation point here.
