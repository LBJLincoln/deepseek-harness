/**
 * The division colours (`deck/palette.ts`) against the roster the deck
 * publishes: a division the palette does not name renders in the grey
 * fallback, which is how two divisions once shared one grey.
 */
import { describe, expect, it } from 'vitest'
import roster from '../public/fixtures/roster.json'
import type { Agent, Roster } from '../deck/contract.ts'
import { DIVISION_COLOR, divisionColor } from '../deck/palette.ts'
import { stageOf } from '../deck/pipeline.ts'

const published = roster as unknown as Roster

describe('division colours', () => {
  it('names a colour for every division of the published roster, and no two share one', () => {
    const ids = published.divisions.map(division => division.id)
    expect(ids.filter(id => DIVISION_COLOR[id] === undefined)).toEqual([])
    expect(new Set(ids.map(divisionColor)).size).toBe(ids.length)
  })

  it('keys nothing the roster does not define', () => {
    const ids = new Set(published.divisions.map(division => division.id))
    expect(Object.keys(DIVISION_COLOR).filter(id => !ids.has(id))).toEqual([])
  })
})

describe('stageOf', () => {
  it('places a curation-data seat\'s work at integration, with the records it keeps', () => {
    const seat = published.agents.find(agent => agent.division === 'curation-data') as Agent
    expect(stageOf({ ts: 0, seq: 1, sessionId: 's', agentId: seat.id, kind: 'tool', label: 'read' }, seat)).toBe(3)
  })
})
