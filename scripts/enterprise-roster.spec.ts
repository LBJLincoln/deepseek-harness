import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

import { LEDGER_PATH, readLedger, type FunctionLine, type LedgerLine, type TicketLine } from './enterprise-ledger.ts'
import { buildRoster, generateRoster, ROSTER_AGENT_COUNT, ROSTER_PATH, serializeRoster } from './enterprise-roster.ts'
import type { Roster } from './enterprise-roster.ts'
import { readRecordedSessions, type RunSessions } from './roster-evidence.ts'

const root = resolve(import.meta.dirname, '..')
/** A fixed stamp: the tests assert content, and `generateRoster` owns the stamp. */
const STAMP = '2026-01-01T00:00:00Z'
/** No recorded sessions: the definition tests read the seats alone. */
const NONE: readonly RunSessions[] = []
/** No ledger lines. */
const EMPTY: readonly LedgerLine[] = []

/** A gate run one hour before {@link STAMP}, on the first verifier seat. */
const GATE: FunctionLine = {
  type: 'function',
  at: '2025-12-31T23:00:00.000Z',
  shift: 'shift-1',
  seat: 'verification-verify-agent-note-classification',
  division: 'verification',
  function: 'verify-agent-note-classification',
  target: { commit: 'abc123' },
  outcome: 'pass',
  evidence: { path: 'data/enterprise/functions/shift-1/verification-verify-agent-note-classification.log' },
  seconds: 1,
}

/** A ticket shipped two days before {@link STAMP}, on a Harness Core steward. */
const SHIPPED: TicketLine = {
  type: 'ticket',
  at: '2025-12-30T00:00:00.000Z',
  shift: 'shift-0',
  ticket: 'T-0001',
  seat: 'harness-core-session-steward',
  division: 'harness-core',
  checks: [],
  shipped: { commit: 'abc123' },
}

/** The committed roster file, the sessions of exactly the records it names and the ledger lines it covers, read once. */
let committed: { content: string; roster: Roster }
let recorded: RunSessions[]
let ledger: LedgerLine[]

beforeAll(() => {
  const content = readFileSync(resolve(root, ROSTER_PATH), 'utf8')
  committed = { content, roster: JSON.parse(content) as Roster }
  recorded = readRecordedSessions(root, committed.roster.evidence.records)
  ledger = readLedger(resolve(root, LEDGER_PATH)).lines.slice(0, committed.roster.ledger.lines)
}, 60_000)

