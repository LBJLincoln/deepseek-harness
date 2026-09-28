import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { LEDGER_PATH, type FunctionLine, type LedgerLine, type TicketLine } from './enterprise-ledger.ts'
import {
  buildEnterpriseReport,
  ENTERPRISE_FIXTURE,
  publishDeckData,
  ROSTER_FIXTURE,
  SHIPPED_LIMIT,
  type EnterpriseReport,
} from './enterprise-publish.ts'
import { buildRoster, ROSTER_PATH, serializeRoster, type Roster } from './enterprise-roster.ts'
import { TICKETS_DIR } from './enterprise-tickets.ts'

const root = resolve(import.meta.dirname, '..')
const STAMP = '2026-09-28T18:00:00.000Z'
const COMMIT = '6fb91bb110919ffd1652a497fe3c0b4074c1e6f6'

/** A ticket line over the shipped default; an override of `undefined` removes the field. */
function ticket(overrides: { [K in keyof TicketLine]?: TicketLine[K] | undefined }): TicketLine {
  const line: Record<string, unknown> = {
    type: 'ticket',
    at: '2026-09-28T12:00:00.000Z',
    shift: 'shift-1',
    ticket: 'T-0001',
    seat: 'harness-core-session-steward',
    division: 'harness-core',
    checks: [{ id: 'typecheck', ok: true }],
    review: { verdict: 'approve' },
    integration: { outcome: 'merged' },
    shipped: { commit: COMMIT },
    ...overrides,
  }
  return Object.fromEntries(Object.entries(line).filter(([, value]) => value !== undefined)) as unknown as TicketLine
}

function verdict(overrides: Partial<FunctionLine>): FunctionLine {
  return {
    type: 'function',
    at: '2026-09-28T13:00:00.000Z',
    shift: 'shift-1',
    seat: 'judging-ci-static',
    division: 'judging',
    function: 'ci-static',
    target: { commit: COMMIT },
    outcome: 'pass',
    evidence: { url: 'https://github.com/LBJLincoln/deepseek-harness/actions/runs/1/job/1' },
    seconds: 200,
    ...overrides,
  }
}

const GATE: FunctionLine = verdict({
  seat: 'verification-verify-md-links',
  division: 'verification',
  function: 'verify-md-links',
  at: '2026-09-28T17:00:00.000Z',
  evidence: { path: 'data/enterprise/functions/shift-1/verification-verify-md-links.log' },
  seconds: 12,
})

const LEDGER: LedgerLine[] = [
  ticket({}),
  ticket({ ticket: 'T-0002', at: '2026-09-28T14:00:00.000Z', seat: 'harness-core-tools-steward', shipped: null, review: { verdict: 'request-changes' } }),
  ticket({ ticket: 'T-0003', at: '2026-09-28T15:00:00.000Z', seat: 'harness-core-agent-steward', shipped: null, review: undefined, reason: 'budget exhausted' }),
  ticket({ ticket: 'T-0004', at: '2026-09-26T15:00:00.000Z', seat: 'harness-core-agent-steward', shipped: { commit: 'f00dfeedbeef' } }),
  verdict({}),
  verdict({ seat: 'judging-ci-coverage', function: 'ci-coverage', outcome: 'fail', at: '2026-09-28T13:05:00.000Z', evidence: { url: 'https://github.com/LBJLincoln/deepseek-harness/actions/runs/1/job/3' } }),
  verdict({ at: '2026-09-26T13:05:00.000Z', target: { commit: 'f00dfeedbeef0000' }, evidence: { url: 'https://github.com/LBJLincoln/deepseek-harness/actions/runs/0/job/1' } }),
  GATE,
]

const QUEUE = [
  { id: 'T-0001', title: 'Shipped already', seat: 'harness-core-session-steward', division: 'harness-core' },
  { id: 'T-0005', title: 'Still open', seat: 'harness-core-agent-loop-steward', division: 'harness-core' },
]

