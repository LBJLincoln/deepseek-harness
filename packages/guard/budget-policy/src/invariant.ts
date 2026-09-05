/**
 * Package-owned invariant: every durable `budget/breach` states a measurement
 * that the events preceding it reproduce. Token and wall-clock caps are folded
 * from the log alone, so the companion recomputes them independently of the
 * policy that wrote the record; `maxCostEur` depends on the deployment pricing
 * table, which is not in the log, so a cost breach is checked only for the
 * exceeded-its-limit relation every breach must satisfy.
 *
 * @module @deepseek-ai/dsh-budget-policy/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { foldBudgetSpend, measuredFor } from './fold.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-budget-policy'

/** Cordis companion plugin name. */
export const name = 'budget-policy-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Validate one candidate event against the durable prefix that precedes it. */
function validateEvent(
  prior: readonly SessionEvent[],
  event: SessionEvent,
  fail: InvariantFailure,
): void {
  if (event.type !== 'budget/breach') return
  const { cap, measured, limit } = event.data
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

/** Check existing sessions and every candidate event before Session publishes it. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  for (const session of ctx.sessions.list()) {
    const prior: SessionEvent[] = []
    for (const event of session.events) {
      validateEvent(prior, event, fail)
      prior.push(event)
    }
  }
  /* jscpd:ignore-start -- package companions share dispatch and registration plumbing */
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    validateEvent(session.events, event, fail)
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register the budget-breach invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
