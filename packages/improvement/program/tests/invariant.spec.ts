/**
 * The package companion's owned relations: every ledger event follows the
 * `program/start` of the same program in the same session, a goal's status
 * moves only along the transitions the ledger admits, `merged` follows a
 * certified integration, a released program has one, and a delegated attempt
 * belongs to the department that stamped the session and advances past the
 * attempts it already ran. Seeded sessions exercise the startup scan; live
 * appends exercise the pre-publication check.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry, { InvariantError } from '@deepseek-ai/dsh-invariants'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { ProgramId } from '@deepseek-ai/dsh-program'
import type { FrozenProgramSpec } from '@deepseek-ai/dsh-program'
import * as ProgramInvariantCompanion from '@deepseek-ai/dsh-program/invariant'

const PROGRAM = ProgramId('program-abc')

/** A minimal frozen spec; the companion never reads inside it. */
const SPEC: FrozenProgramSpec = {
  objective: 'ship',
  baseRevision: 'base',
  goals: [],
  integration: { checks: [], gates: [] },
  implementer: { kind: 'route' },
}

/** The opening record every ledger relation is measured against. */
const START: Omit<SessionEvent, 'seq' | 'time'> = {
  type: 'program/start',
  data: { programId: PROGRAM, specSha256: 'abc', spec: SPEC, baseRevision: 'base', implementer: SPEC.implementer },
}

/** Mount the store plus the companion, optionally over an already-seeded session. */
async function setup(seed?: readonly Omit<SessionEvent, 'seq' | 'time'>[]): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  if (seed !== undefined) {
    ctx.sessions.create(SessionId('program-invariant-seeded'), {
      seed: seed.map((event, index) => ({ ...event, seq: index, time: 1_000 + index }) as SessionEvent),
    })
  }
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(ProgramInvariantCompanion)
  return ctx
}

/** A live program session whose ledger is already open. */
async function openSession(id: string): Promise<Session> {
  const ctx = await setup()
  const session = ctx.sessions.create(SessionId(id))
  session.append('program/start', START.data as never)
  return session
}

describe('the ledger opens before it records', () => {
  it('accepts a stored ledger whose records all follow its own start', async () => {
    await expect(setup([
      START,
      { type: 'program/goal', data: { programId: PROGRAM, key: 'api', status: 'pending' } },
      { type: 'program/goal', data: { programId: PROGRAM, key: 'api', status: 'running' } },
    ])).resolves.toBeDefined()
  })

  it('rejects a goal record for a program this session never started', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('program-unopened'))
    expect(() => {
      session.append('program/goal', { programId: PROGRAM, key: 'api', status: 'pending' })
    }).toThrow(expect.objectContaining<Partial<InvariantError>>({
      code: 'INVARIANT',
      packageName: '@deepseek-ai/dsh-program',
    }))
    expect(() => {
      session.append('program/goal', { programId: PROGRAM, key: 'api', status: 'pending' })
    }).toThrow('records program/goal for program "program-abc", which this session never started')
    expect(session.seq).toBe(0)
  })

  it('rejects an integration, a resume, and an end for another program', async () => {
    const session = await openSession('program-other-records')
    const other = ProgramId('program-other')
    expect(() => {
      session.append('program/integration', { programId: other, status: 'running' })
    }).toThrow('records program/integration for program "program-other", which this session never started')
    expect(() => {
      session.append('program/resume', {
        programId: other,
        statuses: { pending: 0, running: 0, blocked: 0, certified: 0, failed: 0, merged: 0, abandoned: 0 },
      })
    }).toThrow('records program/resume for program "program-other", which this session never started')
    expect(() => {
      session.append('program/end', { programId: other, outcome: 'failed' })
    }).toThrow('records program/end for program "program-other", which this session never started')
  })

  it('leaves every other durable event to its own owner', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('program-invariant-other'))
    expect(() => {
      session.append('turn/start', { turn: 1 })
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      session.append('program/member', { programId: PROGRAM, key: 'api' })
    }).not.toThrow()
    expect(session.seq).toBe(3)
  })
})

describe('goal status transitions', () => {
  it('rejects a first record that is not pending', async () => {
    const session = await openSession('program-first-status')
    expect(() => {
      session.append('program/goal', { programId: PROGRAM, key: 'api', status: 'certified' })
    }).toThrow('records goal "api" as certified, which this program never declared pending')
  })

  it('rejects a move the ledger does not admit', async () => {
    const session = await openSession('program-illegal-move')
    session.append('program/goal', { programId: PROGRAM, key: 'api', status: 'pending' })
    expect(() => {
      session.append('program/goal', { programId: PROGRAM, key: 'api', status: 'certified' })
    }).toThrow('moves goal "api" from pending to certified, which the ledger does not admit')
    session.append('program/goal', { programId: PROGRAM, key: 'api', status: 'running' })
    session.append('program/goal', { programId: PROGRAM, key: 'api', status: 'failed' })
    expect(() => {
      session.append('program/goal', { programId: PROGRAM, key: 'api', status: 'running' })
    }).toThrow('moves goal "api" from failed to running, which the ledger does not admit')
  })

  it('tracks each key independently', async () => {
    const session = await openSession('program-per-key')
    session.append('program/goal', { programId: PROGRAM, key: 'api', status: 'pending' })
    session.append('program/goal', { programId: PROGRAM, key: 'docs', status: 'pending' })
    session.append('program/goal', { programId: PROGRAM, key: 'api', status: 'running' })
    expect(() => {
      session.append('program/goal', { programId: PROGRAM, key: 'docs', status: 'certified' })
    }).toThrow('moves goal "docs" from pending to certified, which the ledger does not admit')
  })
})

