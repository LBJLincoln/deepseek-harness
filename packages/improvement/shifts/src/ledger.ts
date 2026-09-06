/**
 * Reading the shift ledger back out of persisted session logs: one shift's
 * `shift/*` events folded into a record, the `environment/run` stamps the
 * cells of a shift left behind, and the four questions a restarting driver
 * asks of them — which cells are still pending, what the shift already spent,
 * what the district spent inside its window, and when its previous slot was.
 *
 * The typed `SessionEventMap` decides these payloads; a malformed one is
 * rejected at append by the invariant companions that own it, so the folds
 * here read committed events rather than revalidating them.
 *
 * @module @deepseek-ai/dsh-shifts/ledger
 */

import { fleetCellKey } from '@deepseek-ai/dsh-fleet'
import type { FleetCell } from '@deepseek-ai/dsh-fleet/types'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type { ShiftCellRecord, ShiftEnd, ShiftStart } from './types.ts'

/** One persisted session as the resume scan reads it. */
export interface ScannedSession {
  /** Stored header; `createdAt` bounds which stamps a shift may claim. */
  readonly meta: SessionHeader
  /** The stored log, oldest first. */
  readonly events: readonly SessionEvent[]
}

/** One shift session's ledger, folded from its log. */
export interface ShiftLedger {
  readonly sessionId: SessionId
  /** Header creation time; a stamped cell older than it belongs to another shift instance. */
  readonly createdAt: number
  readonly start: ShiftStart
  /** Every `shift/cell` of the session, in log order. */
  readonly cells: readonly ShiftCellRecord[]
  /** The closing record, absent while the shift is unfinished. */
  readonly end?: ShiftEnd
  /** Time of the closing record, absent while the shift is unfinished. */
  readonly endedAt?: number
}

/** One `environment/run` stamp the resume scan found, with its session's identity and spend. */
export interface StampedCell {
  /** Batch identity the stamp carries; a shift's cells carry its shift id. */
  readonly group: string
  readonly cell: FleetCell
  readonly sessionId: SessionId
  /** Header creation time of the session carrying the stamp. */
  readonly createdAt: number
  /** Input plus output tokens the session's log accounts for. */
  readonly totalTokens: number
}

/** One cell whose session exists while the ledger never recorded an outcome for it. */
export interface ShiftOrphan {
  readonly cell: FleetCell
  /** The session the interrupted process created for the cell. */
  readonly sessionId: SessionId
}

/** The cells a resuming process records as orphans and the cells it runs. */
export interface ShiftPending {
  /** Cells stamped by a session of this shift that the ledger never recorded, in plan order. */
  readonly orphans: readonly ShiftOrphan[]
  /** Cells that will not run again: recorded plus orphans, in plan order. */
  readonly done: readonly FleetCell[]
  /** Cells this process runs, in plan order. */
  readonly pending: readonly FleetCell[]
}

/**
 * Fold one persisted session into its shift ledger.
 * @param session - the stored header and log.
 * @returns the ledger, or `undefined` when the log carries no `shift/start`
 *   and is therefore not a shift session.
 */
export function foldShiftLedger(session: ScannedSession): ShiftLedger | undefined {
  let start: ShiftStart | undefined
  let end: ShiftEnd | undefined
  let endedAt: number | undefined
  const cells: ShiftCellRecord[] = []
  for (const event of session.events) {
    if (event.type === 'shift/start') start = event.data
    else if (event.type === 'shift/cell') cells.push(event.data)
    else if (event.type === 'shift/end') {
      end = event.data
      endedAt = event.time
    }
  }
  if (start === undefined) return undefined
  return {
    sessionId: session.meta.id,
    createdAt: session.meta.createdAt,
    start,
    cells,
    ...end === undefined ? {} : { end },
    ...endedAt === undefined ? {} : { endedAt },
  }
}

/**
 * The grouped `environment/run` stamps of one persisted session, each carrying
 * the tokens that session's log accounts for. A session without a grouped
 * stamp belongs to no batch and is invisible to the resume scan.
 * @param session - the stored header and log.
 * @param totalTokens - the session's folded input plus output tokens.
 * @returns one entry per grouped stamp in the log.
 */
