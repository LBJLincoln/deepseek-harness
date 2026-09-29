import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  ACTIVE_WINDOW_MS,
  activeWindow,
  appendLedger,
  countWork,
  ledgerBySeat,
  occupancyByDivision,
  occupancyOf,
  parseLedgerLine,
  readLedger,
  seatWork,
  ticketStatus,
  workOf,
  type FunctionLine,
  type TicketLine,
} from './enterprise-ledger.ts'

const NOW = '2026-09-28T18:00:00.000Z'

/** A shipped ticket line as the engine writes it, `type` included. */
const SHIPPED: TicketLine = {
  type: 'ticket',
  at: '2026-09-28T12:00:00.000Z',
  shift: 'shift-1',
  ticket: 'T-0001',
  seat: 'harness-core-session-steward',
  division: 'harness-core',
  checks: [{ id: 'typecheck', ok: true }],
  review: { verdict: 'approve', sessionId: 'review-1' },
  integration: { outcome: 'merged' },
  shipped: { commit: 'abc123' },
}

const GATE: FunctionLine = {
  type: 'function',
  at: '2026-09-28T17:00:00.000Z',
  shift: 'shift-1',
  seat: 'verification-verify-md-links',
  division: 'verification',
  function: 'verify-md-links',
  target: { commit: 'abc123' },
  outcome: 'pass',
  evidence: { path: 'data/enterprise/functions/shift-1/verification-verify-md-links.log' },
  seconds: 12.5,
}

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempLedger(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'enterprise-ledger-'))
  dirs.push(dir)
  const file = join(dir, 'ledger.jsonl')
  writeFileSync(file, content)
  return file
}

describe('parseLedgerLine', () => {
  it('reads a line without a type as a ticket line', () => {
    const { type: _type, ...untyped } = SHIPPED
    expect(parseLedgerLine(untyped)).toEqual(SHIPPED)
  })

  it('reads a function line and normalises its time', () => {
    expect(parseLedgerLine({ ...GATE, at: '2026-09-28T17:00:00Z' })).toEqual(GATE)
  })

  it('keeps the later head a verdict was read through, and the commit asked for when the verdict covers another', () => {
    const through = { ...GATE, target: { commit: 'abc123', via: 'def456' } }
    const other = { ...GATE, target: { commit: 'def456', requested: 'abc123' } }
    expect(parseLedgerLine(through)).toEqual(through)
    expect(parseLedgerLine(other)).toEqual(other)
  })

  it('names what a line lacks instead of guessing', () => {
    expect(parseLedgerLine('text')).toBe('not a JSON object')
    expect(parseLedgerLine({ ...SHIPPED, at: 'yesterday' })).toBe('no parseable "at"')
    expect(parseLedgerLine({ ...SHIPPED, seat: undefined })).toBe('no "seat"')
    expect(parseLedgerLine({ ...SHIPPED, ticket: undefined })).toBe('no "ticket"')
    expect(parseLedgerLine({ ...GATE, outcome: 'green' })).toBe('no "outcome" of pass, fail or error')
    expect(parseLedgerLine({ ...GATE, evidence: {} })).toBe('no "evidence.path" or "evidence.url"')
    expect(parseLedgerLine({ ...GATE, target: {} })).toBe('no "target.commit"')
    expect(parseLedgerLine({ ...GATE, type: 'note' })).toBe('unknown line type "note"')
  })

  it('keeps only the checks that state an id and a boolean', () => {
    const line = parseLedgerLine({ ...SHIPPED, checks: [{ id: 'a', ok: false }, { id: 'b' }, 'c', null] })
    expect(typeof line === 'string' ? line : line.type === 'ticket' ? line.checks : []).toEqual([{ id: 'a', ok: false }])
  })
})

