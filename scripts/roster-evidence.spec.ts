import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  attributeRun,
  committedRecords,
  parseProgramSession,
  readRecordedSessions,
  summarizeEvidence,
  type EvidenceSeat,
} from './roster-evidence.ts'
import type { SessionFacts } from './session-records.ts'

const DIGEST = 'a'.repeat(64)
const PROGRAM = `program-${DIGEST}`

/** A small roster: the code-safety lead and two departments, and two bench operators. */
const SEATS: readonly EvidenceSeat[] = [
  { id: 'code-safety-secrets-javascript-typescript-reviewer', division: 'code-safety', role: 'reviewer', department: 'secrets' },
  { id: 'code-safety-secrets-integrator', division: 'code-safety', role: 'integrator', department: 'secrets' },
  { id: 'code-safety-access-integrator', division: 'code-safety', role: 'integrator', department: 'access' },
  { id: 'code-safety-lead', division: 'code-safety', role: 'lead' },
  { id: 'proving-ground-glob-match-bench-operator', division: 'proving-ground', role: 'bench-operator', specialization: 'glob-match' },
  { id: 'proving-ground-lex-states-bench-operator', division: 'proving-ground', role: 'bench-operator', specialization: 'lex-states' },
]

/**
 * @param sessionId - the session id.
 * @param fields - the facts the test cares about.
 * @returns a session's facts with nothing else logged.
 */
function facts(sessionId: string, fields: Partial<SessionFacts> = {}): SessionFacts {
  return { sessionId, certified: false, steps: 0, toolCalls: 0, ...fields }
}

describe('parseProgramSession', () => {
  it('reads the program id and the member a program session id names, decoding the file-name escape', () => {
    expect(parseProgramSession(PROGRAM)).toEqual({ programId: PROGRAM })
    expect(parseProgramSession(`${PROGRAM}-secrets`)).toEqual({ programId: PROGRAM, member: 'secrets' })
    expect(parseProgramSession(`${PROGRAM}-~0040integration`)).toEqual({ programId: PROGRAM, member: '@integration' })
    expect(parseProgramSession(`${PROGRAM}-@integration`)).toEqual({ programId: PROGRAM, member: '@integration' })
    expect(parseProgramSession('environment-0939c227-8223-4796-bcf6-1e3f83046865')).toBeUndefined()
    expect(parseProgramSession('program-short')).toBeUndefined()
  })
})

describe('attributeRun', () => {
  it('places a code-safety review\'s sessions on the seats their ids name', () => {
    const placed = attributeRun({
      path: 'data/code-safety/review',
      codeSafety: true,
      sessions: [facts(PROGRAM), facts(`${PROGRAM}-secrets`), facts(`${PROGRAM}-@integration`), facts(`${PROGRAM}-platform`)],
    }, SEATS)
    expect(placed.map(entry => entry.attribution)).toEqual([
      { kind: 'seat', seatId: 'code-safety-lead' },
      { kind: 'seat', seatId: 'code-safety-secrets-integrator' },
      { kind: 'seat', seatId: 'code-safety-lead' },
      { kind: 'unattributed', reason: 'program-member-not-seated' },
    ])
  })

  it('places no program session on a code-safety seat outside a code-safety review', () => {
    const placed = attributeRun({
      path: 'data/proving-ground/2026-09-19-csv-tools-program',
      codeSafety: false,
      sessions: [facts(PROGRAM), facts(`${PROGRAM}-stats`), facts(`${PROGRAM}-secrets`)],
    }, SEATS)
    expect(placed.every(entry => entry.attribution.kind === 'unattributed' && entry.attribution.reason === 'program-not-code-safety')).toBe(true)
  })

  it('places a bench session on the operator seat of the environment it ran, and counts an unseated environment', () => {
    const placed = attributeRun({
      path: 'data/proving-ground/fleet',
      codeSafety: false,
      sessions: [
        facts('environment-1', { environmentId: 'code:glob-match', route: 'openrouter' }),
        facts('environment-2', { environmentId: 'code:slugify', route: 'claude-code' }),
      ],
    }, SEATS)
    expect(placed.map(entry => entry.attribution)).toEqual([
      { kind: 'seat', seatId: 'proving-ground-glob-match-bench-operator' },
      { kind: 'unattributed', reason: 'environment-not-seated' },
    ])
  })

  it('places a delegated session where its delegating session is placed, and names a parent the run lacks or a loop', () => {
    const placed = attributeRun({
      path: 'data/proving-ground/handoff',
      codeSafety: false,
      sessions: [
        facts('environment-1', { environmentId: 'code:lex-states' }),
        facts('child-1', { parentSessionId: 'environment-1' }),
        facts('grandchild-1', { parentSessionId: 'child-1' }),
        facts('environment-2', { environmentId: 'code:slugify' }),
        facts('child-2', { parentSessionId: 'environment-2' }),
        facts('orphan', { parentSessionId: 'environment-not-recorded' }),
        facts('loop-a', { parentSessionId: 'loop-b' }),
        facts('loop-b', { parentSessionId: 'loop-a' }),
      ],
    }, SEATS)
    const bySession = new Map(placed.map(entry => [entry.facts.sessionId, entry.attribution]))
    expect(bySession.get('child-1')).toEqual({ kind: 'seat', seatId: 'proving-ground-lex-states-bench-operator' })
    expect(bySession.get('grandchild-1')).toEqual({ kind: 'seat', seatId: 'proving-ground-lex-states-bench-operator' })
    expect(bySession.get('child-2')).toEqual({ kind: 'unattributed', reason: 'environment-not-seated' })
    expect(bySession.get('orphan')).toEqual({ kind: 'unattributed', reason: 'parent-not-recorded' })
    expect(bySession.get('loop-a')).toEqual({ kind: 'unattributed', reason: 'parent-not-recorded' })
    expect(bySession.get('loop-b')).toEqual({ kind: 'unattributed', reason: 'parent-not-recorded' })
  })

  it('never places a session by the route it ran on: a matching route alone is no evidence', () => {
    const placed = attributeRun({
      path: 'data/proving-ground/shift',
      codeSafety: true,
      sessions: [facts('11111111-1111-4111-8111-111111111111', { route: 'claude-code' }), facts('shift-ledger')],
    }, SEATS)
    expect(placed.map(entry => entry.attribution)).toEqual([
      { kind: 'unattributed', reason: 'no-seat-evidence' },
      { kind: 'unattributed', reason: 'no-seat-evidence' },
    ])
  })
})

