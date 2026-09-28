import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { ROSTER_PATH } from './enterprise-roster.ts'
import type { Roster } from './enterprise-roster.ts'
import { loadTickets, TICKETS_DIR, validateTickets } from './enterprise-tickets.ts'
import type { LoadedTicket } from './enterprise-tickets.ts'

const root = resolve(import.meta.dirname, '..')
const roster = JSON.parse(readFileSync(resolve(root, ROSTER_PATH), 'utf8')) as Roster

/** A ticket that satisfies every rule, grounded in files the queue itself ships. */
function validTicket(): Record<string, unknown> {
  return {
    id: 'T-0001',
    title: 'A valid ticket',
    division: 'harness-core',
    seat: 'harness-core-agent-steward',
    kind: 'docs',
    source: { path: `${TICKETS_DIR}/README.md`, anchor: '# Enterprise ticket queue' },
    task: 'Problem: packages/core/agent/README.md:1 states the contract. Required: keep it.',
    scope: ['packages/core/agent/'],
    acceptance: [
      { id: 'coverage', run: "pnpm exec vitest run packages/core/agent --coverage --coverage.include='packages/core/agent/src/**/*.ts'" },
      { id: 'typecheck', run: 'pnpm run typecheck' },
    ],
    budget: { maxTotalTokens: 8_000_000, maxWallMs: 2_700_000 },
    priority: 1,
  }
}

function errorsOf(mutate: (ticket: Record<string, unknown>) => void, file = `${TICKETS_DIR}/T-0001.json`): string[] {
  const ticket = validTicket()
  mutate(ticket)
  const loaded: LoadedTicket[] = [{ file, value: ticket }]
  return validateTickets(loaded, roster, root)
}

describe('enterprise ticket queue', () => {
  it('validates every committed ticket against the roster and the tree', () => {
    const loaded = loadTickets(root)
    expect(loaded.length).toBeGreaterThan(0)
    expect(validateTickets(loaded, roster, root)).toEqual([])
  })

  it('assigns every committed ticket to a steward of its own division', () => {
    for (const { file, value } of loadTickets(root)) {
      const ticket = value as { seat: string; division: string }
      const seat = roster.agents.find(agent => agent.id === ticket.seat)
      expect(seat?.division, file).toBe(ticket.division)
    }
  })

  it('accepts the reference ticket', () => {
    expect(errorsOf(() => {})).toEqual([])
  })

  it.each([
    ['an unknown field', (t: Record<string, unknown>) => { t['status'] = 'open' }, /unknown field "status"/],
    ['a missing field', (t: Record<string, unknown>) => { delete t['title'] }, /missing "title"/],
    ['a seat outside the roster', (t: Record<string, unknown>) => { t['seat'] = 'harness-core-nobody' }, /seat "harness-core-nobody" is not in the roster/],
    ['a seat from another division', (t: Record<string, unknown>) => { t['seat'] = roster.agents.find(a => a.division !== 'harness-core')?.id }, /belongs to division/],
    ['a division outside the roster', (t: Record<string, unknown>) => { t['division'] = 'nowhere' }, /division "nowhere" is not in the roster/],
    ['an unknown kind', (t: Record<string, unknown>) => { t['kind'] = 'wish' }, /kind "wish" is not one of/],
    ['a source path outside the tree', (t: Record<string, unknown>) => { t['source'] = { path: 'packages/core/agent/MISSING.md', anchor: 'x' } }, /does not exist in the tree/],
    ['an anchor the source does not contain', (t: Record<string, unknown>) => { t['source'] = { path: `${TICKETS_DIR}/README.md`, anchor: 'no such heading' } }, /does not occur in/],
    ['a task without path:line evidence', (t: Record<string, unknown>) => { t['task'] = 'Do the thing.' }, /cite its evidence/],
    ['an empty scope', (t: Record<string, unknown>) => { t['scope'] = [] }, /scope must be a non-empty array/],
    ['a scope prefix outside the tree', (t: Record<string, unknown>) => { t['scope'] = ['packages/core/nonexistent/'] }, /scope prefix .* does not exist/],
    ['an empty acceptance', (t: Record<string, unknown>) => { t['acceptance'] = [] }, /acceptance must be a non-empty array/],
    ['an acceptance without typecheck', (t: Record<string, unknown>) => { t['acceptance'] = [{ id: 'coverage', run: 'pnpm exec vitest run x --coverage' }] }, /must include "pnpm run typecheck"/],
    ['an acceptance without the coverage run', (t: Record<string, unknown>) => { t['acceptance'] = [{ id: 'typecheck', run: 'pnpm run typecheck' }] }, /per-file coverage run/],
    ['a repeated check id', (t: Record<string, unknown>) => { (t['acceptance'] as unknown[]).push({ id: 'typecheck', run: 'pnpm run typecheck' }) }, /repeats the check id/],
    ['a non-positive budget', (t: Record<string, unknown>) => { t['budget'] = { maxTotalTokens: 0, maxWallMs: 1 } }, /maxTotalTokens must be a positive integer/],
    ['a priority outside 1..3', (t: Record<string, unknown>) => { t['priority'] = 4 }, /priority must be an integer from 1 to 3/],
  ])('rejects %s', (_label, mutate, message) => {
    expect(errorsOf(mutate).join('\n')).toMatch(message)
  })

  it('rejects an id that does not match its file name', () => {
    expect(errorsOf(() => {}, `${TICKETS_DIR}/T-0002.json`).join('\n')).toMatch(/does not match the file name/)
  })

  it('rejects a queue numbered with a gap', () => {
    const second = validTicket()
    second['id'] = 'T-0003'
    const loaded: LoadedTicket[] = [
      { file: `${TICKETS_DIR}/T-0001.json`, value: validTicket() },
      { file: `${TICKETS_DIR}/T-0003.json`, value: second },
    ]
    expect(validateTickets(loaded, roster, root).join('\n')).toMatch(/numbered without gaps/)
  })

  it('reports a file that is not JSON', () => {
    const loaded: LoadedTicket[] = [{ file: `${TICKETS_DIR}/T-0001.json`, value: new SyntaxError('Unexpected token') }]
    expect(validateTickets(loaded, roster, root).join('\n')).toMatch(/not valid JSON/)
  })
})
