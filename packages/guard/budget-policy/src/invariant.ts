/**
 * Package-owned invariants over the two durable records this package writes.
 *
 * Every `budget/breach` states a measurement that the events preceding it
 * reproduce. Token and wall-clock caps are folded from the log alone, so the
 * companion recomputes them independently of the policy that wrote the record;
 * `maxCostEur` depends on the deployment pricing table, which is not in the
 * log, so a cost breach is checked only for the exceeded-its-limit relation
 * every breach must satisfy.
 *
 * Every `usage/priced` cites one earlier `assistant/message` of the same step
 * whose accounting and route it reproduces, prices its own recorded tokens at
 * its own recorded rates, and is the first record of that step — the rates come
 * from the record itself, so cost is recomputable from the log alone.
 *
 * @module @deepseek-ai/dsh-budget-policy/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import { sessionEventValidator } from '@deepseek-ai/dsh-invariants'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { foldBudgetSpend, measuredFor } from './fold.ts'
import { billedInputTokens, costEurFor, routeKey } from './pricing.ts'
import type { BudgetBreach, UsagePriced } from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-budget-policy'

/** Cordis companion plugin name. */
export const name = 'budget-policy-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Validate one recorded breach against the durable prefix that precedes it. */
function validateBreach(
  prior: readonly SessionEvent[],
  breach: BudgetBreach,
  fail: InvariantFailure,
): void {
  const { cap, measured, limit } = breach
  if (!(measured > limit)) {
    fail(`budget/breach records ${cap} measured ${measured} which does not exceed its limit ${limit}`)
  }
  // Cost is priced from configuration the log does not carry, so only the
  // log-derived caps are recomputable here.
  if (cap === 'maxCostEur') return
  const recomputed = measuredFor(foldBudgetSpend(prior, {}), cap)
  if (recomputed !== measured) {
    fail(`budget/breach records ${cap} measured ${measured}, but folding the preceding events yields ${recomputed}`)
  }
}

/** Validate one recorded price against the durable prefix that precedes it. */
function validatePriced(
  prior: readonly SessionEvent[],
  priced: UsagePriced,
  fail: InvariantFailure,
): void {
  const step = `turn ${priced.turn} step ${priced.step}`
  for (const earlier of prior) {
    if (earlier.type !== 'usage/priced') continue
    if (earlier.data.turn !== priced.turn || earlier.data.step !== priced.step) continue
    fail(`usage/priced prices ${step}, which seq ${earlier.seq} already priced`)
  }
  const cited = prior.find((event): event is SessionEvent<'assistant/message'> =>
    event.type === 'assistant/message' && event.data.turn === priced.turn && event.data.step === priced.step)
  if (cited === undefined) return fail(`usage/priced prices ${step}, which no preceding assistant/message reports`)
  const usage = cited.data.usage
  if (usage === undefined
    || billedInputTokens(usage) !== priced.inputTokens
    || usage.outputTokens !== priced.outputTokens) {
    fail(`usage/priced prices ${priced.inputTokens} input and ${priced.outputTokens} output tokens for ${step}, which its assistant/message does not report`)
  }
  const { provider, model } = cited.data.message.source
  if (provider !== priced.provider || model !== priced.model) {
    fail(`usage/priced prices ${step} on route ${routeKey(priced.provider, priced.model)}, which its assistant/message reports as ${routeKey(provider, model)}`)
  }
  const recomputed = costEurFor(priced.inputTokens, priced.outputTokens, priced)
  if (recomputed !== priced.costEur) {
    fail(`usage/priced records costEur ${priced.costEur} for ${step}, but its own rates price its own tokens at ${recomputed}`)
  }
}

/** Validate one candidate event against the durable prefix that precedes it. */
function validateEvent(
  prior: readonly SessionEvent[],
  event: SessionEvent,
  fail: InvariantFailure,
): void {
  if (event.type === 'budget/breach') {
    validateBreach(prior, event.data, fail)
    return
  }
  if (event.type === 'usage/priced') validatePriced(prior, event.data, fail)
}

/** Check existing sessions and every candidate event before Session publishes it. */
const install: InvariantInstaller = sessionEventValidator(validateEvent, ctx => ctx.sessions.list())

/**
 * Register the budget-breach invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
