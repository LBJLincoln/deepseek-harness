/**
 * Pure types of the data-use pin: the purposes a session's transcript may serve
 * and the one `dataUse/terms` event that states the contract terms a session was
 * created under.
 *
 * @module @deepseek-ai/dsh-data-use/types
 */

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The contract terms this session's transcript is held under: the client
     * and agreement it belongs to, what it may be used for, where it may live,
     * how long it is kept, and which redaction profile an export applies.
     * Appended once at session start, and again for every later pin that
     * narrows the terms; the newest record is the one consumers read. Log-only
     * and never part of a model request.
     */
    'dataUse/terms': DataUseTerms
  }
}

/**
 * What a session's transcript may serve: `delivery` is the client work itself,
 * `training` admits it to a training corpus, `evaluation` admits it to
 * measurement. A session carries the subset its agreement grants.
 */
export type DataUsePurpose = 'delivery' | 'training' | 'evaluation'

/** Payload of `dataUse/terms`. */
export interface DataUseTerms {
  /** The client the transcript belongs to; cards hash it rather than showing it. */
  readonly clientId: string
  /** The agreement these terms come from. */
  readonly agreementId: string
  /** Non-empty subset of {@link DataUsePurpose}, in the order the terms list them. */
  readonly purposes: readonly DataUsePurpose[]
  /** Region the transcript may live in. */
  readonly residency: string
  /** Positive number of days the transcript is kept. */
  readonly retentionDays: number
  /** Versioned redaction profile an export applies to this transcript. */
  readonly redactionProfile: string
}
