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
import type { CertificateIsolation, RunExecutor, RunParity, RunVerdict } from '@deepseek-ai/dsh-verification/types'

/**
 * Tamper status of one session: the verdict of its last recorded
 * `verification/run`, or `not-instrumented` for a session whose log records no
 * run at all, so no verdict states whether the check-owned files changed.
 */
export type SessionTamper = RunVerdict | 'not-instrumented'

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
  /** District the run belonged to, absent for a run outside every district. */
  readonly district?: string
  /** SHA-256 hex over the prompt, fixture, and check digests; the decontamination key. */
  readonly contentSha256: string
  /** Provider route the run declared. */
  readonly provider: string
  /** Provider-owned model id the run declared. */
  readonly model: string
  /** Isolation the deployment declared for the run's checks. */
  readonly isolation: CertificateIsolation
  /**
   * Who did the work: `route` for the session's own model route, or the
   * subagent provider name for a delegated run. A stamp that states none is a
   * route run, so the fact is always stated even where the stamp is not.
   */
  readonly implementer: string
}

/** Who ran what, on which route: the identity and provenance the session log carries. */
export interface SessionFactsIdentity {
  /** The `environment/run` stamp's fields, absent for a session no runner stamped. */
  readonly environment?: SessionFactsEnvironment
  /** Provider route of the last `request/header`, absent for a session that made no request. */
  readonly requestProvider?: string
  /** Model id of the last `request/header`, absent for a session that made no request. */
  readonly requestModel?: string
  /**
   * Model the delegated implementer's own backend reported, from the last
   * `environment/delegation` that stated one. Absent for a route-implemented
   * session, and for a delegated one whose provider reports no model. Read
   * against {@link SessionFactsEnvironment.model}, which is the model the cell
   * asked for and was stamped with, it says whether the arm a row is published
   * under is the one that did the work — and which concrete version an alias
   * such as `sonnet` resolved to.
   */
  readonly implementerModel?: string
  /**
   * `compositionSha256` of the last `composition/manifest` in the session,
   * absent for a session whose log carries none. It addresses the component set
   * the agent had in play, so a row carrying it is attributable to one harness
   * variant rather than to a route and whatever the harness was that week.
   */
  readonly compositionSha256?: string
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
  /**
   * Weighted pass rate of the last recorded run, absent when that run measured
   * no cases. It states how much of the measured behaviour the session reached
   * and certifies nothing; {@link certified} remains the only completion
   * measure, and the two are separate facts that are never merged.
   */
  readonly parity?: RunParity
  /**
   * Verdict of the last recorded run, `not-instrumented` when the session
   * recorded none. It is the tamper column a publication carries: `passed` and
   * `failed` follow from the run's results, while `tampered` says the
   * check-owned files changed under the validator and only the run payload
   * states it.
   */
  readonly tamper: SessionTamper
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

/**
 * What one session's delegated children spent, summed over the spend its
 * `environment/delegation` records state. It is separate from the session's own
 * token totals rather than added to them: a delegated cell drives no model turn
 * of its own, so its own totals are zero while this is the whole cost of the
 * work, and a paired experiment reads the two side by side.
 */
export interface SessionFactsDelegatedSpend {
  /** Uncached input tokens summed over every delegation that accounted for the child. */
  readonly inputTokens: number
  /** Output tokens summed over the same delegations. */
  readonly outputTokens: number
  /** Cache-read tokens summed over the same delegations. */
  readonly cacheReadTokens: number
  /** Cache-write tokens summed over the same delegations. */
  readonly cacheWriteTokens: number
  /**
   * US dollars summed over the delegations whose provider priced its own run.
   * It is the foreign product's own accounting, so it is never added to
   * {@link SessionFactsEfficiency.costEur}. Absent when no delegation stated a
   * cost, which is every in-process implementer.
   */
  readonly costUsd?: number
}

/**
 * What the session cost, from its turn, step, usage, and pricing events. Cost
 * is read from the `usage/priced` records alone, never recomputed from a
 * deployment's current pricing table, so a table edited after the fact cannot
 * change what a folded session cost.
 */
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
  /** `usage/priced` events: the steps whose price the log states. */
  readonly pricedSteps: number
  /**
   * EUR summed over the `costEur` of those events, absent when any
   * `assistant/message` that reported usage has no `usage/priced` for its turn
   * and step: a session that ran an unpriced route states no cost rather than
   * the lower cost of its priced steps alone. `0` for a session whose log
   * carries no usage-bearing message.
   */
  readonly costEur?: number
  /**
   * Distinct `pricingDigest` values of those events, in first-seen order. Two
   * or more mean the log was priced under more than one table version, so
   * {@link costEur} is a sum across pricing tables.
   */
  readonly pricingDigests: readonly string[]
  /**
   * What this session's delegated children spent, absent for a session whose
   * delegations accounted for none — including every session that delegated
   * nothing. Where a route-implemented cell reports its work in the token
   * fields above, a delegated one reports it here.
   */
  readonly delegated?: SessionFactsDelegatedSpend
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
 * One scoreboard row: one model route and implementer on one environment at
 * one isolation level, one side of the held-out split, and one district. Rows
 * never average across the implementer, isolation, the split, or districts;
 * all four are columns a consumer partitions by, and a publication that
 * withholds a district drops whole rows.
 */
export interface ScoreboardRow {
  readonly provider: string
  readonly model: string
  readonly environmentId: EnvironmentId
  readonly environmentKind: string
  readonly heldOut: boolean
  readonly isolation: CertificateIsolation
  /** Implementer every session of the row was stamped with: `route` or the subagent provider name. */
  readonly implementer: string
  /** District every session of the row was stamped with, absent for a row outside every district. */
  readonly district?: string
  /** Sessions that recorded at least one `verification/run`. */
  readonly runs: number
  /** Sessions that ended without recording one; they are exactly the row's not-instrumented sessions. */
  readonly errors: number
  /**
   * Sessions whose last recorded run carried the `tampered` verdict. A row
   * whose {@link runs} is zero states no tamper status at all, because a
   * session that recorded no run carries no verdict to read.
   */
  readonly tampered: number
  /**
   * `compositionSha256` every session of the row states, absent when a session
   * states none or two disagree. A digest covering only part of a row would
   * attribute the whole row to a composition that did not run all of it.
   */
  readonly compositionSha256?: string
  /**
   * Distinct certificate executors across the row's certified sessions, in
   * first-appearance order. Empty for a row that certified nothing; two or more
   * mean the row's certificates disagree, so no single executor may be
   * published beside its {@link certificateRate}.
   */
  readonly certificateExecutors: readonly RunExecutor[]
  /** Sessions holding a certificate. */
  readonly certified: number
  /** `certified / runs`, `0` without runs. */
  readonly certificateRate: number
  /**
   * Mean `weightPassed / weightTotal` over the row's sessions that carry a
   * parity, absent when none does; every such session counts once, so a
   * session sampled by more cases does not weigh more. It is a column beside
   * {@link certificateRate}, never merged with it and never ranked against it.
   */
  readonly parity?: number
  /** Mean `runsRecorded` over the sessions with runs, `0` without runs. */
  readonly attemptsMean: number
  /** Input tokens summed over every session of the row, the errored ones included. */
  readonly inputTokens: number
  /** Output tokens summed over the same sessions. */
  readonly outputTokens: number
  /**
   * Mean `costEur` over the row's certified sessions, absent when the row
   * certified nothing and absent when any certified session of the row states
   * no cost, so a published figure never averages an unpriced session as free.
   */
  readonly costEurPerCertified?: number
  /** Distinct `pricingDigest` values across every session of the row, in first-appearance order. */
  readonly pricingDigests: readonly string[]
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
  /** One row per model route, environment, isolation level, held-out split, and district, in first-appearance order. */
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
