/**
 * Pure session-log folds behind every budget decision: the spend a cap is
 * measured against, and the steps whose price the log does not yet state. The
 * policy plugin and the invariant companion both read through them, so a
 * recorded breach or price is recomputable from the same events by anyone
 * holding the log.
 *
 * @module @deepseek-ai/dsh-budget-policy
 */

import { assertNever } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { billedInputTokens, costEurFor, routeKey } from './pricing.ts'
import type { AccountedMessage, BudgetCapId, BudgetCaps, BudgetRoutePricing, BudgetSpend } from './types.ts'

/**
 * Evaluation order of the caps. The first cap the log exceeds is the one
 * recorded, so this order decides which breach a session that overruns two
 * caps in the same step reports, and it is the order every enforced cap list
 * is rendered in.
 */
export const BUDGET_CAP_ORDER: readonly BudgetCapId[] = [
  'maxInputTokens',
  'maxOutputTokens',
  'maxTotalTokens',
  'maxWallMs',
  'maxCostEur',
]

/** The key one step is identified by within its own session log. */
function stepKey(turn: number, step: number): string {
  return `${turn}/${step}`
}

/** Whether one event is an assistant message the provider reported accounting for. */
function isAccounted(event: SessionEvent): event is AccountedMessage {
  return event.type === 'assistant/message' && event.data.usage !== undefined
}

/**
 * Fold billed spend and elapsed wall time out of one session log.
 *
 * Only `assistant/message` carries a step's final provider accounting, so it is
 * the single usage source: the earlier `assistant/chunk` usage sample for the
 * same step is deliberately ignored rather than counted twice. Each message
 * prices against its own `provider/model` provenance, so a route switch mid
 * session bills each step at the rate configured for the route that served it;
 * a route absent from `pricing` contributes tokens but no cost.
 *
 * @param events - the session events to fold, oldest first.
 * @param pricing - EUR-per-million rates keyed by `provider/model`.
 * @returns the spend measured over exactly those events.
 */
export function foldBudgetSpend(
  events: readonly SessionEvent[],
  pricing: Readonly<Record<string, BudgetRoutePricing>>,
): BudgetSpend {
  let inputTokens = 0
  let outputTokens = 0
  let costEur = 0
  for (const event of events) {
    if (!isAccounted(event)) continue
    const input = billedInputTokens(event.data.usage)
    inputTokens += input
    outputTokens += event.data.usage.outputTokens
    const { provider, model } = event.data.message.source
    const rates = pricing[routeKey(provider, model)]
    if (rates === undefined) continue
    costEur += costEurFor(input, event.data.usage.outputTokens, rates)
  }
  const first = events[0]
  const last = events[events.length - 1]
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    wallMs: first === undefined || last === undefined ? 0 : last.time - first.time,
    costEur,
  }
}

/**
 * Select the priced-route steps the log does not yet state a price for.
 *
 * The selection is a function of the log alone, so a resumed session prices
 * exactly the steps its predecessor left unpriced and never prices one twice: a
 * step is skipped once any `usage/priced` in the log carries its turn and step.
 * A message without provider accounting, and a message on a `provider/model`
 * the table does not name, are both skipped — an unpriced route has no rate to
 * record.
 *
 * @param events - the session events to read, oldest first.
 * @param pricing - EUR-per-million rates keyed by `provider/model`.
 * @returns the messages awaiting a durable price, in log order.
 */
export function unpricedUsage(
  events: readonly SessionEvent[],
  pricing: Readonly<Record<string, BudgetRoutePricing>>,
): readonly AccountedMessage[] {
  const priced = new Set<string>()
  for (const event of events) {
    if (event.type !== 'usage/priced') continue
    priced.add(stepKey(event.data.turn, event.data.step))
  }
  const pending: AccountedMessage[] = []
  for (const event of events) {
    if (!isAccounted(event)) continue
    const { provider, model } = event.data.message.source
    if (pricing[routeKey(provider, model)] === undefined) continue
    if (priced.has(stepKey(event.data.turn, event.data.step))) continue
    pending.push(event)
  }
  return pending
}

/**
 * Read the ceilings one session's own log records for itself.
 *
 * Last-wins: a session that records its caps twice runs under the newest
 * record alone, which is what makes the caps a function of the log rather than
 * of the order a reader happens to visit the events in.
 *
 * @param events - the session events to read, oldest first.
 * @returns the latest recorded caps, empty when the log records none.
 */
export function foldSessionCaps(events: readonly SessionEvent[]): BudgetCaps {
  let caps: BudgetCaps = {}
  for (const event of events) {
    if (event.type === 'budget/caps') caps = event.data
  }
  return caps
}

/**
 * Tighten the deployment's enforced caps by the ceilings one session recorded.
 *
 * A cap only the session records applies as written, and a cap both carry
 * applies at the smaller of the two, so a recorded ceiling can only ever narrow
 * what the deployment configured.
 *
 * @param configured - the deployment's enforced caps, in {@link BUDGET_CAP_ORDER}.
 * @param session - the caps the session's log records for itself.
 * @returns the caps to measure this session against, in {@link BUDGET_CAP_ORDER}.
 */
export function tightenedCaps(
  configured: readonly (readonly [BudgetCapId, number])[],
  session: BudgetCaps,
): readonly (readonly [BudgetCapId, number])[] {
  const byCap = new Map<BudgetCapId, number>(configured)
  for (const cap of BUDGET_CAP_ORDER) {
    const recorded = session[cap]
    if (recorded === undefined) continue
    const current = byCap.get(cap)
    byCap.set(cap, current === undefined ? recorded : Math.min(current, recorded))
  }
  return BUDGET_CAP_ORDER.flatMap((cap) => {
    const value = byCap.get(cap)
    return value === undefined ? [] : [[cap, value] as const]
  })
}

/**
 * Read the spend one cap is measured against.
 * @param spend - folded session spend.
 * @param cap - the cap whose measurement is wanted.
 * @returns the measured value for that cap.
 */
export function measuredFor(spend: BudgetSpend, cap: BudgetCapId): number {
  switch (cap) {
    case 'maxInputTokens':
      return spend.inputTokens
    case 'maxOutputTokens':
      return spend.outputTokens
    case 'maxTotalTokens':
      return spend.totalTokens
    case 'maxWallMs':
      return spend.wallMs
    case 'maxCostEur':
      return spend.costEur
    /* v8 ignore next 2 -- BudgetCapId is closed and every member is handled above */
    default:
      return assertNever(cap, 'budget cap measurement')
  }
}
