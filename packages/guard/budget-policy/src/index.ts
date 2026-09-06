/**
 * Session budget guard. Configured token, wall-clock, and cost caps are
 * measured against the durable session log before every proposed step; the
 * first cap the log exceeds is recorded as a `budget/breach` event, blocks any
 * active goal, and rejects the step so no further model request is made. Every
 * step served by a priced route also gets a durable `usage/priced` record, so
 * session cost replays from the log at the rates that priced it.
 *
 * @module @deepseek-ai/dsh-budget-policy
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
// Type-only: resolves ctx.goals for the optional durable block.
import type {} from '@deepseek-ai/dsh-goal'
import { foldBudgetSpend, measuredFor, unpricedUsage } from './fold.ts'
import { billedInputTokens, costEurFor, pricingTableDigest, routeKey } from './pricing.ts'
import type { AccountedMessage, BudgetBreach, BudgetCapId, BudgetRoutePricing, UsagePriced } from './types.ts'

// The pure payload outlet (./types.ts, ONE home of the `budget/breach` and
// `usage/priced` declarations) re-exported onto the package root keeps the
// module edge in the emitted index.d.ts, so aggregate programs consuming the
// declarations still receive the SessionEventMap merge.
export type * from './types.ts'
export { foldBudgetSpend, measuredFor, unpricedUsage } from './fold.ts'
export { pricingTableDigest } from './pricing.ts'

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
 * Evaluation order of the caps. The first cap the log exceeds is the one
 * recorded, so this order decides which breach a session that overruns two
 * caps in the same step reports.
 */
const CAP_ORDER: readonly BudgetCapId[] = [
  'maxInputTokens',
  'maxOutputTokens',
  'maxTotalTokens',
  'maxWallMs',
  'maxCostEur',
]

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
})

/** The caps a validated configuration actually enforces, paired with their values. */
interface ResolvedConfig {
  readonly caps: readonly (readonly [BudgetCapId, number])[]
  readonly pricing: Readonly<Record<string, BudgetRoutePricing>>
  /** Whether {@link pricing} names any route; an empty table never reads the log. */
  readonly prices: boolean
  /** {@link pricingTableDigest} of {@link pricing}, computed once at load. */
  readonly pricingDigest: string
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
  const caps: (readonly [BudgetCapId, number])[] = []
  for (const cap of CAP_ORDER) {
    const value = config[cap]
    if (value === undefined) continue
    requireFiniteCap(cap, value)
    caps.push([cap, value])
  }
  return { caps, pricing, prices, pricingDigest: pricingTableDigest(pricing) }
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

/**
 * Measure the session log against the enforced caps.
 * @param agent - the agent whose session log carries the spend.
 * @param resolved - the caps and pricing this deployment enforces.
 * @returns the first breach in {@link CAP_ORDER}, or `undefined` while every cap holds.
 */
function detectBreach(agent: Agent, resolved: ResolvedConfig): BudgetBreach | undefined {
  if (resolved.caps.length === 0) return undefined
  const spend = foldBudgetSpend(agent.session.events, resolved.pricing)
  for (const [cap, limit] of resolved.caps) {
    const measured = measuredFor(spend, cap)
    if (measured > limit) return { cap, measured, limit }
  }
  return undefined
}

/**
 * Block the session's goal so no goal-round driver continues it. The goal
 * domain is optional: a composition without `ctx.goals`, without a current
 * goal, or whose goal already left the `active` phase still gets the durable
 * breach record and the stopped turn.
 */
function blockGoal(ctx: Context, agent: Agent, breach: BudgetBreach): void {
  const goals = ctx.get('goals')
  if (goals === undefined) return
  const goal = goals.get(agent)
  if (goal === undefined || goal.phase !== 'active') return
  goals.block(agent, { id: goal.id, revision: goal.revision }, {
    code: BUDGET_EXHAUSTED,
    message: `Session budget ${breach.cap} exceeded: ${breach.measured} of ${breach.limit}.`,
  })
}

/**
 * Register the pre-step budget check and the pricing records for the lifetime
 * of `ctx`.
 * @param ctx - plugin context; both listeners are disposed with it.
 * @param config - the per-session caps and pricing to enforce.
 * @throws {TypeError} when the configuration cannot express the caps it declares.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveBudgetConfig(config)

  // Prepended so the budget decision precedes every listener that would build
  // request context or reserve continuation work for a step that cannot run.
  ctx.on('agent/pre-step', async ({ agent }, next): Promise<PreStepDecision> => {
    // Priced before the caps are read, so the last message before a breach is
    // priced by the same step that records the breach.
    priceUnpricedSteps(agent, resolved)
    const breach = detectBreach(agent, resolved)
    if (breach === undefined) return next()
    agent.session.append('budget/breach', breach)
    blockGoal(ctx, agent, breach)
    return { kind: 'reject' }
  }, { prepend: true })

  // A turn that closes normally opens no further step, so its final message is
  // priced at the stop boundary instead.
  ctx.on('agent/turn-stopping', ({ agent }) => {
    priceUnpricedSteps(agent, resolved)
  })
}