export function stampedCells(session: ScannedSession, totalTokens: number): StampedCell[] {
  return session.events.flatMap((event) => {
    if (event.type !== 'environment/run' || event.data.group === undefined) return []
    return [{
      group: event.data.group,
      cell: {
        environment: event.data.environmentId,
        model: event.data.model,
        repetition: event.data.repetition,
      },
      sessionId: session.meta.id,
      createdAt: session.meta.createdAt,
      totalTokens,
    }]
  })
}

/**
 * Split a shift's plan cells into the orphans a resuming process records, the
 * cells that will not run again, and the cells it runs.
 *
 * A cell is done once the ledger recorded it, or once a session created at or
 * after the shift session carries its stamp — the second condition is what
 * makes the scan the authority whenever the ledger is behind, and the
 * `createdAt` bound is what keeps an older instance of the same plan out of
 * it. A stamped cell the ledger never recorded is an orphan: its session
 * exists, so running the cell again would put two sessions in one group at one
 * repetition and double-count the shift.
 * @param planCells - every cell of the frozen plan, in plan order.
 * @param ledger - the shift's folded ledger.
 * @param stamped - every grouped stamp the resume scan found.
 * @returns the orphans, the cells that will not run again, and the pending cells.
 */
export function splitPending(
  planCells: readonly FleetCell[],
  ledger: ShiftLedger,
  stamped: readonly StampedCell[],
): ShiftPending {
  const recorded = new Set(ledger.cells.map(record => fleetCellKey(record.cell)))
  const sessions = new Map(stamped
    .filter(entry => entry.group === ledger.start.shiftId && entry.createdAt >= ledger.createdAt)
    .map(entry => [fleetCellKey(entry.cell), entry.sessionId]))
  const orphans = planCells.flatMap((cell) => {
    const sessionId = sessions.get(fleetCellKey(cell))
    if (sessionId === undefined || recorded.has(fleetCellKey(cell))) return []
    return [{ cell, sessionId }]
  })
  const done = planCells.filter(cell => recorded.has(fleetCellKey(cell)) || sessions.has(fleetCellKey(cell)))
  const pending = planCells.filter(cell => !recorded.has(fleetCellKey(cell)) && !sessions.has(fleetCellKey(cell)))
  return { orphans, done, pending }
}

/**
 * Tokens the sessions of one shift already spent.
 * @param stamped - every grouped stamp the resume scan found.
 * @param id - the shift whose sessions to sum.
 * @returns the summed input plus output tokens; `0` for a shift with no session yet.
 */
export function shiftSpend(stamped: readonly StampedCell[], id: string): number {
  return stamped
    .filter(entry => entry.group === id)
    .reduce((sum, entry) => sum + entry.totalTokens, 0)
}

/**
 * Tokens one district's finished shifts closed with inside a trailing window.
 * @param ledgers - every shift ledger the resume scan folded.
 * @param district - the district to sum.
 * @param windowMs - width of the trailing window in milliseconds.
 * @param now - the current epoch milliseconds; the window ends here.
 * @returns the summed `shift/end` spend of the district inside the window.
 */
export function windowSpend(
  ledgers: readonly ShiftLedger[],
  district: string,
  windowMs: number,
  now: number,
): number {
  return ledgers
    .filter(ledger => ledger.start.plan.district === district
      && ledger.end !== undefined
      && (ledger.endedAt as number) >= now - windowMs)
    .reduce((sum, ledger) => sum + (ledger.end as ShiftEnd).spend, 0)
}

/**
 * The latest slot one district opened.
 * @param ledgers - every shift ledger the resume scan folded.
 * @param district - the district to read.
 * @returns the slot time of the district's latest `shift/start`, or
 *   `undefined` when it has never opened one.
 */
export function previousSlot(ledgers: readonly ShiftLedger[], district: string): number | undefined {
  const slots = ledgers
    .filter(ledger => ledger.start.plan.district === district)
    .map(ledger => ledger.start.scheduledAt)
  return slots.length === 0 ? undefined : Math.max(...slots)
}