let roster: Roster
beforeAll(() => {
  roster = buildRoster(root, { generatedAt: STAMP, recorded: [], ledger: LEDGER })
})

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('buildEnterpriseReport', () => {
  let report: EnterpriseReport
  beforeAll(() => {
    report = buildEnterpriseReport(roster, { lines: LEDGER, skipped: [{ line: 9, reason: 'not JSON' }] }, QUEUE.map(value => ({ file: `${TICKETS_DIR}/${value.id}.json`, value })))
  })

  it('describes the moment of the newer of the roster stamp and the last line, over the roster\'s window', () => {
    expect(report.asOf).toBe(STAMP)
    expect(report.window).toEqual(roster.activeWindow)
    expect(report.counts).toEqual(roster.counts)
    expect(report.ledger).toEqual({ lines: 8, tickets: 4, functions: 4, skipped: 1 })
  })

  it('tallies every division in roster order from the roster\'s own occupancy', () => {
    expect(report.divisions.map(division => division.id)).toEqual(roster.divisions.map(division => division.id))
    expect(report.divisions.find(division => division.id === 'harness-core')).toEqual({ id: 'harness-core', name: 'Harness Core', defined: 24, occupied: 3, active: 3 })
    expect(report.divisions.find(division => division.id === 'judging')).toEqual({ id: 'judging', name: 'Judging', defined: 11, occupied: 2, active: 2 })
    expect(report.divisions.find(division => division.id === 'verification')).toMatchObject({ occupied: 1, active: 1 })
    expect(report.divisions.reduce((sum, division) => sum + division.defined, 0)).toBe(147)
  })

  it('lists the day\'s tickets by the status of their newest line, and the queue\'s unworked tickets as queued', () => {
    expect(report.tickets.queued).toEqual([{ ticket: 'T-0005', seat: 'harness-core-agent-loop-steward', division: 'harness-core', status: 'queued', title: 'Still open' }])
    expect(report.tickets.shipped).toEqual([{ ticket: 'T-0001', seat: 'harness-core-session-steward', division: 'harness-core', status: 'shipped', at: '2026-09-28T12:00:00.000Z', shift: 'shift-1', commit: COMMIT }])
    expect(report.tickets.rejected.map(entry => entry.ticket)).toEqual(['T-0002'])
    expect(report.tickets.halted).toEqual([{ ticket: 'T-0003', seat: 'harness-core-agent-steward', division: 'harness-core', status: 'halted', at: '2026-09-28T15:00:00.000Z', shift: 'shift-1', reason: 'budget exhausted' }])
    // T-0004 shipped two days ago: not today's ticket.
    expect(Object.values(report.tickets).flat().map(entry => entry.ticket)).not.toContain('T-0004')
  })

  it('lists the day\'s function runs newest first', () => {
    expect(report.functions.map(line => [line.seat, line.at])).toEqual([
      ['verification-verify-md-links', '2026-09-28T17:00:00.000Z'],
      ['judging-ci-coverage', '2026-09-28T13:05:00.000Z'],
      ['judging-ci-static', '2026-09-28T13:00:00.000Z'],
    ])
  })

  it('lists the latest shipped commits with the verdicts recorded on them, matched by sha prefix', () => {
    expect(report.shipped.map(entry => entry.commit)).toEqual([COMMIT, 'f00dfeedbeef'])
    expect(report.shipped[0]).toEqual({
      commit: COMMIT,
      at: '2026-09-28T12:00:00.000Z',
      tickets: ['T-0001'],
      seats: ['harness-core-session-steward'],
      verdicts: [
        { seat: 'judging-ci-coverage', function: 'ci-coverage', outcome: 'fail', url: 'https://github.com/LBJLincoln/deepseek-harness/actions/runs/1/job/3', at: '2026-09-28T13:05:00.000Z' },
        { seat: 'judging-ci-static', function: 'ci-static', outcome: 'pass', url: 'https://github.com/LBJLincoln/deepseek-harness/actions/runs/1/job/1', at: '2026-09-28T13:00:00.000Z' },
      ],
    })
    expect(report.shipped[1]?.verdicts.map(entry => entry.url)).toEqual(['https://github.com/LBJLincoln/deepseek-harness/actions/runs/0/job/1'])
  })

  it('keeps the newest shipped commits only', () => {
    const many = Array.from({ length: SHIPPED_LIMIT + 3 }, (_, index) => ticket({
      ticket: `T-${String(index + 1).padStart(4, '0')}`,
      at: new Date(Date.parse('2026-09-28T00:00:00.000Z') + index * 60_000).toISOString(),
      shipped: { commit: `c0ffee${String(index).padStart(6, '0')}` },
    }))
    const listed = buildEnterpriseReport(roster, { lines: many, skipped: [] }, []).shipped
    expect(listed).toHaveLength(SHIPPED_LIMIT)
    expect(listed[0]?.commit).toBe(`c0ffee${String(SHIPPED_LIMIT + 2).padStart(6, '0')}`)
  })

  it('takes the last line\'s time as the moment when the ledger is newer than the roster', () => {
    const later = buildEnterpriseReport(roster, { lines: [...LEDGER, GATE, { ...GATE, at: '2026-09-28T19:00:00.000Z' }], skipped: [] }, [])
    expect(later.asOf).toBe('2026-09-28T19:00:00.000Z')
  })
})

describe('publishDeckData', () => {
  it('writes the roster fixture as a byte copy and the report, and rewrites neither on an unchanged input', () => {
    const dir = mkdtempSync(join(tmpdir(), 'enterprise-publish-'))
    dirs.push(dir)
    mkdirSync(join(dir, 'data/enterprise'), { recursive: true })
    const rosterContent = serializeRoster(roster)
    writeFileSync(join(dir, ROSTER_PATH), rosterContent)
    writeFileSync(join(dir, LEDGER_PATH), LEDGER.map(line => `${JSON.stringify(line)}\n`).join(''))
    mkdirSync(join(dir, TICKETS_DIR), { recursive: true })
    for (const entry of QUEUE) writeFileSync(join(dir, TICKETS_DIR, `${entry.id}.json`), JSON.stringify(entry))
    const first = publishDeckData(dir)
    expect(first.changed).toEqual([ROSTER_FIXTURE, ENTERPRISE_FIXTURE])
    expect(readFileSync(join(dir, ROSTER_FIXTURE), 'utf8')).toBe(rosterContent)
    const written = JSON.parse(readFileSync(join(dir, ENTERPRISE_FIXTURE), 'utf8')) as EnterpriseReport
    expect(written).toEqual(first.report)
    expect(written.tickets.queued.map(entry => entry.ticket)).toEqual(['T-0005'])
    const second = publishDeckData(dir)
    expect(second.changed).toEqual([])
    expect(second.report).toEqual(first.report)
  })

  it('refuses to publish without a generated roster', () => {
    const dir = mkdtempSync(join(tmpdir(), 'enterprise-publish-'))
    dirs.push(dir)
    expect(() => publishDeckData(dir)).toThrow(/run pnpm run roster first/)
  })
})
