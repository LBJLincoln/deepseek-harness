/**
 * Pure pricing arithmetic shared by the log fold, the durable pricing records,
 * and the invariant companion, plus the digest that names which pricing table
 * priced a step. One expression prices tokens everywhere in this package, so a
 * recorded `costEur` and its recomputation agree bit for bit.
 *
 * @module @deepseek-ai/dsh-budget-policy
 */

import { createHash } from 'node:crypto'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { BudgetRoutePricing } from './types.ts'

/** Tokens per pricing unit; the table is quoted per one million tokens. */
const PRICING_UNIT_TOKENS = 1_000_000

/**
 * The pricing-table key one provider route is configured under.
 * @param provider - provider id from an assistant message's provenance.
 * @param model - model id from an assistant message's provenance.
 * @returns the `provider/model` table key.
 */
export function routeKey(provider: string, model: string): string {
  return `${provider}/${model}`
}

/**
 * Billed input tokens for one step: uncached input plus cache reads and writes.
 * @param usage - the provider accounting an assistant message carried.
 * @returns the billed input token count.
 */
export function billedInputTokens(usage: TokenUsage): number {
  return usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
}

/**
 * Price billed tokens at one route's rates.
 * @param inputTokens - billed input tokens.
 * @param outputTokens - output tokens as the provider reported them.
 * @param rates - EUR per one million input and output tokens.
 * @returns the EUR those tokens cost at those rates.
 */
export function costEurFor(inputTokens: number, outputTokens: number, rates: BudgetRoutePricing): number {
  return (inputTokens * rates.inputEurPerMillionTokens + outputTokens * rates.outputEurPerMillionTokens)
    / PRICING_UNIT_TOKENS
}

/**
 * Digest one deployment's pricing table so every record it priced names the
 * rates in force. Route keys are ordered by code unit and each entry is
 * serialized as its input rate then its output rate, so two deployments holding
 * the same rates agree whatever order their `cordis.yml` listed the routes in,
 * and one changed rate changes the digest.
 * @param pricing - EUR-per-million rates keyed by `provider/model`.
 * @returns lowercase SHA-256 hex of the canonical table.
 */
export function pricingTableDigest(pricing: Readonly<Record<string, BudgetRoutePricing>>): string {
  const canonical = Object.fromEntries(Object.entries(pricing)
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([route, rates]): [string, BudgetRoutePricing] => [route, {
      inputEurPerMillionTokens: rates.inputEurPerMillionTokens,
      outputEurPerMillionTokens: rates.outputEurPerMillionTokens,
    }]))
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex')
}
