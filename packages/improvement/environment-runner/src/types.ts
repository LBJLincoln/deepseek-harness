/**
 * Pure types of the environment runner: the run request, the implementer that
 * does its work, the durable record of one delegated attempt, and the run
 * report, free of host-side imports.
 *
 * @module @deepseek-ai/dsh-environment-runner/types
 */

import type { EnvironmentId, EnvironmentRunModel, EnvironmentRunStamp } from '@deepseek-ai/dsh-environments/types'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentStopReason } from '@deepseek-ai/dsh-subagent'
import type { CheckResult, VerificationCertificate } from '@deepseek-ai/dsh-verification/types'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One attempt of a delegated cell, appended after the child run settled
     * and before the runner validates the tree it left: which provider ran it,
     * the run's parent-scoped id, how it ended, the structured result it
     * returned, and the model usage this process can account for. Log-only —
     * it never enters model history, and it is the cell session's only record
     * of an implementer whose own transcript stays in its product.
     */
    'environment/delegation': EnvironmentDelegation
  }
}

/**
 * Who implements the work of one run: the session's own model route, driven
 * turn by turn as the runner has always driven it, or one out-of-band coding
 * agent started per attempt through the subagent seam.
 */
export type EnvironmentRunImplementer =
  | { readonly kind: 'route' }
  | {
    readonly kind: 'subagent'
    /** Registered `ctx.subagents` provider each attempt's child run starts on. */
    readonly provider: string
    /** Short display label persisted with a session-backed child; absent leaves the provider's own naming. */
    readonly label?: string
  }

/**
 * Durable record of one delegated attempt. It is what the cell session states
 * about an implementer that produced no model-visible history of its own.
 */
export interface EnvironmentDelegation {
  /** One-based attempt this child run implemented. */
  readonly attempt: number
  /** Subagent provider that ran the child. */
  readonly provider: string
  /** Parent-scoped id of the child run; the child's session id for an in-process provider. */
  readonly runId: SessionId
  /** How the child run ended, in the subagent seam's terminal vocabulary. */
  readonly stopReason: SubagentStopReason
  /** Structured result the child returned, absent when it returned none. */
  readonly structured?: unknown
  /**
   * Model usage of an in-process child's own session, summed over its
   * assistant messages. Absent for a child this process cannot account for,
   * which is every out-of-process provider: its tokens are spent in another
   * product and never reach a log here.
   */
  readonly usage?: TokenUsage
}

/** One request to run a registered environment as one fresh session. */
export interface EnvironmentRunRequest {
  /** Registered environment to run. */
  readonly environment: EnvironmentId
  /** Existing absolute directory the session is rooted at; the task fixture is overlaid onto it. */
  readonly workspace: string
  /** Model route for this run; absent uses the composition's default model selection. */
  readonly model?: EnvironmentRunModel
  /**
   * Who does the work of each attempt; absent runs the session's own model
   * route. A delegated run is validated identically: only the way the
   * workspace reaches its next state changes.
   */
  readonly implementer?: EnvironmentRunImplementer
  /** Zero-based repetition of this environment inside its batch; absent means `0`. */
  readonly repetition?: number
  /** Batch or sampling group the run belongs to, absent for a single run. */
  readonly group?: string
  /** District the run belongs to, written into the stamp so exports can withhold it; absent for a run outside every district. */
  readonly district?: string
  /**
   * Checkpoint or policy the implementer route serves, as the deployment names
   * it, written into the stamp verbatim; absent for a route the deployment did
   * not version.
   */
  readonly policyVersion?: string
  /**
   * Sampling seed every request of the run asks for, a safe non-negative
   * integer written into the stamp; absent leaves the composition's own
   * sampling in place.
   */
  readonly seed?: number
  /** Aborts the implementer's turns and the check commands when it fires. */
  readonly signal?: AbortSignal
}

/**
 * One attempt: the implementer's turn followed by one run of the current
 * standard. The attempt's verdict is durable rather than reported: it is the
 * `verdict` of the `verification/run` this attempt recorded.
 */
export interface EnvironmentRunAttempt {
  /** One-based attempt number. */
  readonly attempt: number
  /** One result per active check, in the standard's check order; a tampered attempt executed none of them. */
  readonly results: readonly CheckResult[]
  /**
   * SHA-256 digest of the workspace as the validation began, after the fixture
   * was restored over it; a tampered attempt digests the workspace it refused
   * to measure, without restoring anything.
   */
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
