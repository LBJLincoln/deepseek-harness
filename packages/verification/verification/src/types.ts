/**
 * Pure types of the completion-standard domain: identities, checks, standard
 * snapshots, run results, and certificates, free of this package's host-side
 * imports. Host-coupled vocabulary (durable change payloads, fold shapes,
 * error codes) lives in ./domain.ts.
 *
 * @module @deepseek-ai/dsh-verification/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { GoalId } from '@deepseek-ai/dsh-goal/types'

/** Identifies one completion standard across its durable revisions. */
export type StandardId = Branded<'StandardId'>

/** Identifies one check inside its owning standard. */
export type CheckId = Branded<'CheckId'>

/** Compare-and-set identity for one exact standard revision. */
export interface StandardRef {
  /** Stable standard identity. */
  readonly id: StandardId
  /** Positive revision; every durable mutation increments it. */
  readonly revision: number
}

/** One executable check: the outcome it establishes and how a validator runs it. */
export interface StandardCheck {
  /** Lower-kebab-case identity unique inside the owning standard. */
  readonly id: CheckId
  /** Outcome the task must establish, stated without the implementation. */
  readonly outcome: string
  /** Validator-owned execution instruction (command line or procedure). */
  readonly run: string
}

/** A check removed from the active set together with its unsatisfiability evidence. */
export interface RelaxedCheck {
  /** The exact check that was removed. */
  readonly check: StandardCheck
  /** Recorded evidence that the stricter form is unsatisfiable. */
  readonly evidence: string
}

/** Full durable state written by every standard mutation. */
export interface CompletionStandardSnapshot extends StandardRef {
  /** Goal whose completion this standard measures. */
  readonly goalId: GoalId
  /** Active checks a certificate must cover, in authored order. */
  readonly checks: readonly StandardCheck[]
  /** Relaxations applied so far, in application order. */
  readonly relaxed: readonly RelaxedCheck[]
}

/** Verdict of one executed check. */
export type CheckStatus = 'pass' | 'fail'

/** Result of running one check against the workspace. */
export interface CheckResult {
  /** Check this result answers. */
  readonly checkId: CheckId
  /** Verdict of the run. */
  readonly status: CheckStatus
  /** Non-empty run evidence (command output summary, comparison, or location). */
  readonly evidence: string
}

/**
 * Isolation the standard and its fixtures had from the implementer while the
 * certified run executed. Every level above `none` is refused unless the
 * session's own log carries the enforcement it asserts:
 *
 * - `none` asserts nothing; implementer and validator share a filesystem.
 * - `process` asserts that no executor of the implementer's session opened a
 *   denied path: a `read-barrier/scope` census recorded before the session's
 *   first request, with role `implementer`, no composed capability left
 *   `unenforced`, and no visible tool carrying an authority.
 * - `host` asserts everything `process` does plus a `read-barrier/attestation`
 *   the barrier verified from a file this account cannot write.
 */
export type CertificateIsolation = 'none' | 'process' | 'host'

/** Durable record of one fully passing run of the current standard. */
export interface VerificationCertificate {
  /** Exact standard revision the run covered. */
  readonly standard: StandardRef
  /** Goal the certified standard measures. */
  readonly goalId: GoalId
  /** Isolation level the certified run executed under. */
  readonly isolation: CertificateIsolation
  /**
   * Executor of the certified run, copied from the `verification/run` this
   * certificate cites. An `agent-reported` run is the implementer's own account
   * of its checks, so it may certify only at `isolation: 'none'`.
   */
  readonly executor: RunExecutor
  /** One passing result per active check, in the standard's check order. */
  readonly results: readonly CheckResult[]
  /** Epoch milliseconds of the certificate commit. */
  readonly recordedAt: number
}

/** Executor of one recorded run's checks. */
export type RunExecutor = 'runner' | 'agent-reported'

/** How one recorded run was produced, beside its results. */
export interface RunEvidence {
  /** Executor of the checks: an automated validator, or the agent's own report. */
  readonly executor: RunExecutor
  /** Hex digest of the workspace tree the run covered, absent when the caller has none. */
  readonly treeHash?: string
}

/** Root-cause failure aggregation a validator hands the orchestrator. */
export interface DirectiveRequest {
  /** Failure cluster's root cause, stated for the implementer. */
  readonly rootCause: string
  /** Actionable detail that does not reveal individual check contents. */
  readonly detail: string
}

/** Outcome of recording one run: a certificate, or the failing subset. */
export type RunOutcome =
  | { readonly certified: true; readonly certificate: VerificationCertificate }
  | { readonly certified: false; readonly failures: readonly CheckResult[] }

/** Current standard projection, including values derived from the session log. */
export interface StandardView extends CompletionStandardSnapshot {
  /** Epoch milliseconds of the author mutation. */
  readonly createdAt: number
  /** Epoch milliseconds of the latest mutation. */
  readonly updatedAt: number
  /** Certificate covering exactly this revision, absent until a fully passing run. */
  readonly certificate?: VerificationCertificate
  /** Count of directives issued against this standard's goal so far. */
  readonly directivesIssued: number
  /** Count of runs recorded across the session, passing or failing. */
  readonly runsRecorded: number
}

/** Fields required to author a standard for one goal. */
export interface AuthorStandardRequest {
  /** Goal whose completion the standard will measure. */
  readonly goalId: GoalId
  /** Initial non-empty check inventory. */
  readonly checks: readonly StandardCheck[]
}

/**
 * The `verification` projection value: the current standard exactly as the
 * latest verification events carried it, with its covering certificate and
 * the session's cumulative directive and run counts.
 */
export interface VerificationProjection {
  /** Current standard snapshot. */
  readonly standard: CompletionStandardSnapshot
  /** Certificate covering exactly the current revision, absent otherwise. */
  readonly certificate?: VerificationCertificate
  /** Count of directives issued across the session. */
  readonly directivesIssued: number
  /** Count of runs recorded across the session, passing or failing. */
  readonly runsRecorded: number
  /** Epoch milliseconds of the author mutation. */
  readonly createdAt: number
  /** Epoch milliseconds of the latest standard mutation. */
  readonly updatedAt: number
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /**
     * The session's current completion standard (last-wins over the five
     * verification events), or `null` before the first authorship.
     */
    verification: VerificationProjection | null
  }
}
