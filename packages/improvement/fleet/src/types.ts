/**
 * Pure types of a fleet run: the plan, the cells, each cell's outcome, and the
 * leaderboard rows folded from the outcomes, free of host-side imports.
 *
 * @module @deepseek-ai/dsh-fleet/types
 */

import type { EnvironmentRunImplementer, EnvironmentRunReport, EnvironmentRunRung } from '@deepseek-ai/dsh-environment-runner/types'
import type { EnvironmentFilter, EnvironmentId, EnvironmentRunModel } from '@deepseek-ai/dsh-environments/types'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { CertificateIsolation } from '@deepseek-ai/dsh-verification/types'

/** Which environments a plan runs: named ids, or everything the registry filter matches. */
export type FleetEnvironmentSelection =
  | { readonly ids: readonly EnvironmentId[] }
  | { readonly filter: EnvironmentFilter }

/** One fleet run: every selected environment on every model route, `repetitions` times. */
export interface FleetPlan {
  /** Environments to run. */
  readonly environments: FleetEnvironmentSelection
  /** Model routes each cell's FIRST attempt runs on; an empty list runs the composition's default route. */
  readonly models: readonly EnvironmentRunModel[]
  /**
   * One rung per attempt, handed to every cell of the plan: attempt `i` runs on
   * `ladder[i - 1].model`, or on the cell's own route for a rung that names
   * none. The ladder's length is each cell's attempt bound. One plan runs one
   * ladder, so every cell of a row escalated the same way; absent runs every
   * attempt of every cell on the cell's own route.
   */
  readonly ladder?: readonly EnvironmentRunRung[]
  /**
   * Who implements every cell of the plan; absent runs each cell's own model
   * route. One plan runs one implementer, so a leaderboard row folded from it
   * never mixes two.
   */
  readonly implementer?: EnvironmentRunImplementer
  /** Positive number of repetitions per environment and model; repetition indexes start at zero. */
  readonly repetitions: number
  /**
   * Exact cells to run out of the plan's enumeration; absent runs every
   * enumerated cell. A driver resuming a partly run plan names the cells that
   * never started, so each keeps the environment, route, and repetition index
   * the plan gave it instead of being restated as a smaller plan whose
   * repetition indexes would start again at zero. The cells run in plan order,
   * whatever order they are named in.
   */
  readonly cells?: readonly FleetCell[]
  /** Existing absolute directory under which every cell gets its own fresh workspace directory. */
  readonly workspaceRoot: string
  /** Batch identity written into every run stamp as `group`; absent mints one. */
  readonly group?: string
  /** District written into every cell's run stamp; absent leaves the cells outside every district. */
  readonly district?: string
  /**
   * Checkpoint or policy the routes serve, written into every cell's run stamp
   * verbatim; absent for routes the deployment did not version.
   */
  readonly policyVersion?: string
  /**
   * Base sampling seed of the plan, a safe non-negative integer. Each cell
   * samples with `seed + repetition`, so one repetition index means one seed
   * across every route and every environment of the plan and a paired design
   * compares like with like; absent leaves the cells' sampling to the
   * composition.
   */
  readonly seed?: number
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
  /**
   * Model route of each attempt in attempt order, as the plan's ladder resolved
   * it, absent for a row whose cells ran no ladder and for one whose cells all
   * failed before a run. One plan runs one ladder, so a fleet row cannot mix a
   * laddered cell with an unladdered one; the scoreboard, which folds across
   * plans, keys its rows by it instead.
   */
  readonly ladder?: readonly EnvironmentRunModel[]
  readonly environmentId: EnvironmentId
  readonly environmentKind: string
  readonly heldOut: boolean
  /** Isolation the runs declared, absent when every cell of the row failed before a run. */
  readonly isolation?: CertificateIsolation
  /**
   * Implementer the runs were stamped with — `route` or the subagent provider
   * name — absent when every cell of the row failed before a run.
   */
  readonly implementer?: string
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

/**
 * What one settled cell produced, as the `fleet/cell` event reports it:
 * `reported` names the session the runner created and whether it certified,
 * `error` carries the failure that prevented a report, including the code of a
 * cell the fleet refused to start.
 */
export type FleetCellEventOutcome =
  | { readonly kind: 'reported'; readonly sessionId: SessionId; readonly certified: boolean }
  | { readonly kind: 'error'; readonly code?: string; readonly message: string }

/**
 * Payload of the observe-only `fleet/cell` event. It carries the durable
 * coordinates of one settled cell — the batch group, the district, and the
 * cell — so an observer can write its own record without holding the fleet's
 * in-memory report.
 */
export interface FleetCellEvent {
  /** Batch identity every run stamp of this fleet run carries. */
  readonly group: string
  /** District the plan stamped its cells with, absent for a plan outside every district. */
  readonly district?: string
  /** The environment, model route, and repetition that settled. */
  readonly cell: FleetCell
  /** The settled outcome, exactly as the report keeps it. */
  readonly outcome: FleetCellEventOutcome
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