describe('buildRoster', () => {
  it('composes exactly 147 seats with unique ids', () => {
    const roster = buildRoster(root, { generatedAt: STAMP, recorded: NONE, ledger: EMPTY })
    expect(roster.agents).toHaveLength(ROSTER_AGENT_COUNT)
    expect(roster.counts).toEqual({ defined: 147, occupied: 0, active: 0 })
    expect(new Set(roster.agents.map(agent => agent.id)).size).toBe(ROSTER_AGENT_COUNT)
  })

  it('cites a source that exists on disk for every agent', () => {
    const roster = buildRoster(root, { generatedAt: STAMP, recorded: NONE, ledger: EMPTY })
    for (const agent of roster.agents) {
      expect(existsSync(resolve(root, agent.source)), `${agent.id} cites missing source "${agent.source}"`).toBe(true)
    }
  })

  it('names an existing agent id at both ends of every edge', () => {
    const roster = buildRoster(root, { generatedAt: STAMP, recorded: NONE, ledger: EMPTY })
    const ids = new Set(roster.agents.map(agent => agent.id))
    expect(roster.edges.length).toBeGreaterThan(0)
    for (const edge of roster.edges) {
      expect(ids.has(edge.from), `edge.from "${edge.from}" is not a roster agent`).toBe(true)
      expect(ids.has(edge.to), `edge.to "${edge.to}" is not a roster agent`).toBe(true)
    }
  })

  it('names every division exactly once, matching each agent\'s division field', () => {
    const roster = buildRoster(root, { generatedAt: STAMP, recorded: NONE, ledger: EMPTY })
    const divisionIds = roster.divisions.map(division => division.id)
    expect(new Set(divisionIds).size).toBe(divisionIds.length)
    const usedDivisions = new Set(roster.agents.map(agent => agent.division))
    for (const division of usedDivisions) expect(divisionIds).toContain(division)
  })

  it('sets department only on code-safety agents', () => {
    const roster = buildRoster(root, { generatedAt: STAMP, recorded: NONE, ledger: EMPTY })
    for (const agent of roster.agents) {
      if (agent.department !== undefined) expect(agent.division).toBe('code-safety')
    }
  })

  it('gives every seat zero evidence when no session is recorded', () => {
    const roster = buildRoster(root, { generatedAt: STAMP, recorded: NONE, ledger: EMPTY })
    expect(roster.agents.every(agent => agent.evidence.sessions === 0 && agent.evidence.routesSeen.length === 0)).toBe(true)
    expect(roster.evidence).toEqual({ records: [], sessions: 0, routes: {} })
    expect(roster.unattributed.sessions).toBe(0)
    expect(roster.agents.every(agent => agent.ledger.lines === 0 && agent.status === 'defined')).toBe(true)
    expect(roster.ledger).toEqual({ path: LEDGER_PATH, lines: 0, unseated: 0 })
  })

  it('occupies a seat by a ledger line counted exactly by its id, and activates it only inside the 24 hours before the stamp', () => {
    const roster = buildRoster(root, { generatedAt: STAMP, recorded: NONE, ledger: [GATE, SHIPPED, { ...GATE, seat: 'verification-verify-agent-note' }] })
    expect(roster.activeWindow).toEqual({ since: '2025-12-31T00:00:00.000Z', until: '2026-01-01T00:00:00.000Z' })
    const verifier = roster.agents.find(agent => agent.id === GATE.seat)
    expect(verifier).toMatchObject({ status: 'active', ledger: { lines: 1, lastAt: GATE.at }, evidence: { sessions: 0, routesSeen: [] } })
    const steward = roster.agents.find(agent => agent.id === SHIPPED.seat)
    expect(steward).toMatchObject({ status: 'defined', ledger: { lines: 1, lastAt: SHIPPED.at } })
    expect(roster.counts).toEqual({ defined: 147, occupied: 2, active: 1 })
    expect(roster.ledger).toEqual({ path: LEDGER_PATH, lines: 3, unseated: 1 })
    expect(roster.agents.filter(agent => agent.ledger.lines > 0).map(agent => agent.id).sort()).toEqual([SHIPPED.seat, GATE.seat].sort())
  })

  it('activates a seat by a recorded session dated inside the window, by the record\'s own time', () => {
    const inside = buildRoster(root, { generatedAt: '2026-09-23T00:00:00.000Z', recorded, ledger: EMPTY })
    const outside = buildRoster(root, { generatedAt: '2026-09-25T00:00:00.000Z', recorded, ledger: EMPTY })
    const newest = recorded.flatMap(run => run.sessions).reduce((max, session) => Math.max(max, session.lastSeenMs ?? 0), 0)
    expect(new Date(newest).toISOString() > inside.activeWindow.since).toBe(true)
    expect(inside.counts.active).toBeGreaterThan(0)
    expect(inside.agents.filter(agent => agent.status === 'active').every(agent => agent.evidence.sessions > 0)).toBe(true)
    expect(outside.counts.active).toBe(0)
    expect(outside.counts.occupied).toBe(inside.counts.occupied)
  })

  it('accounts for every recorded session exactly once: on one seat, or unattributed', () => {
    const roster = buildRoster(root, { generatedAt: STAMP, recorded, ledger })
    const onSeats = roster.agents.reduce((sum, agent) => sum + agent.evidence.sessions, 0)
    expect(onSeats + roster.unattributed.sessions).toBe(roster.evidence.sessions)
    expect(roster.evidence.sessions).toBe(recorded.reduce((sum, run) => sum + run.sessions.length, 0))
    expect(Object.values(roster.unattributed.reasons).reduce((sum, count) => sum + count, 0)).toBe(roster.unattributed.sessions)
    const occupied = roster.agents.filter(agent => agent.evidence.sessions > 0)
    // A seat is occupied by a session or by a ledger line; the ledger's own test covers the lines.
    expect(roster.counts.occupied).toBe(roster.agents.filter(agent => agent.evidence.sessions > 0 || agent.ledger.lines > 0).length)
    expect(roster.counts.occupied).toBeGreaterThanOrEqual(occupied.length)
    for (const agent of roster.agents.filter(seat => seat.evidence.sessions === 0)) {
      expect(agent.evidence, `${agent.id} has no session but carries evidence`).toEqual({ sessions: 0, routesSeen: [] })
    }
    for (const agent of occupied) {
      for (const route of agent.evidence.routesSeen) expect(roster.evidence.routes[route], `${agent.id} saw ${route}`).toBeGreaterThan(0)
    }
  })

  it('is idempotent: the same tree serializes to byte-identical JSON across independent builds', () => {
    const first = serializeRoster(buildRoster(root, { generatedAt: STAMP, recorded, ledger }))
    const second = serializeRoster(buildRoster(root, { generatedAt: STAMP, recorded, ledger }))
    expect(second).toBe(first)
    expect(first.endsWith('\n')).toBe(true)
    expect(first.endsWith('\n\n')).toBe(false)
  })

  it('matches the committed data/enterprise/roster.json over exactly the records it names', () => {
    expect(committed.content).toBe(serializeRoster(buildRoster(root, { generatedAt: committed.roster.generatedAt, recorded, ledger })))
  })

  it('fails loudly when a cited source is missing instead of shipping a dangling entry', () => {
    expect(() => buildRoster(root, {
      generatedAt: STAMP,
      recorded: NONE,
      ledger: EMPTY,
      notePath: '.agents/notes/implemented/architecture/does-not-exist.md',
    })).toThrow(/does not exist in this tree/)
  })
})

describe('generateRoster', () => {
  const later = () => '2099-01-01T00:00:00Z'

  it('keeps an unchanged file byte-identical, stamp included, and restamps it only when the content changes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'enterprise-roster-'))
    try {
      const file = join(dir, 'roster.json')
      writeFileSync(file, committed.content)
      const kept = generateRoster(root, recorded, ledger, later, file)
      expect(kept.changed).toBe(false)
      expect(readFileSync(file, 'utf8')).toBe(committed.content)

      writeFileSync(file, committed.content.replace('"defined": 147', '"defined": 146'))
      const restamped = generateRoster(root, recorded, ledger, later, file)
      expect(restamped.changed).toBe(true)
      expect(restamped.roster.generatedAt).toBe(later())
      expect(readFileSync(file, 'utf8')).toBe(serializeRoster(buildRoster(root, { generatedAt: later(), recorded, ledger })))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('writes a missing file under the injected stamp', () => {
    const dir = mkdtempSync(join(tmpdir(), 'enterprise-roster-'))
    try {
      const file = join(dir, 'nested', 'roster.json')
      const written = generateRoster(root, NONE, EMPTY, later, file)
      expect(written.changed).toBe(true)
      expect(readFileSync(file, 'utf8')).toBe(serializeRoster(buildRoster(root, { generatedAt: later(), recorded: NONE, ledger: EMPTY })))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