describe('merging and releasing follow a certified integration', () => {
  it('rejects merged before the integration certified', async () => {
    const session = await openSession('program-early-merge')
    session.append('program/goal', { programId: PROGRAM, key: 'api', status: 'pending' })
    session.append('program/goal', { programId: PROGRAM, key: 'api', status: 'running' })
    session.append('program/goal', { programId: PROGRAM, key: 'api', status: 'certified' })
    session.append('program/integration', { programId: PROGRAM, status: 'running' })
    expect(() => {
      session.append('program/goal', { programId: PROGRAM, key: 'api', status: 'merged' })
    }).toThrow('records goal "api" as merged before a certified integration')
    session.append('program/integration', { programId: PROGRAM, status: 'certified', mergedRevision: 'head' })
    expect(() => {
      session.append('program/goal', { programId: PROGRAM, key: 'api', status: 'merged' })
    }).not.toThrow()
  })

  it('rejects an integration move the ledger does not admit', async () => {
    const session = await openSession('program-integration-move')
    expect(() => {
      session.append('program/integration', { programId: PROGRAM, status: 'certified' })
    }).toThrow('moves the integration from unrecorded to certified, which the ledger does not admit')
    // An integration whose worktree could not be created enters at failed, and
    // a failed one is retried; a certified one is final.
    session.append('program/integration', { programId: PROGRAM, status: 'failed', reason: 'no worktree' })
    session.append('program/integration', { programId: PROGRAM, status: 'running' })
    // One `running` record stands for one integration, which is what makes a
    // later pass take that record over instead of starting a second one.
    expect(() => {
      session.append('program/integration', { programId: PROGRAM, status: 'running' })
    }).toThrow('moves the integration from running to running, which the ledger does not admit')
    session.append('program/integration', { programId: PROGRAM, status: 'certified', mergedRevision: 'head' })
    expect(() => {
      session.append('program/integration', { programId: PROGRAM, status: 'running' })
    }).toThrow('moves the integration from certified to running, which the ledger does not admit')
  })

  it('rejects a release without a certified integration and admits a failure without one', async () => {
    const session = await openSession('program-release')
    expect(() => {
      session.append('program/end', { programId: PROGRAM, outcome: 'released', mergedRevision: 'head' })
    }).toThrow('releases program "program-abc" without a certified integration')
    expect(() => {
      session.append('program/end', { programId: PROGRAM, outcome: 'failed' })
    }).not.toThrow()
  })
})

describe('delegated attempts belong to their department and advance', () => {
  /** One delegated attempt, as the department session records it. */
  function attempt(goalKey: string, number: number): Record<string, unknown> {
    return {
      goalKey,
      attempt: number,
      provider: 'spawn',
      runId: SessionId(`child-${String(number)}`),
      stopReason: 'completed',
    }
  }

  it('accepts a stored department whose attempts follow its stamp in order', async () => {
    await expect(setup([
      { type: 'program/member', data: { programId: PROGRAM, key: 'api' } },
      { type: 'program/delegation', data: attempt('api', 1) },
      { type: 'program/delegation', data: attempt('api', 2) },
    ])).resolves.toBeDefined()
  })

  it('rejects an attempt in a session that is not that goal\'s department', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('program-unstamped'))
    expect(() => {
      session.append('program/delegation', attempt('api', 1) as never)
    }).toThrow('delegates goal "api", which this session is not the department for')
    session.append('program/member', { programId: PROGRAM, key: 'docs' })
    expect(() => {
      session.append('program/delegation', attempt('api', 1) as never)
    }).toThrow(expect.objectContaining<Partial<InvariantError>>({
      code: 'INVARIANT',
      packageName: '@deepseek-ai/dsh-program',
    }))
    expect(session.seq).toBe(1)
  })

  it('rejects an attempt that repeats or precedes one the session already ran', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('program-repeat-attempt'))
    session.append('program/member', { programId: PROGRAM, key: 'api' })
    session.append('program/delegation', attempt('api', 1) as never)
    session.append('program/delegation', attempt('api', 3) as never)
    expect(() => {
      session.append('program/delegation', attempt('api', 3) as never)
    }).toThrow('records delegation attempt 3 of goal "api" after attempt 3, which this session already ran')
    expect(() => {
      session.append('program/delegation', attempt('api', 2) as never)
    }).toThrow('records delegation attempt 2 of goal "api" after attempt 3, which this session already ran')
    expect(() => {
      session.append('program/delegation', attempt('api', 4) as never)
    }).not.toThrow()
  })
})
