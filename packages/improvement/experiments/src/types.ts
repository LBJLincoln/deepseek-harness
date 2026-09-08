/**
 * Pure types of one experiment: the plan a digest freezes, the two arms, the
 * paired per-environment comparison, and the verdict, free of host-side
 * imports.
 *
 * @module @deepseek-ai/dsh-experiments/types
 */

import type { BudgetCap } from '@deepseek-ai/dsh-budget-policy'
import type { EnvironmentRunImplementer } from '@deepseek-ai/dsh-environment-runner/types'
import type { EnvironmentId, EnvironmentRunModel } from '@deepseek-ai/dsh-environments/types'
import type { TrajectorySink } from '@deepseek-ai/dsh-trajectories/types'

/** Role one arm plays in a comparison; both roles run the same cells. */
export type ExperimentArmRole = 'baseline' | 'candidate'

/**
 * One arm as a plan names it: the model route its cells run and who implements
 * them. An arm that names no implementer runs its own route, so a plan that
 * omits the field and one that spells `{ kind: 'route' }` out are one
 * experiment and freeze to one digest.
 */
export interface ExperimentArmPlan extends EnvironmentRunModel {
  /**
   * Who does the work of every cell of this arm — the arm's own model route,
   * or an out-of-band coding agent behind a registered subagent provider. The
   * cells, the checks, and the certificate are the same either way, so an arm
   * that delegates is comparable with one that does not.
   */
  readonly implementer?: EnvironmentRunImplementer
}

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
  /** The reference arm. */
  readonly baseline: ExperimentArmPlan
  /** The arm under test. */
  readonly candidate: ExperimentArmPlan
  /** Existing absolute directory under which every cell gets its own fresh workspace directory. */
  readonly workspaceRoot: string
  /**
   * Checkpoint or policy both arms' routes serve, written into every cell's
   * run stamp verbatim; absent for routes the deployment did not version.
   */
  readonly policyVersion?: string
  /**
   * Base sampling seed both arms share, a safe non-negative integer. Each cell
   * samples with `seed + repetition`, so the paired repetitions of the two arms
   * differ only in the route; absent leaves sampling to the composition.
   */
  readonly seed?: number
  /** Digest the caller froze earlier; a value the recomputed digest does not equal is refused. */
  readonly digest?: string
  /** Aborts the remaining cells when it fires; started cells abort through the runner. */
  readonly signal?: AbortSignal
  /** Destination of the result line; absent writes nothing and leaves the sessions as the only record. */
  readonly sink?: TrajectorySink
}

/** One arm as it ran: its model route, its implementer, and the stamp `group` its sessions carry. */
export interface ExperimentArm {
  /** Model route every cell of this arm ran. */
  readonly model: EnvironmentRunModel
  /** Implementer every cell of this arm ran under, with the plan's default applied, so a stored result tells the arms apart alone. */
  readonly implementer: EnvironmentRunImplementer
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
  /**
   * The ceilings every cell of both arms ran under, in cap evaluation order.
   * The plan is refused unless the two arms resolve to the same list, so one
   * entry states the budget the whole comparison was measured inside and a
   * reader of a stored result never has to find the composition that produced
   * it. Empty for a comparison whose deployment caps nothing.
   */
  readonly caps: readonly BudgetCap[]
  readonly verdict: ExperimentVerdict
}
