/**
 * Reading the ledger back: what makes a persisted session a shift session, the
 * pending set a restarting process computes from records and run stamps, and
 * the three sums the cadence and the spend window read.
 */

import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  foldShiftLedger,
  previousSlot,
  shiftCells,
  shiftDigest,
  shiftId,
  shiftSpend,
  splitPending,
  stampedCells,
  windowSpend,
} from '@deepseek-ai/dsh-shifts'
import type { ScannedSession, ShiftLedger, ShiftPlan, StampedCell } from '@deepseek-ai/dsh-shifts'
import { cell, cellLog, DISTRICT, header, Log, plan, ROUND_TRIP, ROUTE, UNSATISFIABLE } from './log.ts'

const PLAN: ShiftPlan = plan()
const DIGEST = shiftDigest(PLAN)
const ID = shiftId(DIGEST, 1_000)

/** One shift session as the scan reads it, with the ledger events a spec chooses. */
function shiftSession(build: (log: Log) => void, createdAt = 500): ScannedSession {
  const log = new Log()
  build(log)
  return { meta: header(ID, createdAt), events: log.events }
}

/** A `shift/start` payload of the specs' plan. */
function start(): Record<string, unknown> {
  return { shiftId: ID, digest: DIGEST, plan: PLAN, scheduledAt: 1_000 }
}

describe('foldShiftLedger', () => {
  it('folds a started shift with its cells and its closing record', () => {
    const session = shiftSession((log) => {
      log
        .push('shift/start', start())
        .push('shift/cell', { shiftId: ID, cell: cell(ROUND_TRIP), outcome: { kind: 'reported', certified: true } })
        .push('turn/start', { turn: 1 })
        .push('shift/end', { shiftId: ID, outcome: 'completed', spend: 40, cells: { reported: 1, error: 0, interrupted: 0 } }, 9_000)
    })
    const ledger = foldShiftLedger(session)
    expect(ledger?.sessionId).toBe(ID)
    expect(ledger?.createdAt).toBe(500)
    expect(ledger?.start.digest).toBe(DIGEST)
    expect(ledger?.cells.map(record => record.cell.environment)).toEqual([ROUND_TRIP])
    expect(ledger?.end).toMatchObject({ outcome: 'completed', spend: 40 })
    expect(ledger?.endedAt).toBe(9_000)
  })

  it('leaves an unfinished shift open and reads a session that started none as no shift at all', () => {
    const open = foldShiftLedger(shiftSession(log => log.push('shift/start', start())))
    expect(open?.end).toBeUndefined()
    expect(open?.endedAt).toBeUndefined()
    expect(foldShiftLedger({ meta: header('cell-1', 100), events: cellLog(cell(ROUND_TRIP), ID, DISTRICT, 5) })).toBeUndefined()
  })
})

describe('stampedCells', () => {
  it('keeps one entry per grouped run stamp and ignores an ungrouped session', () => {
    const stamped = stampedCells({ meta: header('cell-1', 700), events: cellLog(cell(ROUND_TRIP), ID, DISTRICT, 5) }, 12)
    expect(stamped).toEqual([{
      group: ID,
      cell: { environment: ROUND_TRIP, model: ROUTE, repetition: 0 },
      sessionId: SessionId('cell-1'),
      createdAt: 700,
      totalTokens: 12,
    }])
    const ungrouped = new Log().push('environment/run', {
      kind: 'environment/run',
      version: 1,
      environmentId: ROUND_TRIP,
      environmentKind: 'smoke',
      heldOut: false,
      promptSha256: 'd'.repeat(64),
      checksSha256: 'd'.repeat(64),
      contentSha256: 'd'.repeat(64),
      repetition: 0,
      model: ROUTE,
      isolation: 'none',
    }).push('turn/start', { turn: 1 })
    expect(stampedCells({ meta: header('cell-2', 700), events: ungrouped.events }, 3)).toEqual([])
  })
})

