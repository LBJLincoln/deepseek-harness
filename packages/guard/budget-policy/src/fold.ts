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
import type { AccountedMessage, BudgetCapId, BudgetRoutePricing, BudgetSpend } from './types.ts'

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
