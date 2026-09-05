/**
 * Pure types of the scorekeeper: the four `SessionFacts` groups one session
 * log folds into, the scoreboard rows and per-environment statistics a batch
 * of persisted logs folds into, and the facts-export request and report.
 *
 * @module @deepseek-ai/dsh-scorekeeper/types
 */

import type { BudgetCapId } from '@deepseek-ai/dsh-budget-policy'
import type { EnvironmentId } from '@deepseek-ai/dsh-environments/types'
import type { GoalPhase } from '@deepseek-ai/dsh-goal/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TrajectoryRewardBasis, TrajectorySink } from '@deepseek-ai/dsh-trajectories/types'
import type { CertificateIsolation, RunExecutor } from '@deepseek-ai/dsh-verification/types'

/**
 * The fields of the `environment/run` stamp the facts keep: the cell identity
 * a scoreboard row is keyed by plus the decontamination digest.
 */
export interface SessionFactsEnvironment {
  /** Environment that was run. */
  readonly environmentId: EnvironmentId
  /** Declared kind of that environment. */
  readonly environmentKind: string
  /** Whether the environment is reserved for evaluation. */
  readonly heldOut: boolean
  /** Zero-based repetition of the run inside its batch. */
  readonly repetition: number
  /** Batch identity the stamp carried, absent for a single run. */
  readonly group?: string
  /** SHA-256 hex over the prompt, fixture, and check digests; the decontamination key. */
  readonly contentSha256: string
  /** Provider route the run declared. */
  readonly provider: string
  /** Provider-owned model id the run declared. */
  readonly model: string
  /** Isolation the deployment declared for the run's checks. */
  readonly isolation: CertificateIsolation
}

/** Who ran what, on which route: the identity and provenance the session log carries. */
export interface SessionFactsIdentity {
  /** The `environment/run` stamp's fields, absent for a session no runner stamped. */
  readonly environment?: SessionFactsEnvironment
  /** Provider route of the last `request/header`, absent for a session that made no request. */
  readonly requestProvider?: string
  /** Model id of the last `request/header`, absent for a session that made no request. */
  readonly requestModel?: string
}

/** {@link SessionFactsIdentity} plus the identity only the persisted session header carries. */
export interface PersistedFactsIdentity extends SessionFactsIdentity {
  /** Session the facts were folded from. */
  readonly sessionId: SessionId
  /** Session creation time from the stored header, epoch milliseconds. */
  readonly createdAt: number
}

/** What the session achieved, as its goal, verification, and budget events decided. */
export interface SessionFactsOutcome {
  /** `1` for a certified completion, `0` for a measured goal without a covering certificate, `null` when no verifier decided. */
  readonly reward: 1 | 0 | null
  /** How {@link reward} was decided, by the trajectory reward fold's rules. */
  readonly rewardBasis: TrajectoryRewardBasis
  /** Whether the verification fold holds a certificate covering the current standard revision. */
  readonly certified: boolean
  /** Standard revision that certificate covers, absent without one. */
  readonly certificateRevision?: number
  /**
   * Executor of the run that certificate cites, absent without one. A
   * leaderboard partitions on it: an `agent-reported` certificate is the
   * implementer's own account of its checks and can only claim `none`.
   */
  readonly certificateExecutor?: RunExecutor
  /** `verification/run` events recorded across the session, passing or failing. */
  readonly runsRecorded: number
  /** Attempt number the last recorded run carried; it restarts at one for each authored standard. */
  readonly attempts: number
  /** `verification/directive` events recorded across the session. */
  readonly directives: number
  /** Checks relaxed out of the current standard. */
  readonly relaxations: number
  /** Durable phase of the current goal, absent before the first create and after a clear. */
  readonly goalPhase?: GoalPhase
  /** Highest admitted continuation round of the current goal. */
  readonly goalRoundsStarted: number
  /** Round cap of the current goal, absent without a current goal. */
  readonly goalRoundsCap?: number
  /** Cap named by the last `budget/breach`, absent for a session that breached none. */
  readonly budgetBreachCap?: BudgetCapId
}

/** What the session cost, from its turn, step, and usage events. */
export interface SessionFactsEfficiency {
  /** `turn/start` events. */
  readonly turns: number
  /** `step/start` events. */
  readonly steps: number
  /** Uncached input tokens summed over every `assistant/message` that reported usage. */
  readonly inputTokens: number
  /** Output tokens summed over the same messages. */
  readonly outputTokens: number
  /** Cache-read tokens summed over the same messages. */
  readonly cacheReadTokens: number
  /** Cache-write tokens summed over the same messages. */
  readonly cacheWriteTokens: number
  /** Reasoning tokens summed over the same messages. */
  readonly reasoningTokens: number
  /** Milliseconds between the first and the last event time; `0` for a log of fewer than two events. */
  readonly wallMs: number
}