describe('splitPending', () => {
  const ledger: ShiftLedger = {
    sessionId: SessionId(ID),
    createdAt: 500,
    start: { shiftId: ID, digest: DIGEST, plan: PLAN, scheduledAt: 1_000 },
    cells: [],
  }
  const planCells = shiftCells(PLAN)

  function stamp(environment: string, createdAt: number, group = ID): StampedCell {
    return { group, cell: cell(environment), sessionId: SessionId(`cell-${environment}`), createdAt, totalTokens: 7 }
  }

  it('treats a stamped but unrecorded cell as an orphan and runs only what never started', () => {
    const split = splitPending(planCells, ledger, [stamp(ROUND_TRIP, 600)])
    expect(split.orphans).toEqual([{ cell: cell(ROUND_TRIP), sessionId: SessionId(`cell-${ROUND_TRIP}`) }])
    expect(split.done).toEqual([cell(ROUND_TRIP)])
    expect(split.pending).toEqual([cell(UNSATISFIABLE)])
  })

  it('leaves a recorded cell out of the orphans and out of the pending set', () => {
    const recorded: ShiftLedger = {
      ...ledger,
      cells: [{ shiftId: ID, cell: cell(ROUND_TRIP), outcome: { kind: 'reported', certified: true } }],
    }
    const split = splitPending(planCells, recorded, [stamp(ROUND_TRIP, 600)])
    expect(split.orphans).toEqual([])
    expect(split.done).toEqual([cell(ROUND_TRIP)])
    expect(split.pending).toEqual([cell(UNSATISFIABLE)])
  })

  it('ignores a stamp older than the shift session and one from another group', () => {
    const split = splitPending(planCells, ledger, [stamp(ROUND_TRIP, 499), stamp(UNSATISFIABLE, 900, 'fleet-elsewhere')])
    expect(split.orphans).toEqual([])
    expect(split.pending).toEqual(planCells)
  })
})

describe('shiftSpend, windowSpend, and previousSlot', () => {
  function ledgerAt(scheduledAt: number, district: string, end?: { spend: number; endedAt: number }): ShiftLedger {
    const id = shiftId(DIGEST, scheduledAt)
    return {
      sessionId: SessionId(id),
      createdAt: scheduledAt,
      start: { shiftId: id, digest: DIGEST, plan: { ...PLAN, district }, scheduledAt },
      cells: [],
      ...end === undefined ? {} : {
        end: { shiftId: id, outcome: 'completed', spend: end.spend, cells: { reported: 1, error: 0, interrupted: 0 } },
        endedAt: end.endedAt,
      },
    }
  }

  it('sums only the sessions of one shift', () => {
    const stamped: StampedCell[] = [
      { group: ID, cell: cell(ROUND_TRIP), sessionId: SessionId('a'), createdAt: 600, totalTokens: 30 },
      { group: ID, cell: cell(UNSATISFIABLE), sessionId: SessionId('b'), createdAt: 700, totalTokens: 12 },
      { group: 'fleet-elsewhere', cell: cell(ROUND_TRIP), sessionId: SessionId('c'), createdAt: 800, totalTokens: 99 },
    ]
    expect(shiftSpend(stamped, ID)).toBe(42)
    expect(shiftSpend(stamped, shiftId(DIGEST, 2_000))).toBe(0)
  })

  it('sums only the finished shifts of one district inside the window', () => {
    const ledgers = [
      ledgerAt(1_000, DISTRICT, { spend: 100, endedAt: 5_000 }),
      ledgerAt(2_000, DISTRICT, { spend: 7, endedAt: 500 }),
      ledgerAt(3_000, 'yard', { spend: 1_000, endedAt: 5_000 }),
      ledgerAt(4_000, DISTRICT),
    ]
    expect(windowSpend(ledgers, DISTRICT, 2_000, 6_000)).toBe(100)
    expect(windowSpend(ledgers, DISTRICT, 10_000, 6_000)).toBe(107)
    expect(windowSpend(ledgers, 'nowhere', 10_000, 6_000)).toBe(0)
  })

  it('reads the latest slot one district opened', () => {
    const ledgers = [ledgerAt(1_000, DISTRICT), ledgerAt(4_000, DISTRICT), ledgerAt(9_000, 'yard')]
    expect(previousSlot(ledgers, DISTRICT)).toBe(4_000)
    expect(previousSlot(ledgers, 'nowhere')).toBeUndefined()
  })
})
