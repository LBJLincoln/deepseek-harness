/**
 * Pure types of a fleet run: the plan, the cells, each cell's outcome, and the
 * leaderboard rows folded from the outcomes, free of host-side imports.
 *
 * @module @deepseek-ai/dsh-fleet/types
 */

import type { EnvironmentRunReport } from '@deepseek-ai/dsh-environment-runner/types'
import type { EnvironmentFilter, EnvironmentId, EnvironmentRunModel } from '@deepseek-ai/dsh-environments/types'
import type { CertificateIsolation } from '@deepseek-ai/dsh-verification/types'

/** Which environments a plan runs: named ids, or everything the registry filter matches. */
export type FleetEnvironmentSelection =
  | { readonly ids: readonly EnvironmentId[] }
  | { readonly filter: EnvironmentFilter }

/** One fleet run: every selected environment on every model route, `repetitions` times. */
export interface FleetPlan {
  /** Environments to run. */
  readonly environments: FleetEnvironmentSelection
  /** Model routes; an empty list runs the composition's default route. */
  readonly models: readonly EnvironmentRunModel[]
  /** Positive number of repetitions per environment and model; repetition indexes start at zero. */
  readonly repetitions: number
  /** Existing absolute directory under which every cell gets its own fresh workspace directory. */
  readonly workspaceRoot: string
  /** Batch identity written into every run stamp as `group`; absent mints one. */
  readonly group?: string
  /** District written into every cell's run stamp; absent leaves the cells outside every district. */
  readonly district?: string
  /**
   * Positive integer bound on the input plus output tokens the reported cells
   * may sum to. Once the reports in hand cross it, every cell that has not
   * started is recorded as a `FLEET_TOKEN_CEILING_REACHED` error and the cells
   * already in flight still complete; absent runs the plan uncapped.
   */
  readonly tokenCeiling?: number
  /** Aborts the remaining cells when it fires; started cells abort through the runner. */
  readonly signal?: AbortSignal
}

/** One environment × model × repetition unit of a plan. */
export interface FleetCell {
  readonly environment: EnvironmentId
  readonly model: EnvironmentRunModel
  readonly repetition: number
}

/** What one cell produced: the runner's report, or the failure that prevented one. */
export type FleetCellOutcome =
  | { readonly cell: FleetCell; readonly report: EnvironmentRunReport }
  | { readonly cell: FleetCell; readonly error: FleetCellError }

/**
 * Stable codes the fleet records on a cell it never handed to the runner:
 * `FLEET_ROUTE_BREAKER_OPEN` for a route the circuit breaker stopped
 * scheduling, `FLEET_TOKEN_CEILING_REACHED` for a cell left unstarted once the
 * plan's reported spend crossed its ceiling.
 */
export type FleetCellErrorCode = 'FLEET_ROUTE_BREAKER_OPEN' | 'FLEET_TOKEN_CEILING_REACHED'

/**
 * A cell that produced no report. The code is the thrown harness error's when
 * the run threw one, and a {@link FleetCellErrorCode} for a cell the fleet
 * never started.
 */
export interface FleetCellError {
  readonly code?: string
  readonly message: string
}

/**
 * One leaderboard row: one model route on one environment. Rows are never
 * averaged across isolation levels or across the held-out split; both are
 * columns a consumer partitions by.
 */
export interface LeaderboardRow {
  readonly provider: string
  readonly model: string
  readonly environmentId: EnvironmentId
  readonly environmentKind: string
  readonly heldOut: boolean
  /** Isolation the runs declared, absent when every cell of the row failed before a run. */
  readonly isolation?: CertificateIsolation
  /** Cells that produced a report. */
  readonly runs: number
  /** Cells that produced no report. */
  readonly errors: number
  /** Reported cells whose run certified. */
  readonly certified: number
  /** `certified / runs`, `0` without runs. */
  readonly certificateRate: number
  /** Mean attempts over reported cells, `0` without runs. */
  readonly attemptsMean: number
  /** Summed model usage over reported cells. */
  readonly inputTokens: number
  readonly outputTokens: number
}

/** Model usage of one whole fleet run, summed over every reported cell. */
export interface FleetSpend {
  readonly inputTokens: number
  readonly outputTokens: number
}

/** Outcome of one fleet run: every cell in plan order and the leaderboard folded from them. */
export interface FleetRunReport {
  /** Batch identity every run stamp of this fleet run carries. */
  readonly group: string
  readonly cells: readonly FleetCellOutcome[]
  /** One row per model route and environment, in first-appearance order. */
  readonly leaderboard: readonly LeaderboardRow[]
  /** Model usage of the whole run; the same sum `tokenCeiling` is measured against. */
  readonly spend: FleetSpend
}
