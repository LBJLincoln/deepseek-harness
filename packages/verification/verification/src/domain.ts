/**
 * Host-side vocabulary of the completion-standard domain: durable change
 * payloads, replay fold shapes, and error codes. Kept separate from
 * ./types.ts (the pure outlet) because these declarations merge into the
 * session event vocabulary.
 * @module @deepseek-ai/dsh-verification
 */

import type {
  CertificateIsolation,
  CheckId,
  CheckResult,
  CompletionStandardSnapshot,
  DirectiveCluster,
  RunExecutor,
  RunParity,
  RunVerdict,
  StandardRef,
  VerificationCertificate,
} from './types.ts'

/** Standard mutations recorded by a durable `verification/standard` event. */
export type StandardOperation = 'author' | 'extend'

/** Full-snapshot standard mutation committed by `verification/standard`. */
export interface StandardChangeMeta {
  readonly kind: 'verification/standard'
  readonly version: 1
  readonly operation: StandardOperation
  readonly standard: CompletionStandardSnapshot
  readonly createdAt: number
  readonly updatedAt: number
}

/** One evidenced check removal committed by `verification/relaxation`. */
export interface RelaxationChangeMeta {
  readonly kind: 'verification/relaxation'
  readonly version: 1
  /** Check moved from the active set into the snapshot's relaxed list. */
  readonly checkId: CheckId
  /** Complete post-relaxation standard state. */
  readonly standard: CompletionStandardSnapshot
  readonly createdAt: number
  readonly updatedAt: number
}

/** One complete executed run committed by `verification/run`, passing or failing. */
export interface VerificationRunChangeMeta {
  readonly kind: 'verification/run'
  readonly version: 1
  /** Exact standard revision the run covered. */
  readonly standard: StandardRef
  /** One plus the runs already recorded for the same standard id, across its revisions. */
  readonly attempt: number
  /** Isolation level the run executed under. */
  readonly isolation: CertificateIsolation
  /** Executor of the checks. */
  readonly executor: RunExecutor
  /**
   * What the run means. A payload that omits it is read as its results decide
   * — `passed` when every result passed, `failed` otherwise — because only
   * `tampered` cannot be derived from them; `recordRun` always writes it.
   */
  readonly verdict: RunVerdict
  /** Every result of the run, passing or failing, in the standard's check order. */
  readonly results: readonly CheckResult[]
  /**
   * Weighted pass rate summed over the run's cased checks, absent when no check
   * carries cases. It records how much of the measured behaviour the candidate
   * reached and certifies nothing.
   */
  readonly parity?: RunParity
  /** Hex digest of the workspace tree the run covered, absent when the caller has none. */
  readonly treeHash?: string
  /** Epoch milliseconds of the run commit. */
  readonly recordedAt: number
}

/** Fully passing run committed by `verification/certificate`. */
export interface CertificateChangeMeta {
  readonly kind: 'verification/certificate'
  readonly version: 1
  readonly certificate: VerificationCertificate
}

/** Root-cause failure aggregation committed by `verification/directive`. */
export interface DirectiveChangeMeta {
  readonly kind: 'verification/directive'
  readonly version: 1
  /** Exact standard revision whose run produced the aggregated failures. */
  readonly standard: StandardRef
  readonly rootCause: string
  readonly detail: string
  /** Failure clusters the detail was built from, absent when no cased check failed. */
  readonly clusters?: readonly DirectiveCluster[]
  readonly issuedAt: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Complete post-mutation completion-standard state (author or extend).
     */
    'verification/standard': StandardChangeMeta
    /**
     * One evidenced check removal with the complete post-relaxation state.
     */
    'verification/relaxation': RelaxationChangeMeta
    /**
     * One executed run of the current standard revision, passing or failing.
     */
    'verification/run': VerificationRunChangeMeta
    /**
     * Fully passing run of the current standard revision.
     */
    'verification/certificate': CertificateChangeMeta
    /**
     * Root-cause failure aggregation addressed to the implementer.
     */
    'verification/directive': DirectiveChangeMeta
  }
}

/** Pure replay fold of durable completion-standard facts. */
export interface FoldedVerification {
  /** Current standard, absent before the first author mutation. */
  readonly standard?: CompletionStandardSnapshot
  /** Certificate covering exactly the current revision. */
  readonly certificate?: VerificationCertificate
  /** Count of directives issued across the session. */
  readonly directivesIssued: number
  /** Count of runs recorded across the session, passing or failing. */
  readonly runsRecorded: number
  /** Last run recorded in the session, absent before the first one. */
  readonly lastRun?: VerificationRunChangeMeta
  /** Current standard creation time, absent without a current standard. */
  readonly createdAt?: number
  /** Current standard mutation time, absent without a current standard. */
  readonly updatedAt?: number
  /** Latest standard mutation ref. */
  readonly lastRef?: StandardRef
}

/** Stable error codes for rejected completion-standard reads and mutations. */
export type VerificationErrorCode =
  | 'VERIFICATION_AGENT_NOT_LIVE'
  | 'VERIFICATION_STANDARD_NOT_FOUND'
  | 'VERIFICATION_STANDARD_EXISTS'
  | 'VERIFICATION_STALE_REVISION'
  | 'VERIFICATION_INVALID_CHECK'
  | 'VERIFICATION_INVALID_CASE'
  | 'VERIFICATION_INVALID_RELAXATION'
  | 'VERIFICATION_INVALID_RESULTS'
  | 'VERIFICATION_INVALID_DIRECTIVE'
  | 'VERIFICATION_NOT_CERTIFIED'
  | 'VERIFICATION_ISOLATION_UNPROVEN'
