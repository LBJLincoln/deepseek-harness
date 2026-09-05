/**
 * Pure types of the environment runner: the run request and the run report,
 * free of host-side imports.
 *
 * @module @deepseek-ai/dsh-environment-runner/types
 */

import type { EnvironmentId, EnvironmentRunModel, EnvironmentRunStamp } from '@deepseek-ai/dsh-environments/types'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { CheckResult, VerificationCertificate } from '@deepseek-ai/dsh-verification/types'

/** One request to run a registered environment as one fresh session. */
export interface EnvironmentRunRequest {
  /** Registered environment to run. */
  readonly environment: EnvironmentId
  /** Existing absolute directory the session is rooted at; the task fixture is overlaid onto it. */
  readonly workspace: string
  /** Model route for this run; absent uses the composition's default model selection. */
  readonly model?: EnvironmentRunModel
  /** Zero-based repetition of this environment inside its batch; absent means `0`. */
  readonly repetition?: number
  /** Batch or sampling group the run belongs to, absent for a single run. */
  readonly group?: string
  /** Aborts the implementer's turns and the check commands when it fires. */
  readonly signal?: AbortSignal
}

/** One attempt: the implementer's turn followed by one run of the current standard. */
export interface EnvironmentRunAttempt {
  /** One-based attempt number. */
  readonly attempt: number
  /** One result per active check, in the standard's check order. */
  readonly results: readonly CheckResult[]
  /** SHA-256 digest of the workspace as the validation began, after the fixture was restored over it. */
  readonly treeHash: string
}

/** Outcome of one environment run, returned after the session is flushed. */
export interface EnvironmentRunReport {
  /** Environment that was run. */
  readonly environment: EnvironmentId
  /** Session the run created; its log is the durable record. */
  readonly sessionId: SessionId
  /** The `environment/run` stamp the session log carries, exactly as appended. */
  readonly stamp: EnvironmentRunStamp
  /** Every attempt in order; the last one decided `certified`. */
  readonly attempts: readonly EnvironmentRunAttempt[]
  /** Whether a run of the standard passed completely and the goal completed. */
  readonly certified: boolean
  /** Certificate of the passing run, present exactly when `certified` is `true`. */
  readonly certificate?: VerificationCertificate
  /** Model usage summed over every assistant message of the session, absent when the model produced none. */
  readonly usage?: TokenUsage
}
