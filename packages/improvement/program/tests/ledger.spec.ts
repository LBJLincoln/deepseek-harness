/**
 * Reading a program back out of persisted logs: the program session's own
 * ledger, what a department's log states about itself, and the member stamps a
 * program ceiling is folded from.
 */

import { describe, expect, it } from 'vitest'
import { GoalId } from '@deepseek-ai/dsh-goal'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import {
  countStatuses,
  foldDepartmentLog,
  foldProgramLedger,
  memberSpend,
  programSpend,
  ProgramId,
} from '@deepseek-ai/dsh-program'
import type { FrozenProgramSpec, ScannedSession } from '@deepseek-ai/dsh-program'
import type { CheckId, StandardId } from '@deepseek-ai/dsh-verification/types'

const PROGRAM = ProgramId('program-abc')

/** A minimal frozen spec; the ledger fold never reads inside it. */
const SPEC: FrozenProgramSpec = {
  objective: 'ship',
  baseRevision: 'base',
  goals: [],
  integration: { checks: [], gates: [] },
  implementer: { kind: 'route' },
}

/** One stored session built from a bare event list. */
function scanned(id: string, events: readonly Omit<SessionEvent, 'seq' | 'time'>[]): ScannedSession {
  const meta: SessionHeader = {
    version: SESSION_FORMAT_VERSION,
    id: id as SessionId,
    createdAt: 1_000,
    delegationDepth: 0,
  }
  return {
    meta,
    events: events.map((event, index) => ({ ...event, seq: index, time: 1_000 + index }) as SessionEvent),
  }
}

describe('foldProgramLedger', () => {
  it('reads nothing from a session that never started a program', () => {
    expect(foldProgramLedger(scanned('other', [{ type: 'turn/start', data: { turn: 1 } }]))).toBeUndefined()
  })

  it('keeps the latest record per goal key, the latest integration, and the closing record', () => {
    const ledger = foldProgramLedger(scanned('program-abc', [
      { type: 'program/start', data: { programId: PROGRAM, specSha256: 'abc', spec: SPEC, baseRevision: 'base', implementer: SPEC.implementer } },
      { type: 'program/goal', data: { programId: PROGRAM, key: 'api', status: 'pending' } },
      { type: 'program/goal', data: { programId: PROGRAM, key: 'docs', status: 'pending' } },
      { type: 'program/goal', data: { programId: PROGRAM, key: 'api', status: 'running' } },
      { type: 'program/integration', data: { programId: PROGRAM, status: 'running' } },
      { type: 'program/integration', data: { programId: PROGRAM, status: 'certified', mergedRevision: 'head' } },
      { type: 'program/resume', data: { programId: PROGRAM, statuses: countStatuses([]) } },
      { type: 'program/end', data: { programId: PROGRAM, outcome: 'released', mergedRevision: 'head' } },
    ]))
    expect(ledger?.sessionId).toBe('program-abc')
    expect([...ledger?.goals.entries() ?? []].map(([key, record]) => [key, record.status]))
      .toEqual([['api', 'running'], ['docs', 'pending']])
    expect(ledger?.integration).toMatchObject({ status: 'certified', mergedRevision: 'head' })
    expect(ledger?.end).toMatchObject({ outcome: 'released' })
  })

  it('leaves the integration and the closing record absent while a program runs', () => {
    const ledger = foldProgramLedger(scanned('program-abc', [
      { type: 'program/start', data: { programId: PROGRAM, specSha256: 'abc', spec: SPEC, baseRevision: 'base', implementer: SPEC.implementer } },
    ]))
    expect(ledger?.integration).toBeUndefined()
    expect(ledger?.end).toBeUndefined()
  })
})

describe('foldDepartmentLog', () => {
  it('reports no certificate, no phase, and no delegated attempt for a session that never took a goal', () => {
    expect(foldDepartmentLog([])).toEqual({ certified: false, delegated: 0 })
  })

  it('reports the highest attempt the delegation records carry, whatever order they are in', () => {
    const events = scanned('department', [
      { type: 'program/member', data: { programId: PROGRAM, key: 'api' } },
      { type: 'program/delegation', data: { goalKey: 'api', attempt: 2, provider: 'spawn', runId: 'child-2' as SessionId, stopReason: 'completed' } },
      { type: 'program/delegation', data: { goalKey: 'api', attempt: 1, provider: 'spawn', runId: 'child-1' as SessionId, stopReason: 'error' } },
    ]).events
    expect(foldDepartmentLog(events).delegated).toBe(2)
  })

  it('reports the goal phase, its blocking code, and the certificate the log carries', () => {
    const goalId = GoalId('goal-1')
    const events = scanned('department', [
      {
        type: 'goal/change',
        data: {
          kind: 'goal/change',
          version: 1,
          operation: 'create',
          goal: { id: goalId, revision: 1, objective: 'deliver', phase: 'active', maxGoalRounds: 4 },
          roundsStarted: 0,
          createdAt: 1_000,
          updatedAt: 1_000,
        },
      },
      {
        type: 'goal/change',
        data: {
          kind: 'goal/change',
          version: 1,
          operation: 'block',
          goal: {
            id: goalId,
            revision: 2,
            objective: 'deliver',
            phase: 'blocked',
            maxGoalRounds: 4,
            blockedReason: { code: 'budget-exhausted', message: 'out of budget' },
          },
          roundsStarted: 0,
          createdAt: 1_000,
          updatedAt: 1_001,
        },
      },
      {
        type: 'verification/certificate',
        data: {
          kind: 'verification/certificate',
          version: 1,
          certificate: {
            standard: { id: 'standard-1' as StandardId, revision: 1 },
            goalId,
            isolation: 'none',
            executor: 'runner',
            results: [{ checkId: 'api-builds' as CheckId, status: 'pass', evidence: 'exit 0' }],
            recordedAt: 1_002,
          },
        },
      },
    ]).events
    expect(foldDepartmentLog(events)).toEqual({ certified: true, delegated: 0, phase: 'blocked', blockedCode: 'budget-exhausted' })
  })
})

describe('member stamps', () => {
  it('reads the first stamp a session carries, and nothing from an unstamped one', () => {
    expect(memberSpend(scanned('unstamped', [{ type: 'turn/start', data: { turn: 1 } }]), 5)).toBeUndefined()
    expect(memberSpend(scanned('department', [
      { type: 'program/member', data: { programId: PROGRAM, key: 'api' } },
    ]), 7)).toEqual({ programId: PROGRAM, key: 'api', sessionId: 'department', totalTokens: 7 })
  })

  it('sums only the members of the program being asked about', () => {
    const members = [
      { programId: PROGRAM, key: 'api', sessionId: 'a' as SessionId, totalTokens: 4 },
      { programId: PROGRAM, key: 'docs', sessionId: 'b' as SessionId, totalTokens: 6 },
      { programId: ProgramId('program-other'), key: 'api', sessionId: 'c' as SessionId, totalTokens: 100 },
    ]
    expect(programSpend(members, PROGRAM)).toBe(10)
    expect(programSpend([], PROGRAM)).toBe(0)
  })
})

describe('countStatuses', () => {
  it('counts every status, zero where no goal holds it', () => {
    expect(countStatuses(['pending', 'running', 'running', 'merged'])).toEqual({
      pending: 1,
      running: 2,
      blocked: 0,
      certified: 0,
      failed: 0,
      merged: 1,
      abandoned: 0,
    })
  })
})
