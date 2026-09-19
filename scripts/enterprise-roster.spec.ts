import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { buildRoster, ROSTER_AGENT_COUNT, serializeRoster } from './enterprise-roster.ts'

const root = resolve(import.meta.dirname, '..')

describe('buildRoster', () => {
  it('composes exactly 147 agents with unique ids', () => {
    const roster = buildRoster(root)
    expect(roster.agents).toHaveLength(ROSTER_AGENT_COUNT)
    expect(roster.counts).toEqual({ defined: 147, active: 0 })
    expect(new Set(roster.agents.map(agent => agent.id)).size).toBe(ROSTER_AGENT_COUNT)
  })

  it('cites a source that exists on disk for every agent', () => {
    const roster = buildRoster(root)
    for (const agent of roster.agents) {
      expect(existsSync(resolve(root, agent.source)), `${agent.id} cites missing source "${agent.source}"`).toBe(true)
    }
  })

  it('names an existing agent id at both ends of every edge', () => {
    const roster = buildRoster(root)
    const ids = new Set(roster.agents.map(agent => agent.id))
    expect(roster.edges.length).toBeGreaterThan(0)
    for (const edge of roster.edges) {
      expect(ids.has(edge.from), `edge.from "${edge.from}" is not a roster agent`).toBe(true)
      expect(ids.has(edge.to), `edge.to "${edge.to}" is not a roster agent`).toBe(true)
    }
  })

  it('names every division exactly once, matching each agent\'s division field', () => {
    const roster = buildRoster(root)
    const divisionIds = roster.divisions.map(division => division.id)
    expect(new Set(divisionIds).size).toBe(divisionIds.length)
    const usedDivisions = new Set(roster.agents.map(agent => agent.division))
    for (const division of usedDivisions) expect(divisionIds).toContain(division)
  })

  it('sets department only on code-safety agents', () => {
    const roster = buildRoster(root)
    for (const agent of roster.agents) {
      if (agent.department !== undefined) expect(agent.division).toBe('code-safety')
    }
  })

  it('is idempotent: the same tree serializes to byte-identical JSON across independent builds', () => {
    const first = serializeRoster(buildRoster(root))
    const second = serializeRoster(buildRoster(root))
    expect(second).toBe(first)
    expect(first.endsWith('\n')).toBe(true)
    expect(first.endsWith('\n\n')).toBe(false)
  })

  it('matches the committed data/enterprise/roster.json', () => {
    const committedPath = resolve(root, 'data/enterprise/roster.json')
    expect(existsSync(committedPath), 'run `pnpm run roster` to regenerate data/enterprise/roster.json').toBe(true)
    const committed = readFileSync(committedPath, 'utf8')
    expect(committed).toBe(serializeRoster(buildRoster(root)))
  })

  it('fails loudly when a cited source is missing instead of shipping a dangling entry', () => {
    expect(() => buildRoster(root, '.agents/notes/implemented/architecture/does-not-exist.md')).toThrow(
      /does not exist in this tree/,
    )
  })
})
