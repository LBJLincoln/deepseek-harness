/**
 * Pure session-log fold behind every budget decision. The policy plugin and the
 * invariant companion both read spend through it, so a recorded breach is
 * recomputable from the same events by anyone holding the log.
 *
 * @module @deepseek-ai/dsh-budget-policy
 */

import { assertNever } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { BudgetCapId, BudgetRoutePricing, BudgetSpend } from './types.ts'

/** Tokens per pricing unit; the table is quoted per one million tokens. */
const PRICING_UNIT_TOKENS = 1_000_000

/** The pricing-table key one provider route is configured under. */
function routeKey(provider: string, model: string): string {
  return `${provider}/${model}`
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
    if (event.type !== 'assistant/message') continue
    const usage = event.data.usage
    if (usage === undefined) continue
    const input = usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
    inputTokens += input
    outputTokens += usage.outputTokens
    const { provider, model } = event.data.message.source
    const rates = pricing[routeKey(provider, model)]
    if (rates === undefined) continue
    costEur += (input * rates.inputEurPerMillionTokens + usage.outputTokens * rates.outputEurPerMillionTokens)
      / PRICING_UNIT_TOKENS
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
