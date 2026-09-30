import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import { ROSTER_PATH } from './enterprise-roster.ts'
import type { Roster } from './enterprise-roster.ts'
import { HARNESS_QUEUE_POLICY, isRequestFile, loadTickets, OPEN_QUEUE_POLICY, REQUESTS_DIR, TICKETS_DIR, validateTickets } from './enterprise-tickets.ts'
import type { LoadedTicket } from './enterprise-tickets.ts'

const root = resolve(import.meta.dirname, '..')
const roster = JSON.parse(readFileSync(resolve(root, ROSTER_PATH), 'utf8')) as Roster

const trees: string[] = []

afterAll(() => {
  for (const tree of trees.splice(0)) rmSync(tree, { recursive: true, force: true })
})

/** A tree holding the reference ticket's scope, one request, and the requests README. */
function requestTree(): string {
  const tree = mkdtempSync(join(tmpdir(), 'enterprise-tickets-'))
  trees.push(tree)
  mkdirSync(join(tree, 'packages/core/agent'), { recursive: true })
  mkdirSync(join(tree, REQUESTS_DIR), { recursive: true })
  writeFileSync(join(tree, REQUESTS_DIR, 'dark-mode.md'), '# Show the deck in dark mode\n\nThe deck is too bright at night.\n')
  writeFileSync(join(tree, REQUESTS_DIR, 'README.md'), '# Requests\n')
  return tree
}

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

  it('names in the harness policy only generated paths the tree tracks', () => {
    for (const path of HARNESS_QUEUE_POLICY.generatedPaths) {
      const tracked = execFileSync('git', ['ls-files', '--', path], { cwd: root, encoding: 'utf8' })
      expect(tracked.trim(), path).not.toBe('')
    }
    expect(OPEN_QUEUE_POLICY.generatedPaths).toEqual([])
    expect(OPEN_QUEUE_POLICY.heavyFragments).toEqual(HARNESS_QUEUE_POLICY.heavyFragments)
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

describe('a shipped ticket', () => {
  /** Write the tree's ledger as one line recording `ticket` as shipped. */
  function recordShipped(tree: string, ticket: string): void {
    mkdirSync(join(tree, 'data/enterprise'), { recursive: true })
    writeFileSync(join(tree, 'data/enterprise/ledger.jsonl'), `${JSON.stringify({ type: 'ticket', at: '2026-09-29T13:37:00.000Z', shift: '121310-3eae', ticket, seat: 'x', division: 'x', checks: [], shipped: { commit: 'a'.repeat(40) } })}\n`)
  }

  it('is not held to a source anchor its own change rewrote; an open ticket is', () => {
    const tree = requestTree()
    const ticket = { ...validTicket(), source: { path: `${REQUESTS_DIR}/README.md`, anchor: '# Old heading' }, priority: 2 }
    const loaded: LoadedTicket[] = [{ file: `${TICKETS_DIR}/T-0001.json`, value: ticket }]
    expect(validateTickets(loaded, roster, tree).join('\n')).toMatch(/source\.anchor "# Old heading" does not occur/)
    recordShipped(tree, 'T-0001')
    expect(validateTickets(loaded, roster, tree).join('\n')).not.toMatch(/source\.anchor/)
  })

  it('is not held to a source file or scope prefix its own change removed; an open ticket is', () => {
    const tree = requestTree()
    const ticket = { ...validTicket(), source: { path: '.agents/notes/proposed/moved.md', anchor: '## Acceptance criteria' }, scope: ['packages/core/agent/', '.agents/notes/proposed/'] }
    const loaded: LoadedTicket[] = [{ file: `${TICKETS_DIR}/T-0001.json`, value: ticket }]
    const open = validateTickets(loaded, roster, tree).join('\n')
    expect(open).toMatch(/source\.path "\.agents\/notes\/proposed\/moved\.md" does not exist in the tree/)
    expect(open).toMatch(/scope prefix "\.agents\/notes\/proposed\/" does not exist in the tree/)
    recordShipped(tree, 'T-0001')
    expect(validateTickets(loaded, roster, tree)).toEqual([])
  })
})

describe('priority 0', () => {
  function validate(tree: string, source: { path: string; anchor: string }, priority: number): string[] {
    const ticket = { ...validTicket(), source, priority }
    return validateTickets([{ file: `${TICKETS_DIR}/T-0001.json`, value: ticket }], roster, tree)
  }

  it('is allowed, not required, on a ticket whose source is one of the owner\'s requests', () => {
    const tree = requestTree()
    expect(validate(tree, { path: `${REQUESTS_DIR}/dark-mode.md`, anchor: '# Show the deck in dark mode' }, 0)).toEqual([])
    expect(validate(tree, { path: `${REQUESTS_DIR}/dark-mode.md`, anchor: '# Show the deck in dark mode' }, 2)).toEqual([])
  })

  it('is refused on a ticket whose source is not a request, the requests README included', () => {
    expect(errorsOf((ticket) => { ticket['priority'] = 0 })).toEqual([
      `${TICKETS_DIR}/T-0001.json: priority 0 is reserved for a ticket whose source.path is a request under ${REQUESTS_DIR}/`,
    ])
    expect(validate(requestTree(), { path: `${REQUESTS_DIR}/README.md`, anchor: '# Requests' }, 0).join('\n')).toMatch(/priority 0 is reserved/)
    expect(errorsOf((ticket) => { ticket['priority'] = -1 }).join('\n')).toMatch(/from 1 to 3, or 0 for a ticket answering a request/)
  })

  it.each([
    [`${REQUESTS_DIR}/dark-mode.md`, true],
    [`${REQUESTS_DIR}/Dark mode.MD`, true],
    [`${REQUESTS_DIR}/README.md`, false],
    [`${REQUESTS_DIR}/readme.zh.md`, false],
    [`${REQUESTS_DIR}/archive/old.md`, false],
    [`${REQUESTS_DIR}/notes.txt`, false],
    ['data/enterprise/requests.md', false],
    [`${TICKETS_DIR}/README.md`, false],
  ])('reads %s as a request: %s', (path, expected) => {
    expect(isRequestFile(path)).toBe(expected)
  })
})
