/**
 * Pure types of the environment runner: the run request, the implementer that
 * does its work, the durable record of one delegated attempt, and the run
 * report, free of host-side imports.
 *
 * @module @deepseek-ai/dsh-environment-runner/types
 */

import type { BudgetCap } from '@deepseek-ai/dsh-budget-policy'
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
     * returned, the model usage this process can account for, and the model and
     * spend the child's own backend reported. Log-only — it never enters model
     * history, and it is the cell session's only record of an implementer whose
     * own transcript stays in its product.
     *
     * The model the cell ASKED for is on the `environment/run` stamp — its
     * `ladder` rung for this attempt, or its `model` for a run without one —
     * which the runner also passes to the provider, so a reader comparing the
     * two sees whether the child ran the arm's model and which concrete version
     * an alias resolved to.
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
 * What one implementer carries from an attempt into the next one. A route
 * implementer works in the cell session itself, so every later attempt reads
 * the whole transcript of the earlier ones (`kept`); a subagent implementer
 * runs one fresh child per attempt, which starts from the text it is given and
 * nothing else (`dropped`). The two therefore measure different instruments on
 * the same ladder, which is why every attempt states which it ran under.
 */
export type EnvironmentRunTranscript = 'kept' | 'dropped'

/**
 * How one delegated attempt ended: in the subagent seam's terminal vocabulary
 * when the child settled on its own, or `budget-deadline` when the cell's wall
 * budget ran out first.
 *
 * The runner cancels a child at that deadline, so the seam would report the
 * cancellation as its own `aborted`. Recording it apart is what lets a reader
 * tell an operator's cancellation from a cell that ran out of the wall budget
 * its arm was measured under; a `budget-deadline` attempt is always followed by
 * the `budget/breach` that stopped the run.
 */
export type EnvironmentDelegationStopReason = SubagentStopReason | 'budget-deadline'

/**
 * Durable record of one delegated attempt. It is what the cell session states
 * about an implementer that produced no model-visible history of its own.
 */
export interface EnvironmentDelegation {
  /** One-based attempt this child run implemented. */
  readonly attempt: number
  /**
   * Whether this attempt's prompt restated the task statement ahead of the
   * validation directive. A child holds no transcript of the earlier attempts,
   * so every attempt after the first restates the task; `false` on the first
   * attempt, whose prompt is the task statement alone. It is what tells a
   * reader that a later child was given the work and not only the complaint.
   */
  readonly restatedTask: boolean
  /** Subagent provider that ran the child. */
  readonly provider: string
  /** Parent-scoped id of the child run; the child's session id for an in-process provider. */
  readonly runId: SessionId
  /** How the child run ended. */
  readonly stopReason: EnvironmentDelegationStopReason
  /** Structured result the child returned, absent when it returned none. */
  readonly structured?: unknown
  /**
   * Model usage of an in-process child's own session, summed over its
   * assistant messages. Absent for a child this process cannot account for,
   * which is every out-of-process provider: its tokens are spent in another
   * product and never reach a log here.
   */
  readonly usage?: TokenUsage
  /**
   * The model the child's own backend stated it ran, as that backend names it —
   * an in-process child's route model, an external product's full model id.
   * Absent when the provider reports none or the run ended before it did.
   * Against the requested model on the `environment/run` stamp it is what
   * decides whether a delegated measurement is labelled with the model that
   * produced it.
   */
  readonly reportedModel?: string
  /**
   * Token accounting the child's own backend reported for the run. It is the
   * only spend record an out-of-process child leaves, whose tokens are spent in
   * another product; {@link usage} covers an in-process one instead, so at most
   * one of the two is stated. Absent when the provider reported none.
   */
  readonly reportedUsage?: TokenUsage
  /**
   * Cost in US dollars as the child's own backend priced the run. It is a
   * foreign product's accounting rather than a harness pricing table, so it is
   * comparable across attempts of the same implementer and never summed with a
   * `usage/priced` cost. Absent when the provider reported none.
   */
  readonly reportedCostUsd?: number
}

/**
 * One rung of an attempt ladder: what the attempt at that index runs on. A rung
 * is an object rather than a bare model so a later per-attempt choice extends it
 * without changing the position a rung already means.
 */
export interface EnvironmentRunRung {
  /**
   * Model route this attempt runs on; absent runs the run's own
   * {@link EnvironmentRunRequest.model}. A delegated attempt is started on the
   * rung's `model` id alone, because a provider names its own models; the
   * rung's `provider` is the harness route the same rung names and is what the
   * stamp records either way.
   */
  readonly model?: EnvironmentRunModel
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
   * One rung per attempt, in attempt order: attempt `i` runs on
   * `ladder[i - 1].model`, or on {@link model} for a rung that names none.
   * Present, the ladder's length is this run's attempt bound and overrides the
   * composition's `maxAttempts`, because the caller that chose a model per
   * attempt is the caller that chose how many attempts there are. An empty
   * ladder, and one longer than the deployment's configured rung ceiling, are
   * refused before any agent exists. Absent runs every attempt on {@link model}
   * under the configured `maxAttempts`.
   */
  readonly ladder?: readonly EnvironmentRunRung[]
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
  /**
   * Model route this attempt ran on: its ladder rung, or the run's stamped
   * model for a run without a ladder. What the model was ASKED to be — the
   * request header of each step the attempt drove states what was sent.
   */
  readonly model: EnvironmentRunModel
  /** What the implementer carried into this attempt from the earlier ones. */
  readonly transcript: EnvironmentRunTranscript
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
  /** Every attempt in order, each stating the route it ran on; the last one decided `certified`. */
  readonly attempts: readonly EnvironmentRunAttempt[]
  /** Whether a run of the standard passed completely and the goal completed. */
  readonly certified: boolean
  /** Certificate of the passing run, present exactly when `certified` is `true`. */
  readonly certificate?: VerificationCertificate
  /** Model usage summed over every assistant message of the session, absent when the model produced none. */
  readonly usage?: TokenUsage
  /**
   * The caps this cell ran under, in cap evaluation order, as
   * {@link EnvironmentRunner.cellCaps} resolved them for its implementer.
   * Empty when the deployment composes no budget policy, which only a run on
   * the session's own route is allowed to be.
   */
  readonly caps: readonly BudgetCap[]
  /**
   * Reads the barrier refused this cell, counted from the `read-barrier/denied`
   * records its own session log carries. `0` for a run that stayed inside its
   * workspace and for every run in a composition without a barrier, where
   * nothing is denied and nothing is recorded.
   */
  readonly escapesDenied: number
}