describe('readLedger', () => {
  it('answers an empty ledger for a missing file', () => {
    expect(readLedger(join(tmpdir(), 'enterprise-ledger-none', 'ledger.jsonl'))).toEqual({ lines: [], skipped: [] })
  })

  it('keeps every readable line and reports the rest by line number', () => {
    const file = tempLedger([JSON.stringify(SHIPPED), '', '{"type":"function"}', 'not json', JSON.stringify(GATE)].join('\n'))
    const read = readLedger(file)
    expect(read.lines).toEqual([SHIPPED, GATE])
    expect(read.skipped).toEqual([{ line: 3, reason: 'no parseable "at"' }, { line: 4, reason: 'not JSON' }])
  })

  it('round-trips what appendLedger writes', () => {
    const file = tempLedger('')
    appendLedger(file, [SHIPPED])
    appendLedger(file, [GATE])
    appendLedger(file, [])
    expect(readFileSync(file, 'utf8').split('\n')).toHaveLength(3)
    expect(readLedger(file).lines).toEqual([SHIPPED, GATE])
  })
})

describe('ticketStatus', () => {
  it('reads shipped from a commit, rejected from a reject verdict, and halted, still open, otherwise', () => {
    expect(ticketStatus(SHIPPED)).toBe('shipped')
    expect(ticketStatus({ ...SHIPPED, shipped: null })).toBe('halted')
    expect(ticketStatus({ ...SHIPPED, shipped: null, checks: [{ id: 'typecheck', ok: false }] })).toBe('halted')
    expect(ticketStatus({ ...SHIPPED, shipped: null, review: { verdict: 'reject' } })).toBe('rejected')
    expect(ticketStatus({ ...SHIPPED, shipped: null, review: { verdict: ' Reject ' } })).toBe('rejected')
    expect(ticketStatus({ ...SHIPPED, shipped: null, review: { verdict: 'none' } })).toBe('halted')
    expect(ticketStatus({ ...SHIPPED, shipped: null, review: { verdict: 'approved' }, integration: { outcome: 'conflict' } })).toBe('halted')
    const { review: _review, ...unreviewed } = SHIPPED
    expect(ticketStatus({ ...unreviewed, shipped: null, department: { outcome: 'budget-exhausted' } })).toBe('halted')
  })
})

describe('the occupancy rule', () => {
  const window = activeWindow(NOW)

  it('measures the window as the 24 hours ending at the given moment', () => {
    expect(window).toEqual({ since: new Date(Date.parse(NOW) - ACTIVE_WINDOW_MS).toISOString(), until: NOW })
  })

  it('counts ledger lines exactly by seat id', () => {
    const bySeat = ledgerBySeat([SHIPPED, GATE, { ...GATE, at: '2026-09-27T09:00:00.000Z' }, { ...GATE, seat: 'verification-verify-md-links-2' }])
    expect(bySeat.get('verification-verify-md-links')).toEqual({ lines: 2, lastAt: GATE.at })
    expect(bySeat.get('verification-verify-md-links-2')).toEqual({ lines: 1, lastAt: GATE.at })
    expect(bySeat.get('harness-core-session-steward')).toEqual({ lines: 1, lastAt: SHIPPED.at })
    expect(bySeat.has('verification-verify-md')).toBe(false)
  })

  it('occupies a seat only by a deliverable and activates it only inside the window', () => {
    const seat = { id: 'seat', division: 'verification', sessions: 0 }
    expect(occupancyOf(seat, undefined, window)).toEqual({ occupied: false, active: false })
    expect(occupancyOf(seat, { lines: 1, lastAt: GATE.at }, window)).toEqual({ occupied: true, active: true, lastDeliverable: GATE.at })
    expect(occupancyOf(seat, { lines: 1, lastAt: '2026-09-27T17:59:59.999Z' }, window)).toEqual({ occupied: true, active: false, lastDeliverable: '2026-09-27T17:59:59.999Z' })
    expect(occupancyOf(seat, { lines: 1, lastAt: window.since }, window)).toMatchObject({ occupied: true, active: true })
    expect(occupancyOf(seat, { lines: 1, lastAt: '2026-09-28T18:00:00.001Z' }, window)).toMatchObject({ occupied: true, active: false })
  })

  it('reads a recorded session as a deliverable dated by the record itself', () => {
    const recorded = { id: 'seat', division: 'proving-ground', sessions: 3, lastSeen: '2026-09-22T18:59:07.301Z' }
    expect(occupancyOf(recorded, undefined, window)).toEqual({ occupied: true, active: false, lastDeliverable: '2026-09-22T18:59:07.301Z' })
    expect(occupancyOf({ ...recorded, lastSeen: '2026-09-28T01:00:00.000Z' }, undefined, window)).toEqual({ occupied: true, active: true, lastDeliverable: '2026-09-28T01:00:00.000Z' })
    expect(occupancyOf(recorded, { lines: 1, lastAt: GATE.at }, window)).toEqual({ occupied: true, active: true, lastDeliverable: GATE.at })
  })

  it('tallies divisions in the given order, empty ones included', () => {
    const seats = [
      { division: 'verification', occupancy: occupancyOf({ id: 'a', division: 'verification', sessions: 0 }, { lines: 1, lastAt: GATE.at }, window) },
      { division: 'verification', occupancy: occupancyOf({ id: 'b', division: 'verification', sessions: 0 }, undefined, window) },
      { division: 'judging', occupancy: occupancyOf({ id: 'c', division: 'judging', sessions: 0 }, { lines: 1, lastAt: '2026-09-20T00:00:00.000Z' }, window) },
    ]
    expect(occupancyByDivision(['verification', 'judging', 'knowledge'], seats)).toEqual([
      { id: 'verification', defined: 2, occupied: 1, active: 1 },
      { id: 'judging', defined: 1, occupied: 1, active: 0 },
      { id: 'knowledge', defined: 0, occupied: 0, active: 0 },
    ])
  })
})

