/**
 * Session budget guard. Configured token, wall-clock, and cost caps are
 * measured against the durable session log before every proposed step; the
 * first cap the log exceeds is recorded as a `budget/breach` event, blocks any
 * active goal, and rejects the step so no further model request is made. Every
 * step served by a priced route also gets a durable `usage/priced` record, so
 * session cost replays from the log at the rates that priced it. The same
 * enforcement is published as `ctx.sessionBudgets` for a driver whose session
 * never proposes a step of its own because an implementer outside this process
 * does its work.
 *
 * @module @deepseek-ai/dsh-budget-policy
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
// Type-only: resolves ctx.goals for the optional durable block.
import type {} from '@deepseek-ai/dsh-goal'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import {
  BUDGET_CAP_ORDER,
  foldBudgetSpend,
  foldSessionCaps,
  measuredFor,
  remainingWallMs,
  tightenedCaps,
  unpricedUsage,
} from './fold.ts'
import { billedInputTokens, costEurFor, pricingTableDigest, routeKey } from './pricing.ts'
import type {
  AccountedMessage,
  BudgetBreach,
  BudgetCap,
  BudgetCapId,
  BudgetRoutePricing,
  UsagePriced,
} from './types.ts'

// The pure payload outlet (./types.ts, ONE home of the `budget/caps`,
// `budget/breach`, `usage/priced`, and `usage/foreign` declarations)
// re-exported onto the package root keeps the module edge in the emitted
// index.d.ts, so aggregate programs consuming the declarations still receive
// the SessionEventMap merge.
export type * from './types.ts'
export {
  BUDGET_CAP_ORDER,
  foldBudgetSpend,
  foldSessionCaps,
  measuredFor,
  remainingWallMs,
  tightenedCaps,
  unpricedUsage,
} from './fold.ts'
export { pricingTableDigest } from './pricing.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionBudgets: SessionBudgets
  }
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'budget-policy'

/** The agent registry that owns pre-step processing. */
export const inject = ['agents']

/**
 * The block reason this policy writes onto a goal it stops. Stable and
 * machine-routable: a supervisor reads it to tell an exhausted budget apart
 * from every other blocked goal.
 */
export const BUDGET_EXHAUSTED = 'budget-exhausted'

/**
 * Per-session ceilings. Every cap is optional and uncapped when omitted, so an
 * empty configuration is a valid policy that never stops a step. A cap is
 * exceeded only when measured spend is strictly greater than its value, which
 * makes `0` an immediate stop and keeps an exactly-on-budget session running.
 */
export interface Config {
  /** Billed input tokens (uncached input plus cache reads and writes) allowed in one session. */
  maxInputTokens?: number
  /** Output tokens allowed in one session. */
  maxOutputTokens?: number
  /** Input plus output tokens allowed in one session. */
  maxTotalTokens?: number
  /** Milliseconds the session log may span between its first and last event. */
  maxWallMs?: number
  /** EUR the priced routes of one session may cost; requires a non-empty {@link pricing}. */
  maxCostEur?: number
  /** EUR-per-million-token rates keyed by `provider/model`; a route absent here is never cost-capped. */
  pricing?: Record<string, BudgetRoutePricing>
  /**
   * EUR per one US dollar, applied to the price a foreign implementer's own
   * backend reported for work it did for a session here. Absent leaves foreign
   * spend priced in no currency this policy can compare, so it contributes
   * tokens alone and `maxCostEur` cannot be enforced over it.
   */
  foreignCostEurPerUsd?: number
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  maxInputTokens: z.number(),
  maxOutputTokens: z.number(),
  maxTotalTokens: z.number(),
  maxWallMs: z.number(),
  maxCostEur: z.number(),
  pricing: z.dict(z.object({
    inputEurPerMillionTokens: z.number().required(),
    outputEurPerMillionTokens: z.number().required(),
  })).default({}),
  foreignCostEurPerUsd: z.number(),
})

/** The caps a validated configuration actually enforces, paired with their values. */
interface ResolvedConfig {
  readonly caps: readonly BudgetCap[]
  readonly pricing: Readonly<Record<string, BudgetRoutePricing>>
  /** Whether {@link pricing} names any route; an empty table never reads the log. */
  readonly prices: boolean
  /** {@link pricingTableDigest} of {@link pricing}, computed once at load. */
  readonly pricingDigest: string
  /** EUR per one US dollar for foreign spend, absent when the deployment states none. */
  readonly foreignCostEurPerUsd: number | undefined
}

/** Reject a cap that cannot express a ceiling before any session depends on it. */
function requireFiniteCap(cap: BudgetCapId, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`budget-policy: ${cap} must be a finite non-negative number, got ${String(value)}`)
  }
}

