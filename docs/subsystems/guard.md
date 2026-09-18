# Loop Guards

English | [中文](guard.zh.md)

`packages/guard` holds the plugins that stop a session doing more of something. Two of them are pure listeners with no vocabulary of their own — the repeat-tool reminder and the tool-call timeout policy, both documented in their package READMEs. The third, `@deepseek-ai/dsh-budget-policy`, owns the caps a session runs under and publishes them as `ctx.sessionBudgets`, because a driver whose session proposes no step of its own has no other way to reach them. [The package README](../../packages/guard/budget-policy/README.md) owns the durable records, the fold, and what a breach does.

Source: [`packages/guard/budget-policy/src/types.ts`](../../packages/guard/budget-policy/src/types.ts)

## `BudgetCap`

```ts type-equiv
/**
 * One enforced cap paired with the ceiling it enforces. Enforced caps travel as
 * a list of pairs in the fixed cap evaluation order rather than as an object,
 * so two enforced sets compare and digest by value.
 */
type BudgetCap = readonly [BudgetCapId, number]
```

The cap evaluation order is `maxInputTokens`, `maxOutputTokens`, `maxTotalTokens`, `maxWallMs`, `maxCostEur`, exported as `BUDGET_CAP_ORDER`. Every list of enforced caps is in that order, which is what lets two of them be compared element by element — the check an [experiment](improvement.md) makes before it accepts a plan whose two arms must be measured inside one budget.

## `ForeignSpendRequest`

```ts type-equiv
/** Spend one implementer outside the session's own model route did for it. */
interface ForeignSpendRequest {
  /** Identity of the work, unique within the session; a `ref` the log already carries is refused. */
  readonly ref: string
  /** What did the work, as the deployment names it. */
  readonly source: string
  /** Token accounting the implementer's own backend reported for the work. */
  readonly usage?: TokenUsage
  /** Price in US dollars the implementer's own backend reported for the work. */
  readonly costUsd?: number
}
```

The service converts this into the durable `usage/foreign` record: `usage` is billed by the same rule an assistant message is (uncached input plus cache reads and writes), and `costUsd` is converted at the deployment's `foreignCostEurPerUsd` rate or dropped when it states none. A request stating neither records nothing, because an empty record would add nothing to any cap.

## `BudgetEnforcement`

```ts type-equiv
/** What one enforcement pass measured, and what it did about it. */
interface BudgetEnforcement {
  /** The caps the session runs under: the configured caps tightened by its own `budget/caps`. */
  readonly caps: readonly BudgetCap[]
  /**
   * The breach that was recorded, absent while every ceiling holds. A `session`
   * breach also blocked the goal; an `attempt` one stopped the bounded work
   * alone.
   */
  readonly breach?: BudgetBreach
  /**
   * Milliseconds of wall budget left when the pass ran, absent when no wall cap
   * applies. Negative once the cap is spent, which is the state a breach on any
   * earlier cap can leave behind.
   */
  readonly remainingWallMs?: number
}
```

`enforce` is the one place a `budget/breach` is written and a goal is blocked for an exhausted budget, so the policy's own pre-step listener and a driver measuring a delegated attempt produce the same durable record. `remainingWallMs` is measured from the log's first event, the same anchor `maxWallMs` spans, so a caller arming it as a deadline stops work exactly when the measured span would reach the cap.

## `AttemptBudget`

```ts type-equiv
/**
 * The ceilings one bounded unit of work runs under, as
 * {@link SessionBudgets.boundAttempt} armed them, and the disposer that releases
 * them. While the bound stands, {@link SessionBudgets.enforce} measures the
 * session against it after the session's own caps, so work that overruns its
 * share is stopped without the session's caps being spent.
 */
interface AttemptBudget {
  /**
   * Milliseconds of wall-clock budget this work may consume, absent when the
   * session runs under no wall cap. It is a duration from the instant the bound
   * was armed, which a caller with no step of its own arms as a deadline.
   */
  readonly wallMs?: number
  /** Release the bound, so the session's own caps alone measure what follows. */
  readonly dispose: () => void
}
```

