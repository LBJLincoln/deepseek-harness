/**
 * Pure budget vocabulary: the enforced cap names, the durable breach payload
 * and its `SessionEventMap` declaration, the deployment pricing entry, and the
 * spend record the log fold produces. Kept free of cordis, agent, and service
 * imports so the fold, the plugin, and the invariant companion share one home.
 *
 * @module @deepseek-ai/dsh-budget-policy
 */

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
  }
}