/** Reject a rate that cannot price a route before any session depends on it. */
function requireFiniteRate(route: string, field: keyof BudgetRoutePricing, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`budget-policy: pricing["${route}"].${field} must be a finite non-negative number, got ${String(value)}`)
  }
}

/** Reject a currency rate that cannot convert a foreign price before a delegated session depends on it. */
function requireFiniteExchangeRate(value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`budget-policy: foreignCostEurPerUsd must be a finite positive number, got ${String(value)}`)
  }
}

/**
 * Validate one deployment configuration and materialize the enforced caps.
 * Every rejection happens at plugin load, before a session can depend on a cap
 * the policy could not enforce.
 */
function resolveBudgetConfig(config: Config): ResolvedConfig {
  // The schema defaulted the table — the cast records that runtime fact.
  const pricing = config.pricing as Readonly<Record<string, BudgetRoutePricing>>
  for (const [route, rates] of Object.entries(pricing)) {
    requireFiniteRate(route, 'inputEurPerMillionTokens', rates.inputEurPerMillionTokens)
    requireFiniteRate(route, 'outputEurPerMillionTokens', rates.outputEurPerMillionTokens)
  }
  const prices = Object.keys(pricing).length > 0
  if (config.maxCostEur !== undefined && !prices) {
    throw new TypeError('budget-policy: maxCostEur needs a non-empty pricing table; an unpriced route has no cost cap')
  }
  if (config.foreignCostEurPerUsd !== undefined) requireFiniteExchangeRate(config.foreignCostEurPerUsd)
  const caps: BudgetCap[] = []
  for (const cap of BUDGET_CAP_ORDER) {
    const value = config[cap]
    if (value === undefined) continue
    requireFiniteCap(cap, value)
    caps.push([cap, value])
  }
  return {
    caps,
    pricing,
    prices,
    pricingDigest: pricingTableDigest(pricing),
    foreignCostEurPerUsd: config.foreignCostEurPerUsd,
  }
}

/**
 * Build the durable price of one accounted message at the configured rates.
 * @param event - a message {@link unpricedUsage} selected, so its route is priced.
 * @param resolved - the pricing table and its digest this deployment enforces.
 * @returns the record to append for that step.
 */
function priceMessage(event: AccountedMessage, resolved: ResolvedConfig): UsagePriced {
  const { provider, model } = event.data.message.source
  // oxlint-disable-next-line typescript/no-non-null-assertion -- unpricedUsage yields only routes the table names
  const rates = resolved.pricing[routeKey(provider, model)]!
  const inputTokens = billedInputTokens(event.data.usage)
  const outputTokens = event.data.usage.outputTokens
  return {
    turn: event.data.turn,
    step: event.data.step,
    provider,
    model,
    inputTokens,
    outputTokens,
    inputEurPerMillionTokens: rates.inputEurPerMillionTokens,
    outputEurPerMillionTokens: rates.outputEurPerMillionTokens,
    costEur: costEurFor(inputTokens, outputTokens, rates),
    pricingDigest: resolved.pricingDigest,
  }
}

/**
 * Record the price of every priced-route step the log does not price yet. The
 * selection is log-derived, so a resumed session prices what its predecessor
 * left unpriced and a second call over the same log appends nothing.
 * @param agent - the agent whose session log is priced.
 * @param resolved - the pricing table and its digest this deployment enforces.
 */
function priceUnpricedSteps(agent: Agent, resolved: ResolvedConfig): void {
  if (!resolved.prices) return
  for (const event of unpricedUsage(agent.session.events, resolved.pricing)) {
    agent.session.append('usage/priced', priceMessage(event, resolved))
  }
}

/** Spend one implementer outside the session's own model route did for it. */
export interface ForeignSpendRequest {
  /** Identity of the work, unique within the session; a `ref` the log already carries is refused. */
  readonly ref: string
  /** What did the work, as the deployment names it. */
  readonly source: string
  /** Token accounting the implementer's own backend reported for the work. */
  readonly usage?: TokenUsage
  /** Price in US dollars the implementer's own backend reported for the work. */
  readonly costUsd?: number
}

/** What one enforcement pass measured, and what it did about it. */
export interface BudgetEnforcement {
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

/**
 * Session budgets (`ctx.sessionBudgets`): the caps a session runs under and the
 * enforcement that stops it.
 *
 * The pre-step listener of this package is one consumer; the other is a driver
 * whose session never proposes a step of its own because an implementer outside
 * this process does its work. Both go through {@link SessionBudgets.enforce},
 * so a delegated session records the same `budget/breach` and blocks its goal
 * the same way, and the caps a run is bounded by are read here rather than
 * restated by each driver.
 */
export class SessionBudgets extends Service {
  /**
   * @param ctx - the context the service is registered in and disposed with.
   * @param resolved - the caps, pricing, and foreign rate this deployment enforces.
   */
  constructor(ctx: Context, private readonly resolved: ResolvedConfig) {
    super(ctx, 'sessionBudgets')
  }