describe('summarizeEvidence', () => {
  it('counts sessions, the newest line and the routes per seat, sessions per route across every session, and the unattributed by reason', () => {
    const review = { path: 'data/code-safety/review', codeSafety: true, sessions: [
      facts(`${PROGRAM}-secrets`, { route: 'claude-code', lastSeenMs: Date.UTC(2026, 8, 19, 20, 0) }),
      facts(`${PROGRAM}-~0040integration`, { route: 'claude-code', lastSeenMs: Date.UTC(2026, 8, 19, 21, 0) }),
      facts(PROGRAM, { lastSeenMs: Date.UTC(2026, 8, 19, 21, 5) }),
    ] }
    const fleet = { path: 'data/proving-ground/fleet', codeSafety: false, sessions: [
      facts('environment-1', { environmentId: 'code:glob-match', route: 'openrouter', lastSeenMs: Date.UTC(2026, 8, 18) }),
      facts('environment-2', { environmentId: 'code:glob-match', route: 'claude-code', lastSeenMs: Date.UTC(2026, 8, 17) }),
      facts('environment-3', { environmentId: 'code:slugify', route: 'claude-code' }),
      facts('shift-ledger'),
    ] }
    const summary = summarizeEvidence([fleet, review].map(run => ({ path: run.path, sessions: attributeRun(run, SEATS) })))

    expect(summary.bySeat.get('code-safety-lead')).toEqual({ sessions: 2, lastSeen: '2026-09-19T21:05:00.000Z', routesSeen: ['claude-code'] })
    expect(summary.bySeat.get('code-safety-secrets-integrator')).toEqual({
      sessions: 1, lastSeen: '2026-09-19T20:00:00.000Z', routesSeen: ['claude-code'],
    })
    expect(summary.bySeat.get('proving-ground-glob-match-bench-operator')).toEqual({
      sessions: 2, lastSeen: '2026-09-18T00:00:00.000Z', routesSeen: ['claude-code', 'openrouter'],
    })
    expect(summary.bySeat.has('code-safety-secrets-javascript-typescript-reviewer')).toBe(false)
    expect(summary.evidence).toEqual({
      records: ['data/code-safety/review', 'data/proving-ground/fleet'],
      sessions: 7,
      routes: { 'claude-code': 4, openrouter: 1 },
    })
    expect(summary.unattributed).toEqual({
      sessions: 2,
      reasons: {
        'environment-not-seated': 1,
        'program-not-code-safety': 0,
        'program-member-not-seated': 0,
        'parent-not-recorded': 0,
        'no-seat-evidence': 1,
      },
    })
  })
})

describe('committed records', () => {
  it('lists the record directories that hold sessions, reads a code-safety record as a review, and refuses a missing record', () => {
    const root = mkdtempSync(join(tmpdir(), 'roster-evidence-'))
    try {
      const review = join(root, 'data/code-safety/2026-09-19-review/sessions')
      const fleet = join(root, 'data/proving-ground/2026-09-19-fleet/sessions')
      mkdirSync(review, { recursive: true })
      mkdirSync(fleet, { recursive: true })
      mkdirSync(join(root, 'data/proving-ground/2026-09-19-artefacts-only'), { recursive: true })
      writeFileSync(join(review, `${PROGRAM}-~0040integration.jsonl`), `${JSON.stringify({ type: 'session', id: `${PROGRAM}-@integration` })}\n`)
      writeFileSync(join(fleet, 'environment-1.jsonl'), [
        JSON.stringify({ type: 'session', id: 'environment-1', createdAt: 1_789_000_000_000 }),
        JSON.stringify({ type: 'environment/run', seq: 1, time: 1_789_000_000_500, data: { environmentId: 'code:glob-match' } }),
        '',
      ].join('\n'))
      writeFileSync(join(fleet, 'empty.jsonl'), '')

      expect(committedRecords(root)).toEqual(['data/code-safety/2026-09-19-review', 'data/proving-ground/2026-09-19-fleet'])
      const [reviewRun, fleetRun] = readRecordedSessions(root, committedRecords(root))
      expect(reviewRun).toMatchObject({ path: 'data/code-safety/2026-09-19-review', codeSafety: true })
      expect(reviewRun?.sessions.map(session => session.sessionId)).toEqual([`${PROGRAM}-@integration`])
      expect(fleetRun?.codeSafety).toBe(false)
      expect(fleetRun?.sessions).toEqual([facts('environment-1', { environmentId: 'code:glob-match', lastSeenMs: 1_789_000_000_500 })])
      expect(() => readRecordedSessions(root, ['data/proving-ground/2026-09-20-gone'])).toThrow(/is not a directory/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
