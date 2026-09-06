/**
 * Pure vocabulary of the blind judge: what an audit is asked to decide, the two
 * durable records it writes, and the verdict it can reach.
 *
 * @module @deepseek-ai/dsh-judge/types
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { CheckResult, VerificationCertificate } from '@deepseek-ai/dsh-verification/types'

/**
 * What one audit decided about the attempt it read.
 *
 * `upheld` means the evidence supports the outcome the attempt recorded,
 * `overturned` that it contradicts it, and `inconclusive` that the evidence
 * cannot decide — which is also what a reply naming no verdict records, because
 * a judge that did not answer decided nothing.
 */
export type JudgeVerdict = 'upheld' | 'overturned' | 'inconclusive'

/** One attempt handed to a judge, with everything the judge is allowed to read. */
export interface JudgeRequest {
  /** Session whose attempt is audited. It is named in the records and never opened. */
  readonly auditedSessionId: SessionId
  /** One-based attempt number, as the audited run counted it. */
  readonly attempt: number
  /** Workspace digest the attempt recorded; the judge's copy must reproduce it exactly. */
  readonly treeHash: string
  /** Absolute directory holding the audited tree, copied into a fresh judge workspace. */
  readonly workspace: string
  /** The task prompt the implementer worked from, delivered to the judge verbatim. */
  readonly taskPrompt: string
  /** The attempt's check results; only their ids, verdicts, and case tallies reach the judge. */
  readonly results: readonly CheckResult[]
  /** Certificate the attempt earned, absent when it earned none. */
  readonly certificate?: VerificationCertificate
  /** Model route for the judge's own turn; absent leaves the composition's route in force. */
  readonly model?: {
    /** Registered provider route. */
    readonly provider: string
    /** Provider-owned model id. */
    readonly model: string
  }
  /** Aborts the judge's turn when it fires. */
  readonly signal?: AbortSignal
}

/**
 * One judge session's lineage assertion, as the `judge/session` event carries
 * it. It is written into the judge's own log, which is where the invariant
 * companion reads it: a verdict from a session with no such record, or from one
 * whose header carries a parent or a seed, is refused.
 */
export interface JudgeSessionRecord {
  /** The judge session this record was appended to. */
  readonly judgeSessionId: SessionId
  /** Session whose attempt this judge audits. */
  readonly auditedSessionId: SessionId
  /** One-based attempt number under audit. */
  readonly attempt: number
  /** Workspace digest the judge's copy reproduced before the session was created. */
  readonly treeHash: string
}

/** One reached verdict, as the `judge/verdict` event carries it. */
export interface JudgeVerdictRecord {
  /** Session whose attempt was audited. */
  readonly auditedSessionId: SessionId
  /** One-based attempt number that was audited. */
  readonly attempt: number
  /** What the judge decided. */
  readonly verdict: JudgeVerdict
  /** The judge's own reason, bounded by the deployment's `rationaleMaxChars`. */
  readonly rationale: string
}

/** One completed audit, returned to the caller that asked for it. */
export interface JudgeAudit extends JudgeVerdictRecord {
  /** The lineage-free session the judge ran in; its log is the durable record. */
  readonly judgeSessionId: SessionId
  /** Absolute judge workspace holding the copy the judge was given. */
  readonly judgeWorkspace: string
  /** Workspace digest the copy reproduced. */
  readonly treeHash: string
}
