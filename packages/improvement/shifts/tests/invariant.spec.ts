/**
 * The package companion's owned relations over the shift ledger: a record that
 * follows the `shift/start` of its own shift, one record per cell, and a
 * `shift/start` whose plan freezes to the digest it declares. Seeded sessions
 * exercise the startup scan and live appends the pre-publication check.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry, { InvariantError } from '@deepseek-ai/dsh-invariants'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { shiftDigest, shiftId } from '@deepseek-ai/dsh-shifts'
import * as ShiftInvariantCompanion from '@deepseek-ai/dsh-shifts/invariant'
import { cell, plan, ROUND_TRIP, UNSATISFIABLE } from './log.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-shifts'
const PLAN = plan()
const DIGEST = shiftDigest(PLAN)
const ID = shiftId(DIGEST, 1_000)

/** One durable payload as the log carries it, before the typed map narrows it. */
type Raw = Record<string, unknown>

/** Append one durable payload the typed session API would not accept verbatim. */
function append(session: Session, type: string, data: Raw): void {
  ;(session.append as unknown as (eventType: string, eventData: unknown) => unknown)(type, data)
}

/** The opening record of the specs' shift, with the fields under test overridable. */
function start(overrides: Raw = {}): Raw {
  return { shiftId: ID, digest: DIGEST, plan: PLAN, scheduledAt: 1_000, ...overrides }
}

/** One settled cell record. */
function record(environment: string, overrides: Raw = {}): Raw {
  return { shiftId: ID, cell: cell(environment), outcome: { kind: 'reported', certified: true }, ...overrides }
}

/** Mount the store plus the companion, optionally over an already-seeded session. */
async function setup(seed?: readonly SessionEvent[]): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  if (seed !== undefined) ctx.sessions.create(SessionId('shifts-seeded'), { seed })
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(ShiftInvariantCompanion)
  return ctx
}

/** A seeded log of the given durable payloads, in order. */
function seeded(...events: readonly [string, Raw][]): SessionEvent[] {
  return events.map(([type, data], seq) => ({ type, seq, time: 1_000 + seq, data } as unknown as SessionEvent))
}

describe('shift ledger invariants', () => {
  it('accepts a complete ledger and leaves every other event alone', async () => {
    await expect(setup(seeded(
      ['shift/start', start()],
      ['shift/cell', record(ROUND_TRIP)],
      ['shift/cell', record(UNSATISFIABLE)],
      ['shift/resume', { shiftId: ID, done: [], pending: [] }],
      ['shift/end', { shiftId: ID, outcome: 'completed', spend: 3, cells: { reported: 2, error: 0, interrupted: 0 } }],
    ))).resolves.toBeDefined()

    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('shifts-other'))
    expect(() => {
      session.append('turn/start', { turn: 1 })
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    }).not.toThrow()
    expect(session.seq).toBe(2)
  })

  it('rejects a record that no `shift/start` of this session opened', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('shifts-unopened'))
    expect(() => {
      append(session, 'shift/cell', record(ROUND_TRIP))
    }).toThrow(expect.objectContaining<Partial<InvariantError>>({ code: 'INVARIANT', packageName: PACKAGE_NAME }))
    expect(session.seq).toBe(0)

    await expect(setup(seeded(['shift/end', { shiftId: ID, outcome: 'completed', spend: 0, cells: { reported: 0, error: 0, interrupted: 0 } }])))
      .rejects.toThrow(InvariantError)
    await expect(setup(seeded(['shift/resume', { shiftId: ID, done: [], pending: [] }])))
      .rejects.toThrow(InvariantError)
  })

  it('rejects a record naming another shift than the one this session started', async () => {
    const ctx = await setup(seeded(['shift/start', start()]))
    const session = ctx.sessions.get(SessionId('shifts-seeded')) as Session
    expect(() => {
      append(session, 'shift/cell', record(ROUND_TRIP, { shiftId: shiftId(DIGEST, 2_000) }))
    }).toThrow(InvariantError)
  })

  it('rejects a second record for one cell of one shift', async () => {
    const ctx = await setup(seeded(['shift/start', start()], ['shift/cell', record(ROUND_TRIP)]))
    const session = ctx.sessions.get(SessionId('shifts-seeded')) as Session
    expect(() => {
      append(session, 'shift/cell', record(ROUND_TRIP, { outcome: { kind: 'interrupted' } }))
    }).toThrow(InvariantError)
    expect(() => {
      append(session, 'shift/cell', record(UNSATISFIABLE))
    }).not.toThrow()
  })

  it('rejects a `shift/start` whose plan freezes to another digest', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('shifts-unfrozen'))
    expect(() => {
      append(session, 'shift/start', start({ digest: 'a'.repeat(64) }))
    }).toThrow(expect.objectContaining<Partial<InvariantError>>({ code: 'INVARIANT', packageName: PACKAGE_NAME }))
    expect(() => {
      append(session, 'shift/start', start({ plan: { ...PLAN, repetitions: 9 } }))
    }).toThrow(InvariantError)
    expect(session.seq).toBe(0)
  })
})
