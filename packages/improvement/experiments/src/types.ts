/**
 * Pure types of one experiment: the plan a digest freezes, the two arms, the
 * paired per-environment comparison, and the verdict, free of host-side
 * imports.
 *
 * @module @deepseek-ai/dsh-experiments/types
 */

import type { EnvironmentId, EnvironmentRunModel } from '@deepseek-ai/dsh-environments/types'
import type { TrajectorySink } from '@deepseek-ai/dsh-trajectories/types'

/** Role one arm plays in a comparison; both roles run the same cells. */
export type ExperimentArmRole = 'baseline' | 'candidate'

/**
 * Statistical choices frozen into the plan digest. They decide what the
 * comparison measures and what counts as promotable, so two plans that differ
 * in any of them are two experiments.
 */
export interface ExperimentThresholds {
  /** Resamples drawn per bootstrap interval. */
  readonly bootstrapResamples: number
  /** Coverage of every reported interval, between `0` and `1`. */
  readonly confidenceLevel: number
  /** Certificate-rate delta the overall interval's lower bound must exceed to promote. */
  readonly minimumDelta: number
  /** Tokens one cell may spend; the projection the token budget is checked against. */
  readonly cellTokenCap: number
}

/**
 * One comparison to run: two arms over the same environments at the same
 * repetition indexes. A caller that froze the plan earlier passes the digest
 * it recorded back on {@link ExperimentPlan.digest}.
 */
export interface ExperimentPlan {
  /** Environments both arms run, each registered and named once. */
  readonly environments: readonly EnvironmentId[]
  /** Positive number of repetitions per environment and arm; repetition indexes start at zero. */
  readonly repetitions: number
  /** Model route of the reference arm. */
  readonly baseline: EnvironmentRunModel
  /** Model route of the arm under test. */
  readonly candidate: EnvironmentRunModel
  /** Existing absolute directory under which every cell gets its own fresh workspace directory. */
  readonly workspaceRoot: string
  /** Digest the caller froze earlier; a value the recomputed digest does not equal is refused. */
  readonly digest?: string
  /** Aborts the remaining cells when it fires; started cells abort through the runner. */
  readonly signal?: AbortSignal
  /** Destination of the result line; absent writes nothing and leaves the sessions as the only record. */
  readonly sink?: TrajectorySink
}

/** One arm as it ran: its model route and the stamp `group` its sessions carry. */
export interface ExperimentArm {
  /** Model route every cell of this arm ran. */
  readonly model: EnvironmentRunModel
  /** `experiment-<digest>-<role>`, written into the `environment/run` stamp of every session of this arm. */
  readonly group: string
}

/** Both arms of one experiment. */
export interface ExperimentArms {
  readonly baseline: ExperimentArm
  readonly candidate: ExperimentArm
}

/** Percentile bootstrap interval of a delta at the plan's confidence level. */
export interface ConfidenceInterval {
  readonly lower: number
  readonly upper: number
}

/**
 * One environment's paired comparison. Every rate, mean, and delta covers the
 * paired repetitions alone, so a repetition an arm failed to report changes
 * `pairs` and `unpaired` rather than silently shifting a rate.
 */
export interface ExperimentCell {
  readonly environment: EnvironmentId
  /** Repetition indexes both arms reported. */
  readonly pairs: number
  /** Repetition indexes that did not pair because an arm produced no report. */
  readonly unpaired: number
  /** Certified fraction of the baseline arm over the paired repetitions, `0` without pairs. */
  readonly baselineRate: number
  /** Certified fraction of the candidate arm over the paired repetitions, `0` without pairs. */
  readonly candidateRate: number
  /** `candidateRate - baselineRate`. */
  readonly delta: number
  /** Bootstrap interval of `delta`, absent without pairs. */
  readonly interval?: ConfidenceInterval
  /** Candidate mean attempts minus baseline mean attempts over the paired repetitions. */
  readonly attemptsDelta: number
  /** Candidate minus baseline input tokens summed over the paired repetitions. */
  readonly inputTokenDelta: number
  /** Candidate minus baseline output tokens summed over the paired repetitions. */
  readonly outputTokenDelta: number
}

/** Model usage summed over every reported cell of both arms, paired or not. */
export interface ExperimentSpend {
  readonly inputTokens: number
  readonly outputTokens: number
}

/** What the overall interval says about the candidate. */
export type ExperimentVerdict = 'promote' | 'reject' | 'inconclusive'

/**
 * Outcome of one experiment. The sessions grouped by `arms` carry the durable
 * evidence; this record is the fold over them.
 */
export interface ExperimentResult {
  /** Content digest of the frozen plan; both arm groups carry it. */
  readonly digest: string
  /** The two arms and the stamp group each ran under. */
  readonly arms: ExperimentArms
  /** One entry per environment, in plan order. */
  readonly cells: readonly ExperimentCell[]
  /** Paired repetition indexes over every environment; the bootstrap's units. */
  readonly seedsPaired: number
  /** Certificate-rate delta over every paired repetition, `0` without pairs. */
  readonly delta: number
  /** Bootstrap interval of `delta`, absent without pairs; the verdict reads it. */
  readonly interval?: ConfidenceInterval
  /** Model usage of both arms together. */
  readonly spend: ExperimentSpend
  /** Thresholds the digest froze, restated so a stored result is readable alone. */
  readonly thresholds: ExperimentThresholds
  readonly verdict: ExperimentVerdict
}
