# Loop Guards

[English](guard.md) | 中文

`packages/guard` 收纳那些让会话停止继续做某件事的插件。其中两个是没有自身用语的纯监听器——重复工具提醒与工具调用超时策略，它们都由各自的包 README 记录。第三个 `@deepseek-ai/dsh-budget-policy` 拥有会话运行所处的上限，并以 `ctx.sessionBudgets` 的形式发布它们，因为自身不发起任何步骤的会话的驱动方没有别的途径能取到它们。[包 README](../../packages/guard/budget-policy/README.md) 拥有持久记录、折叠逻辑，以及越限时会发生什么。

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

上限求值顺序是 `maxInputTokens`、`maxOutputTokens`、`maxTotalTokens`、`maxWallMs`、`maxCostEur`，以 `BUDGET_CAP_ORDER` 导出。每一份被强制执行的上限列表都按该顺序排列，正是这一点让两份列表可以逐项比较——[实验](improvement.md)在接受一份必须在同一预算内度量其两个 arm（实验分支）的计划之前所做的检查。

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

该服务把它转换为持久的 `usage/foreign` 记录：`usage` 按与 assistant 消息相同的规则计费（未命中缓存的输入加上缓存读取与写入），`costUsd` 按部署的 `foreignCostEurPerUsd` 汇率换算，部署未声明汇率时则丢弃。两者都不提供的请求什么都不记录，因为空记录不会为任何上限增加任何东西。

## `BudgetEnforcement`

```ts type-equiv
/** What one enforcement pass measured, and what it did about it. */
interface BudgetEnforcement {
  /** The caps the session runs under: the configured caps tightened by its own `budget/caps`. */
  readonly caps: readonly BudgetCap[]
  /** The breach that was recorded and blocked the goal, absent while every cap holds. */
  readonly breach?: BudgetBreach
  /**
   * Milliseconds of wall budget left when the pass ran, absent when no wall cap
   * applies. Negative once the cap is spent, which is the state a breach on any
   * earlier cap can leave behind.
   */
  readonly remainingWallMs?: number
}
```

`enforce` 是唯一写入 `budget/breach` 并因预算耗尽而阻塞目标的地方，因此该策略自身的 pre-step 监听器与度量委派尝试的驱动方产生的是同一条持久记录。`remainingWallMs` 以日志首条事件为起点度量，与 `maxWallMs` 所跨越的锚点相同，因此把它设为截止时限的调用方，恰好在被度量的跨度将要达到上限时停止工作。

`budget/caps`、`budget/breach`、`usage/priced` 与 `usage/foreign` 的载荷在[持久化目录](../persistence-catalog.md)中，它拥有每一个持久会话事件。

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
 * Measure one session against its caps and, on the first cap it exceeds,
 * record the breach and block the session's goal.
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

Source: [`packages/guard/budget-policy/src/index.ts:262`](../../packages/guard/budget-policy/src/index.ts)
<!-- END GENERATED cordis-surface -->