`boundAttempt` divides one session between several units of work: each ceiling is the spend the session has already made plus the caller's `share` of that cap, measured from the caps rather than from what is left of them, so the slice a caller chose is the slice it gets whatever the earlier units spent. One bound stands per session at a time. A breach of one carries `scope: 'attempt'`, rejects the step like any other, and leaves the goal active, so the session runs on under caps it has not spent; a breach of the session's own caps still blocks the goal. The [environment runner](../../packages/improvement/environment-runner/README.md#the-attempt-ladder) is its consumer: each rung of an attempt ladder may claim a share of the cell it runs in.

The `budget/caps`, `budget/breach`, `usage/priced`, and `usage/foreign` payloads are in the [persistence catalog](../persistence-catalog.md), which owns every durable session event.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxsessionbudgets--sessionbudgets"></a>

### `ctx.sessionBudgets` — `SessionBudgets`

Session budgets (`ctx.sessionBudgets`): the caps a session runs under and the enforcement that stops it.

The pre-step listener of this package is one consumer; the other is a driver whose session never proposes a step of its own because an implementer outside this process does its work. Both go through SessionBudgets.enforce, so a delegated session records the same `budget/breach` and blocks its goal the same way, and the caps a run is bounded by are read here rather than restated by each driver.

```ts cordis-catalog
/**
 * The caps this deployment enforces before any session tightens them.
 * @returns the enforced caps in {@link BUDGET_CAP_ORDER}; empty for a policy that caps nothing.
 */
configuredCaps(): readonly BudgetCap[]

/**
 * The caps one session runs under: the configured caps tightened by the
 * latest `budget/caps` its own log records.
 * @param session - the session whose log carries its recorded caps.
 * @returns the caps to measure that session against, in {@link BUDGET_CAP_ORDER}.
 */
capsFor(session: Session): readonly BudgetCap[]

/**
 * Whether this deployment can express a foreign implementer's reported price
 * in the currency `maxCostEur` caps. A deployment that states no rate cannot,
 * so a cost cap does not bound work such an implementer does.
 * @returns `true` when a foreign exchange rate is configured.
 */
pricesForeignCost(): boolean

/**
 * Record spend an implementer outside the session's own model route incurred
 * for it, so the caps measure it with the session's own steps. Nothing is
 * recorded for work whose implementer reported neither tokens nor a price:
 * an empty record would add nothing to any cap.
 * @param session - the session the work was done for.
 * @param spend - what did the work and what its own backend reported for it.
 * @returns `true` when a record was appended.
 * @throws {RangeError} when the session's log already accounts for `spend.ref`.
 */
recordForeignSpend(session: Session, spend: ForeignSpendRequest): boolean

/**
 * Bound the work about to start on one session to a share of the caps that
 * session runs under, so it is stopped at its own ceiling instead of at the
 * session's. Each ceiling is the spend the session has already made plus
 * `share` of that cap's value, measured from the session's caps rather than
 * from what is left of them, so dividing one cell between several units of
 * work gives each the slice its caller chose whatever the earlier ones spent.
 *
 * One bound stands per session at a time: arming a second replaces the first,
 * and the disposer releases whichever is current. A session whose caps are
 * empty is bounded by nothing, exactly as it is measured against nothing.
 *
 * @param agent - the agent whose session the work is done for.
 * @param share - the fraction of each cap the work may consume, greater than 0 and at most 1.
 * @returns the wall-clock budget the work may consume and the disposer that releases the bound.
 */
boundAttempt(agent: Agent, share: number): AttemptBudget

/**
 * Measure one session against its caps and, on the first cap it exceeds,
 * record the breach and block the session's goal. A session whose caps all
 * hold is measured again against the ceilings any standing
 * {@link boundAttempt} armed, whose breach stops that work alone and leaves
 * the goal active.
 *
 * The goal domain is optional: a composition without `ctx.goals`, without a
 * current goal, or whose goal already left the `active` phase still gets the
 * durable breach record. Spend never decreases, so a caller that keeps going
 * records one breach per attempt it turned away, exactly as a stopped step
 * does.
 *
 * @param agent - the agent whose session log carries the spend and its caps.
 * @returns the caps measured, the breach recorded if any, and the wall budget left.
 */
enforce(agent: Agent): BudgetEnforcement
```

Types: [Agent](core.md) · [Session](session.md)

Source: [`packages/guard/budget-policy/src/index.ts:286`](../../packages/guard/budget-policy/src/index.ts)
<!-- END GENERATED cordis-surface -->