  /**
   * The caps this deployment enforces before any session tightens them.
   * @returns the enforced caps in {@link BUDGET_CAP_ORDER}; empty for a policy that caps nothing.
   */
  configuredCaps(): readonly BudgetCap[] {
    return this.resolved.caps
  }

  /**
   * The caps one session runs under: the configured caps tightened by the
   * latest `budget/caps` its own log records.
   * @param session - the session whose log carries its recorded caps.
   * @returns the caps to measure that session against, in {@link BUDGET_CAP_ORDER}.
   */
  capsFor(session: Session): readonly BudgetCap[] {
    return tightenedCaps(this.resolved.caps, foldSessionCaps(session.events))
  }

  /**
   * Whether this deployment can express a foreign implementer's reported price
   * in the currency `maxCostEur` caps. A deployment that states no rate cannot,
   * so a cost cap does not bound work such an implementer does.
   * @returns `true` when a foreign exchange rate is configured.
   */
  pricesForeignCost(): boolean {
    return this.resolved.foreignCostEurPerUsd !== undefined
  }

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
  recordForeignSpend(session: Session, spend: ForeignSpendRequest): boolean {
    for (const event of session.events) {
      if (event.type === 'usage/foreign' && event.data.ref === spend.ref) {
        throw new RangeError(`budget-policy: foreign spend "${spend.ref}" is already accounted for in session "${session.id}"`)
      }
    }
    const rate = this.resolved.foreignCostEurPerUsd
    const costEur = spend.costUsd === undefined || rate === undefined ? undefined : spend.costUsd * rate
    if (spend.usage === undefined && costEur === undefined) return false
    session.append('usage/foreign', {
      ref: spend.ref,
      source: spend.source,
      inputTokens: spend.usage === undefined ? 0 : billedInputTokens(spend.usage),
      outputTokens: spend.usage?.outputTokens ?? 0,
      ...costEur === undefined ? {} : { costEur },
    })
    return true
  }

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
  enforce(agent: Agent): BudgetEnforcement {
    const { session } = agent
    const caps = this.capsFor(session)
    const remaining = remainingWallMs(session.events, caps, Date.now())
    const breach = this.detect(session, caps)
    if (breach === undefined) {
      return { caps, ...remaining === undefined ? {} : { remainingWallMs: remaining } }
    }
    session.append('budget/breach', breach)
    this.blockGoal(agent, breach)
    return { caps, breach, ...remaining === undefined ? {} : { remainingWallMs: remaining } }
  }

  /** The first cap in {@link BUDGET_CAP_ORDER} the log exceeds, or `undefined` while every cap holds. */
  private detect(session: Session, caps: readonly BudgetCap[]): BudgetBreach | undefined {
    if (caps.length === 0) return undefined
    const spend = foldBudgetSpend(session.events, this.resolved.pricing)
    for (const [cap, limit] of caps) {
      const measured = measuredFor(spend, cap)
      if (measured > limit) return { cap, measured, limit }
    }
    return undefined
  }

  /** Block the session's goal so no goal-round driver continues it. */
  private blockGoal(agent: Agent, breach: BudgetBreach): void {
    const goals = this.ctx.get('goals')
    if (goals === undefined) return
    const goal = goals.get(agent)
    if (goal === undefined || goal.phase !== 'active') return
    goals.block(agent, { id: goal.id, revision: goal.revision }, {
      code: BUDGET_EXHAUSTED,
      message: `Session budget ${breach.cap} exceeded: ${breach.measured} of ${breach.limit}.`,
    })
  }
}

/**
 * Register the `ctx.sessionBudgets` service, the pre-step budget check, and the
 * pricing records for the lifetime of `ctx`.
 * @param ctx - plugin context; the service and both listeners are disposed with it.
 * @param config - the per-session caps and pricing to enforce.
 * @throws {TypeError} when the configuration cannot express the caps it declares.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveBudgetConfig(config)
  const budgets = new SessionBudgets(ctx, resolved)

  // Prepended so the budget decision precedes every listener that would build
  // request context or reserve continuation work for a step that cannot run.
  ctx.on('agent/pre-step', async ({ agent }, next): Promise<PreStepDecision> => {
    // Priced before the caps are read, so the last message before a breach is
    // priced by the same step that records the breach.
    priceUnpricedSteps(agent, resolved)
    return budgets.enforce(agent).breach === undefined ? next() : { kind: 'reject' }
  }, { prepend: true })

  // A turn that closes normally opens no further step, so its final message is
  // priced at the stop boundary instead.
  ctx.on('agent/turn-stopping', ({ agent }) => {
    priceUnpricedSteps(agent, resolved)
  })
}