/** How the session used tools, from its `tool/call` and `tool/result` events. */
export interface SessionFactsTools {
  /** `tool/call` events. */
  readonly toolCalls: number
  /** `tool/call` events per registered tool name, in first-call order. */
  readonly toolCallsByName: Readonly<Record<string, number>>
  /** `tool/result` events whose model-facing block reported an error. */
  readonly toolErrors: number
  /** Tool errors whose recorded `error.code` is the timeout policy's `TOOL_TIMEOUT`. */
  readonly toolTimeouts: number
  /** Tool errors whose recorded `error.code` is the tool runtime's `ABORTED` or `ABORTED_BEFORE_DISPATCH`. */
  readonly toolAborts: number
}

/** One session log folded into the four fact groups. */
export interface SessionFacts {
  readonly identity: SessionFactsIdentity
  readonly outcome: SessionFactsOutcome
  readonly efficiency: SessionFactsEfficiency
  readonly tools: SessionFactsTools
}

/** One persisted session's facts, carrying the identity its stored header adds. */
export interface SessionFactsRecord extends SessionFacts {
  readonly identity: PersistedFactsIdentity
}

/** Which persisted sessions a scoreboard folds. */
export interface LeaderboardFilter {
  /** Sessions to fold; absent folds every persisted session. */
  readonly sessions?: readonly SessionId[]
  /** Only sessions whose stamp carries this batch identity. */
  readonly group?: string
  /** Only held-out (`true`) or only training-eligible (`false`) sessions. */
  readonly heldOut?: boolean
}

/** One unbiased pass@k estimate over the repetition batches of one scoreboard row. */
export interface PassAtK {
  /** Repetitions drawn per estimate. */
  readonly k: number
  /** Mean of `1 - C(n - c, k) / C(n, k)` over the batches of at least `k` sessions. */
  readonly value: number
  /** Batches that held at least `k` sessions and therefore contributed. */
  readonly groups: number
}

/**
 * Measured difficulty of one environment under one model route, estimated from
 * the repetitions of each batch the row's sessions belong to.
 */
export interface EnvironmentStats {
  /** Distinct batch identities among the row's sessions. */
  readonly groups: number
  /** Sessions whose stamp carried a batch identity. */
  readonly samples: number
  /** One estimate per configured `k`, ascending; a `k` no batch reached is absent. */
  readonly passAtK: readonly PassAtK[]
}

/**
 * One scoreboard row: one model route on one environment at one isolation
 * level and one side of the held-out split. Rows never average across
 * isolation or the split; both are columns a consumer partitions by.
 */
export interface ScoreboardRow {
  readonly provider: string
  readonly model: string
  readonly environmentId: EnvironmentId
  readonly environmentKind: string
  readonly heldOut: boolean
  readonly isolation: CertificateIsolation
  /** Sessions that recorded at least one `verification/run`. */
  readonly runs: number
  /** Sessions that ended without recording one. */
  readonly errors: number
  /** Sessions holding a certificate. */
  readonly certified: number
  /** `certified / runs`, `0` without runs. */
  readonly certificateRate: number
  /** Mean `runsRecorded` over the sessions with runs, `0` without runs. */
  readonly attemptsMean: number
  /** Input tokens summed over every session of the row, the errored ones included. */
  readonly inputTokens: number
  /** Output tokens summed over the same sessions. */
  readonly outputTokens: number
  /** Pass@k over the row's repetition batches. */
  readonly stats: EnvironmentStats
}

/** One session a scoreboard or an export could not read or fold. */
export interface ScorekeeperSkip {
  readonly sessionId: SessionId
  /** The read or fold failure, as a message. */
  readonly reason: string
}

/** Scoreboard rows folded from a batch of persisted session logs. */
export interface ScoreboardBatch {
  /** One row per model route, environment, isolation level, and held-out split, in first-appearance order. */
  readonly rows: readonly ScoreboardRow[]
  /** Sessions the request named or the store listed. */
  readonly sessions: number
  /** Stamped sessions the filter's group or held-out condition excluded. */
  readonly excluded: number
  /** Sessions whose log carries no `environment/run` stamp, so no row can name their cell. */
  readonly unstamped: number
  /** Sessions that could not be read or folded. */
  readonly skipped: readonly ScorekeeperSkip[]
  /** Epoch milliseconds at which the batch was folded. */
  readonly computedAt: number
}

/** What to export and where. */
export interface FactsExportRequest {
  /** Sessions to export; absent exports every persisted session. */
  readonly sessions?: readonly SessionId[]
  /** Destination of the lines; the exporter closes it exactly once. */
  readonly sink: TrajectorySink
}

/** Counts of one facts export. */
export interface FactsExportReport {
  /** Sessions the request named or the store listed. */
  readonly sessions: number
  /** Lines written. */
  readonly exported: number
  /** Sessions that could not be read or folded. */
  readonly skipped: readonly ScorekeeperSkip[]
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /**
     * The session's log-derived facts in four groups: identity and
     * provenance, outcome, efficiency, and tool behavior. The value changes on
     * every committed event because `wallMs` spans the log.
     */
    sessionFacts: SessionFacts
  }
}