describe('the work a deliverable was', () => {
  const window = activeWindow(NOW)
  /** A ticket line of a shift that could not prepare its worktrees: no session, no tokens, nothing shipped. */
  const HALTED: TicketLine = {
    type: 'ticket',
    at: '2026-09-28T16:00:00.000Z',
    shift: 'shift-2',
    ticket: 'T-0002',
    seat: 'harness-core-session-steward',
    division: 'harness-core',
    department: { outcome: 'failed' },
    checks: [],
    review: { verdict: 'none' },
    shipped: null,
    reason: 'the shift could not prepare its worktrees',
    tokens: 0,
  }

  it('reads a ticket line as model work when a session ran, it shipped or it spent tokens, and as halted otherwise', () => {
    expect(workOf(SHIPPED)).toBe('model')
    expect(workOf({ ...SHIPPED, shipped: null })).toBe('model')
    expect(workOf({ ...HALTED, department: { outcome: 'failed', sessionId: 'program-1-t-0002' } })).toBe('model')
    expect(workOf({ ...HALTED, tokens: 312323 })).toBe('model')
    expect(workOf(HALTED)).toBe('halted')
  })

  it('reads a function line of a check division as an automated check, and any other as model work', () => {
    expect(workOf(GATE)).toBe('check')
    expect(workOf({ ...GATE, seat: 'judging-ci-static', division: 'judging', function: 'ci-static' })).toBe('check')
    expect(workOf({ ...GATE, seat: 'code-safety-lead', division: 'code-safety', function: 'review' })).toBe('model')
    expect(workOf({ ...GATE, seat: 'program-departments-jobs-coordinator', division: 'program-departments', function: 'intake' })).toBe('model')
  })

  it('gives a seat the strongest kind among its deliverables, overall and inside the window', () => {
    const seat = { id: 'harness-core-session-steward', division: 'harness-core', sessions: 0 }
    expect(seatWork(seat, [], window)).toBeUndefined()
    expect(seatWork(seat, [HALTED], window)).toEqual({ occupied: 'halted', active: 'halted' })
    expect(seatWork(seat, [{ ...SHIPPED, at: '2026-09-20T00:00:00.000Z' }, HALTED], window)).toEqual({ occupied: 'model', active: 'halted' })
    expect(seatWork(seat, [SHIPPED, HALTED, { ...GATE, seat: 'another-seat' }], window)).toEqual({ occupied: 'model', active: 'model' })
    expect(seatWork({ ...seat, sessions: 2, lastSeen: '2026-09-20T00:00:00.000Z' }, [], window)).toEqual({ occupied: 'model' })
    expect(seatWork({ id: GATE.seat, division: 'verification', sessions: 0 }, [GATE], window)).toEqual({ occupied: 'check', active: 'check' })
  })

  it('counts seats per kind, every kind present', () => {
    expect(countWork(['model', undefined, 'check', 'model'])).toEqual({ model: 2, check: 1, halted: 0 })
  })
})
