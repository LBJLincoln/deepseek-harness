/**
 * Pure types of the shift driver: the frozen plan, the five `shift/*` events
 * one shift session carries, and the deployment records the config validates
 * into, free of host-side imports.
 *
 * @module @deepseek-ai/dsh-shifts/types
 */

import type { EnvironmentId, EnvironmentRunModel } from '@deepseek-ai/dsh-environments/types'
import type { FleetCell, FleetEnvironmentSelection } from '@deepseek-ai/dsh-fleet/types'
import type { SessionId } from '@deepseek-ai/dsh-session'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Opening record of one shift: the identity the slot froze, the digest its
     * plan hashes to, the frozen plan verbatim, and the slot time the cadence
     * computed. Appended once, before the shift's first cell starts, and the
     * only event that tells a later process a shift exists to resume.
     */
    'shift/start': ShiftStart
    /**
     * One cell of the shift settled: the cell's coordinates, the session the
     * runner created for it when one exists, and its outcome. Appended once
     * per cell, after the cell's own session is durable — including for an
     * orphan a later process found stamped but unrecorded, which it records as
     * `interrupted` and never runs again.
     */
    'shift/cell': ShiftCellRecord
    /**
     * A later process picked this shift up: the cells already settled and the
     * cells this process runs. Appended after the orphans of the interrupted
     * process are recorded and before the pending cells start.
     */
    'shift/resume': ShiftResume
    /**
     * The slot was refused and no shift started: the plan digest and slot time
     * that were refused, and why. It is the only event of its session, so a
     * refused slot is as durable as a run one.
     */
    'shift/skipped': ShiftSkipped
    /**
     * Closing record of one shift: how it ended, the tokens this process's
     * cells spent, and the cell counts per outcome. Its presence is what marks
     * the shift finished, so a session with `shift/start` and no `shift/end`
     * is exactly what a later process resumes.
     */
    'shift/end': ShiftEnd
  }
}

/**
 * One shift's frozen plan. `environments` holds the ids a config filter
 * resolved to against the registry at freeze time, so the digest and the cell
 * enumeration are decided before any cell runs and a registry that changes
 * mid-shift cannot move them.
 */
export interface ShiftPlan {
  /** District every cell of the shift is stamped with. */
  readonly district: string
  /** Environments the shift runs, as resolved at freeze time. */
  readonly environments: readonly EnvironmentId[]
  /** Model routes in listing order, at least one; the fleet enumerates cells in it. */
  readonly models: readonly EnvironmentRunModel[]
  /** Positive number of repetitions per environment and route; repetition indexes start at zero. */
  readonly repetitions: number
  /** Positive integer bound on the input plus output tokens the shift's reported cells may sum to. */
  readonly tokenCeiling?: number
}

/** Payload of `shift/start`. */
export interface ShiftStart {
  /** `shift-<digest>-<scheduledAt>`, the `group` every cell of this shift is stamped with. */
  readonly shiftId: string
  /** Content digest of {@link ShiftStart.plan}. */
  readonly digest: string
  /** The frozen plan, verbatim. */
  readonly plan: ShiftPlan
  /** Slot time in epoch milliseconds; the cadence counts the next slot from it. */
  readonly scheduledAt: number
}

/**
 * What one cell of a shift produced: a report with its certification, the
 * failure that prevented one, or the crash that left a started cell with no
 * outcome at all.
 */
export type ShiftCellOutcome =
  | { readonly kind: 'reported'; readonly certified: boolean }
  | { readonly kind: 'error'; readonly code?: string; readonly message: string }
  | { readonly kind: 'interrupted' }

/** Payload of `shift/cell`. */
export interface ShiftCellRecord {
  /** The shift this cell belongs to; it equals the `shift/start` of the same session. */
  readonly shiftId: string
  /** The environment, model route, and repetition this record settles. */
  readonly cell: FleetCell
  /** Session the runner created for the cell, absent for a cell that never reached the runner. */
  readonly sessionId?: SessionId
  readonly outcome: ShiftCellOutcome
}

/** Payload of `shift/resume`. */
export interface ShiftResume {
  readonly shiftId: string
  /** Cells that will not run again: those already recorded, plus the orphans just recorded. */
  readonly done: readonly FleetCell[]
  /** Cells this process runs, in plan order. */
  readonly pending: readonly FleetCell[]
}

/** Why a slot was refused before any cell of it existed. */
export type ShiftSkipReason = 'overlap' | 'spend-window'

/** Payload of `shift/skipped`. */
export interface ShiftSkipped {
  /** Digest of the plan the refused slot would have run. */
  readonly digest: string
  /** Slot time in epoch milliseconds the cadence computed for the refused slot. */
  readonly scheduledAt: number
  readonly reason: ShiftSkipReason
}

/**
 * How a shift ended: `completed` once every pending cell settled, `ceiling`
 * when the plan's token ceiling refused the cells that were left, `stopped`
 * when the driver was asked to stop and cancelled the run.
 */
export type ShiftEndOutcome = 'completed' | 'ceiling' | 'stopped'

/** Cells of one shift counted by the outcome their `shift/cell` records carry. */
export interface ShiftCellCounts {
  readonly reported: number
  readonly error: number
  readonly interrupted: number
}

/** Payload of `shift/end`. */
export interface ShiftEnd {
  readonly shiftId: string
  readonly outcome: ShiftEndOutcome
  /** Input plus output tokens this process's cells reported; the spend window sums it across slots. */
  readonly spend: number
  /** Counts over every `shift/cell` of the session, this process's and its predecessors'. */
  readonly cells: ShiftCellCounts
}

/** Environments, routes, repetitions, and ceiling one district's slots run. */
export interface ShiftPlanConfig {
  /** Environments to run: named ids, or everything the registry filter matches at freeze time. */
  environments: FleetEnvironmentSelection
  /**
   * Model routes to run, at least one. The shift enumerates its own cells to
   * compute a pending set and to digest the plan, so the routes are named here
   * rather than taken from whatever default the composition currently selects.
   */
  models: EnvironmentRunModel[]
  /** Positive number of repetitions per environment and route. */
  repetitions: number
  /** Positive integer token ceiling of one shift; absent runs each shift uncapped. */
  tokenCeiling?: number
}

/** How often one district opens a slot. */
export interface ShiftCadenceConfig {
  /** Positive milliseconds between consecutive slots of the district. */
  intervalMs: number
}

/** The spend a district may reach across slots before its next one is refused. */
export interface ShiftSpendWindowConfig {
  /** Positive width of the trailing window in milliseconds. */
  windowMs: number
  /** Positive token sum inside the window at which the next slot is refused. */
  maxTokens: number
}

/** One district's shifts: what they run, how often, and what they may spend. */
export interface ShiftDistrictConfig {
  /** District name, unique in the deployment; every cell's run stamp carries it. */
  district: string
  /** What every slot of this district runs, frozen into the shift digest. */
  plan: ShiftPlanConfig
  /** How often the district opens a slot. */
  cadence: ShiftCadenceConfig
  /** Cross-slot spend ceiling; absent lets the district run every slot its cadence opens. */
  spendWindow?: ShiftSpendWindowConfig
}
