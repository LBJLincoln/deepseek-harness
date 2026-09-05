/**
 * Pure types of the trajectory record: the `dsh-trajectory/1` line format a
 * trainer or a leaderboard reads, free of host-side imports.
 *
 * @module @deepseek-ai/dsh-trajectories/types
 */

import type { ComponentId } from '@deepseek-ai/dsh-components/types'
import type { EnvironmentRunStamp } from '@deepseek-ai/dsh-environments/types'
import type { GoalId, GoalPhase } from '@deepseek-ai/dsh-goal/types'
import type { CallId, ContentBlock, LlmCallConfig, TokenUsage, ToolSchema } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { CertificateIsolation, VerificationCertificate } from '@deepseek-ai/dsh-verification/types'

/** The record format tag every exported line carries. */
export type TrajectoryFormat = 'dsh-trajectory/1'

/** Where the trajectory came from: the session and the composition that ran it. */
export interface TrajectorySource {
  /** Session the trajectory was folded from. */
  readonly sessionId: SessionId
  /** Session creation time, epoch milliseconds. */
  readonly createdAt: number
  /** Working directory the session ran in, when the header recorded one. */
  readonly cwd?: string
  /** Session this one was forked from, when the header recorded one. */
  readonly parentSession?: SessionId
  /** Agent preset the session last selected, when the log recorded one. */
  readonly agentPreset?: string
}

/** Roles of the exported chat message list. */
export type TrajectoryMessageRole = 'user' | 'assistant' | 'tool'

/** One tool invocation an assistant message requested. */
export interface TrajectoryToolCall {
  /** Provider-issued call id, matched by the tool message's `toolCallId`. */
  readonly id: CallId
  /** Registered tool name. */
  readonly name: string
  /** Raw JSON argument string exactly as the model produced it. */
  readonly arguments: string
}

/** One model-visible message of the trajectory, projected from a surface event. */
export interface TrajectoryMessage {
  /** Chat role. */
  readonly role: TrajectoryMessageRole
  /** Seq of the session event this message came from. */
  readonly seq: number
  /** Turn the message belongs to, absent when it precedes the first turn. */
  readonly turn?: number
  /** Step the message belongs to, absent outside a step. */
  readonly step?: number
  /** Exact model-facing content blocks; reasoning blocks are kept. */
  readonly content: readonly ContentBlock[]
  /** Message source kind as the session recorded it (`user`, `plugin`, `model`, `tool`, or a plugin's own kind). */
  readonly sourceKind: string
  /** Tool calls the assistant requested, present only on assistant messages that requested any. */
  readonly toolCalls?: readonly TrajectoryToolCall[]
  /** Call this tool message answers, present only on tool messages. */
  readonly toolCallId?: CallId
  /** Whether the tool reported an error, present only on tool messages that did. */
  readonly isError?: true
}

/** One model call of the trajectory with its token accounting. */
export interface TrajectoryStep {
  readonly turn: number
  readonly step: number
  /** Token usage the adapter reported for this step, absent when it reported none. */
  readonly usage?: TokenUsage
}

/**
 * How the reward was decided: `certificate` when a completion standard existed
 * for the goal (the verifier decided), `uncertified-completion` when the goal
 * completed with no standard ever authored, `none` when the log holds no goal.
 */
export type TrajectoryRewardBasis = 'certificate' | 'uncertified-completion' | 'none'

/** The goal the reward measures, as the log last recorded it. */
export interface TrajectoryGoal {
  readonly id: GoalId
  readonly objective: string
  readonly phase: GoalPhase
}

/** The reward with its basis and the evidence behind it. */
export interface TrajectoryReward {
  /** `1` for a certified completion, `0` for a measured goal without a covering certificate, `null` when no verifier decided. */
  readonly outcome: 1 | 0 | null
  readonly basis: TrajectoryRewardBasis
  /** Goal the reward measures, absent when the log holds none. */
  readonly goal?: TrajectoryGoal
  /** Certificate covering the current standard revision, present only when `outcome` is `1`. */
  readonly certificate?: VerificationCertificate
  /** Directives the validator issued during the session. */
  readonly directives: number
  /** Checks relaxed out of the standard during the session. */
  readonly relaxations: number
  /** Runs of the standard recorded during the session, passing or failing. */
  readonly attempts: number
}

/** What was in play while the trajectory ran, in the component registry's id scheme. */
export interface TrajectoryProvenance {
  /** Component ids: the preset composition, the model provider, and every tool called, in first-use order. */
  readonly components: readonly ComponentId[]
  /** Tool names called, in first-use order. */
  readonly toolNames: readonly string[]
  /** Isolation level of the covering certificate, absent without one. */
  readonly isolation?: CertificateIsolation
}

/** One exported trajectory: a session as a trainer reads it. */
export interface Trajectory {
  readonly format: TrajectoryFormat
  /** Trajectory identity, the session id. */
  readonly id: SessionId
  readonly source: TrajectorySource
  /** The environment the session ran, from its `environment/run` stamp; absent for a session no runner stamped. */
  readonly environment?: EnvironmentRunStamp
  /** Call configuration of the last logged request header, absent for a session that made no request. */
  readonly config?: LlmCallConfig
  /** Rendered system prompt of the last logged request header, absent for a system-less request. */
  readonly system?: string
  /** Tool schemas of the last logged request header, absent for a tool-less request. */
  readonly tools?: readonly ToolSchema[]
  /** Model-visible messages in surface order. */
  readonly messages: readonly TrajectoryMessage[]
  /** Model calls in log order. */
  readonly steps: readonly TrajectoryStep[]
  readonly reward: TrajectoryReward
  readonly provenance: TrajectoryProvenance
}

/** Destination of exported lines; the exporter closes it when the export settles. */
export interface TrajectorySink {
  /**
   * Accept one complete line, newline included.
   * @param line - one serialized trajectory followed by `\n`.
   */
  write(line: string): Promise<void> | void
  /** Release the destination; called exactly once, after the last write or after a failure. */
  close(): Promise<void> | void
}

/** What to export and where. */
export interface TrajectoryExportRequest {
  /** Sessions to export; absent exports every persisted session. */
  readonly sessions?: readonly SessionId[]
  /** Destination of the lines. */
  readonly sink: TrajectorySink
  /** Write only trajectories whose reward outcome is `1`. */
  readonly rewardedOnly?: boolean
  /** Also write sessions whose environment is held out; absent withholds them, so evaluation tasks never train by default. */
  readonly includeHeldOut?: boolean
}

/** One session the export could not read. */
export interface TrajectoryExportSkip {
  readonly sessionId: SessionId
  /** The read or fold failure, as a message. */
  readonly reason: string
}

/** Counts of one export. */
export interface TrajectoryExportReport {
  /** Sessions the request named or the store listed. */
  readonly sessions: number
  /** Lines written. */
  readonly exported: number
  /** Written lines whose reward outcome is `1`. */
  readonly rewarded: number
  /** Readable sessions withheld by `rewardedOnly`. */
  readonly filtered: number
  /** Readable sessions withheld because their environment is held out. */
  readonly heldOut: number
  /** Sessions that could not be read or folded. */
  readonly skipped: readonly TrajectoryExportSkip[]
}
