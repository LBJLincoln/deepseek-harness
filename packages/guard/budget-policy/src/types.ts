/**
 * Pure budget vocabulary: the enforced cap names, the durable breach and
 * pricing payloads with their `SessionEventMap` declarations, the deployment
 * pricing entry, and the spend record the log fold produces. Kept free of
 * cordis, agent, and service imports so the fold, the plugin, and the
 * invariant companion share one home.
 *
 * @module @deepseek-ai/dsh-budget-policy
 */

import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** One enforced cap name; also the `Config` key that sets it. */
export type BudgetCapId =
  | 'maxInputTokens'
  | 'maxOutputTokens'
  | 'maxTotalTokens'
  | 'maxWallMs'
  | 'maxCostEur'

/** EUR per one million tokens for one `provider/model` route. */
export interface BudgetRoutePricing {
  /** EUR per one million billed input tokens (uncached input plus cache reads and writes). */
  readonly inputEurPerMillionTokens: number
  /** EUR per one million output tokens. */
  readonly outputEurPerMillionTokens: number
}

/**
 * Session spend folded from the durable log. Token counts and cost cover every
 * `assistant/message` that carried provider `usage`; `wallMs` spans the log's
 * first and last event times, so it counts idle gaps between events but not
 * time elapsed since the newest event.
 */
export interface BudgetSpend {
  /** Billed input tokens: uncached input plus cache reads and writes. */
  readonly inputTokens: number
  /** Output tokens, reasoning output included as the provider reported it. */
  readonly outputTokens: number
  /** {@link inputTokens} plus {@link outputTokens}. */
  readonly totalTokens: number
  /** Milliseconds between the log's first and last event times; `0` for an empty log. */
  readonly wallMs: number
  /** EUR priced from the configured table; usage on an unpriced route adds nothing. */
  readonly costEur: number
}

/** The durable record of one cap that stopped the next model request. */
export interface BudgetBreach {
  /** The cap that tripped. */
  readonly cap: BudgetCapId
  /** Spend measured from the log at the moment the step was stopped. */
  readonly measured: number
  /** The configured value {@link measured} exceeded. */
  readonly limit: number
}

/**
 * One `assistant/message` event whose provider accounting is present. The
 * pricing helpers select and return this narrowed form, so a caller holding one
 * reads `usage` without repeating the presence check.
 */
export type AccountedMessage = SessionEvent<'assistant/message'> & { data: { usage: TokenUsage } }

/** The durable price of one step, in the rates the configured table held. */
export interface UsagePriced {
  /** The turn that owned the priced step. */
  readonly turn: number
  /** The priced step within {@link turn}. */
  readonly step: number
  /** Provider of the route that served the step. */
  readonly provider: string
  /** Model of the route that served the step. */
  readonly model: string
  /** Billed input tokens: uncached input plus cache reads and writes. */
  readonly inputTokens: number
  /** Output tokens as the provider reported them. */
  readonly outputTokens: number
  /** EUR per one million billed input tokens applied to this step. */
  readonly inputEurPerMillionTokens: number
  /** EUR per one million output tokens applied to this step. */
  readonly outputEurPerMillionTokens: number
  /** EUR this step cost at the recorded rates. */
  readonly costEur: number
  /** Digest of the whole pricing table these rates came from. */
  readonly pricingDigest: string
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One configured session budget stopped the step that was about to make a
     * model request: the cap that tripped, the spend measured from the events
     * preceding this one, and the configured value that spend exceeded. The
     * step is rejected after this event, so the record is the only durable
     * explanation for a turn that ends without a model call.
     */
    'budget/breach': BudgetBreach
    /**
     * One `assistant/message` of a priced route — a `provider/model` the
     * configured pricing table names — priced at the rates that table held:
     * `costEur = (inputTokens * inputEurPerMillionTokens + outputTokens *
     * outputEurPerMillionTokens) / 1_000_000`, with `pricingDigest` naming the
     * table version those rates came from. A route the table does not name gets
     * no event, so cost per session replays from the log for exactly the steps
     * the deployment had priced when they ran.
     */
    'usage/priced': UsagePriced
  }
}
