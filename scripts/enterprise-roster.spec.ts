import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

import { buildRoster, generateRoster, ROSTER_AGENT_COUNT, ROSTER_PATH, serializeRoster } from './enterprise-roster.ts'
import type { Roster } from './enterprise-roster.ts'
import { readRecordedSessions, type RunSessions } from './roster-evidence.ts'

const root = resolve(import.meta.dirname, '..')
/** A fixed stamp: the tests assert content, and `generateRoster` owns the stamp. */
const STAMP = '2026-01-01T00:00:00Z'
/** No recorded sessions: the definition tests read the seats alone. */
const NONE: readonly RunSessions[] = []

/** The committed roster file and the sessions of exactly the records it names, read once for the whole file. */
let committed: { content: string; roster: Roster }
let recorded: RunSessions[]

beforeAll(() => {
  const content = readFileSync(resolve(root, ROSTER_PATH), 'utf8')
  committed = { content, roster: JSON.parse(content) as Roster }
  recorded = readRecordedSessions(root, committed.roster.evidence.records)
}, 60_000)

describe('buildRoster', () => {
  it('composes exactly 147 seats with unique ids', () => {
    const roster = buildRoster(root, { generatedAt: STAMP, recorded: NONE })
    expect(roster.agents).toHaveLength(ROSTER_AGENT_COUNT)
    expect(roster.counts).toEqual({ defined: 147, occupied: 0, active: 0 })
    expect(new Set(roster.agents.map(agent => agent.id)).size).toBe(ROSTER_AGENT_COUNT)
  })

  it('cites a source that exists on disk for every agent', () => {
    const roster = buildRoster(root, { generatedAt: STAMP, recorded: NONE })
    for (const agent of roster.agents) {
      expect(existsSync(resolve(root, agent.source)), `${agent.id} cites missing source "${agent.source}"`).toBe(true)
    }
  })

  it('names an existing agent id at both ends of every edge', () => {
    const roster = buildRoster(root, { generatedAt: STAMP, recorded: NONE })
    const ids = new Set(roster.agents.map(agent => agent.id))
    expect(roster.edges.length).toBeGreaterThan(0)
    for (const edge of roster.edges) {
      expect(ids.has(edge.from), `edge.from "${edge.from}" is not a roster agent`).toBe(true)
      expect(ids.has(edge.to), `edge.to "${edge.to}" is not a roster agent`).toBe(true)
    }
  })

  it('names every division exactly once, matching each agent\'s division field', () => {
    const roster = buildRoster(root, { generatedAt: STAMP, recorded: NONE })
    const divisionIds = roster.divisions.map(division => division.id)
    expect(new Set(divisionIds).size).toBe(divisionIds.length)
    const usedDivisions = new Set(roster.agents.map(agent => agent.division))
    for (const division of usedDivisions) expect(divisionIds).toContain(division)
  })

  it('sets department only on code-safety agents', () => {
    const roster = buildRoster(root, { generatedAt: STAMP, recorded: NONE })
    for (const agent of roster.agents) {
      if (agent.department !== undefined) expect(agent.division).toBe('code-safety')
    }
  })

  it('gives every seat zero evidence when no session is recorded', () => {
    const roster = buildRoster(root, { generatedAt: STAMP, recorded: NONE })
    expect(roster.agents.every(agent => agent.evidence.sessions === 0 && agent.evidence.routesSeen.length === 0)).toBe(true)
    expect(roster.evidence).toEqual({ records: [], sessions: 0, routes: {} })
    expect(roster.unattributed.sessions).toBe(0)
  })

  it('accounts for every recorded session exactly once: on one seat, or unattributed', () => {
    const roster = buildRoster(root, { generatedAt: STAMP, recorded })
    const onSeats = roster.agents.reduce((sum, agent) => sum + agent.evidence.sessions, 0)
    expect(onSeats + roster.unattributed.sessions).toBe(roster.evidence.sessions)
    expect(roster.evidence.sessions).toBe(recorded.reduce((sum, run) => sum + run.sessions.length, 0))
    expect(Object.values(roster.unattributed.reasons).reduce((sum, count) => sum + count, 0)).toBe(roster.unattributed.sessions)
    const occupied = roster.agents.filter(agent => agent.evidence.sessions > 0)
    expect(roster.counts.occupied).toBe(occupied.length)
    for (const agent of roster.agents.filter(seat => seat.evidence.sessions === 0)) {
      expect(agent.evidence, `${agent.id} has no session but carries evidence`).toEqual({ sessions: 0, routesSeen: [] })
    }
    for (const agent of occupied) {
      for (const route of agent.evidence.routesSeen) expect(roster.evidence.routes[route], `${agent.id} saw ${route}`).toBeGreaterThan(0)
    }
  })

  it('is idempotent: the same tree serializes to byte-identical JSON across independent builds', () => {
    const first = serializeRoster(buildRoster(root, { generatedAt: STAMP, recorded }))
    const second = serializeRoster(buildRoster(root, { generatedAt: STAMP, recorded }))
    expect(second).toBe(first)
    expect(first.endsWith('\n')).toBe(true)
    expect(first.endsWith('\n\n')).toBe(false)
  })

  it('matches the committed data/enterprise/roster.json over exactly the records it names', () => {
    expect(committed.content).toBe(serializeRoster(buildRoster(root, { generatedAt: committed.roster.generatedAt, recorded })))
  })

  it('fails loudly when a cited source is missing instead of shipping a dangling entry', () => {
    expect(() => buildRoster(root, {
      generatedAt: STAMP,
      recorded: NONE,
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
      const kept = generateRoster(root, recorded, later, file)
      expect(kept.changed).toBe(false)
      expect(readFileSync(file, 'utf8')).toBe(committed.content)

      writeFileSync(file, committed.content.replace('"active": 0', '"active": 1'))
      const restamped = generateRoster(root, recorded, later, file)
      expect(restamped.changed).toBe(true)
      expect(restamped.roster.generatedAt).toBe(later())
      expect(readFileSync(file, 'utf8')).toBe(serializeRoster(buildRoster(root, { generatedAt: later(), recorded })))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('writes a missing file under the injected stamp', () => {
    const dir = mkdtempSync(join(tmpdir(), 'enterprise-roster-'))
    try {
      const file = join(dir, 'nested', 'roster.json')
      const written = generateRoster(root, NONE, later, file)
      expect(written.changed).toBe(true)
      expect(readFileSync(file, 'utf8')).toBe(serializeRoster(buildRoster(root, { generatedAt: later(), recorded: NONE })))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
