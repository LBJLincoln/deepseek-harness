/**
 * The package companion's owned relation: this package owns the `experiment-`
 * stamp group namespace, so a stamp claiming it must name a frozen digest and
 * an arm role. Seeded sessions exercise the startup scan and live appends the
 * pre-publication check.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry, { InvariantError } from '@deepseek-ai/dsh-invariants'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { EXPERIMENT_GROUP_PREFIX, experimentGroup } from '@deepseek-ai/dsh-experiments'
import * as ExperimentInvariantCompanion from '@deepseek-ai/dsh-experiments/invariant'

const HEX = 'c'.repeat(64)
const DIGEST = 'd'.repeat(64)
const PACKAGE_NAME = '@deepseek-ai/dsh-experiments'

/** One durable payload as the log carries it, before the decoder narrows it. */
type Raw = Record<string, unknown>

/** The run stamp a cell writes, with the fields under test overridable. */
function stamp(overrides: Raw = {}): Raw {
  return {
    kind: 'environment/run',
    version: 1,
    environmentId: 'smoke:round-trip',
    environmentKind: 'smoke',
    heldOut: false,
    promptSha256: HEX,
    checksSha256: HEX,
    contentSha256: HEX,
    repetition: 0,
    model: { provider: 'cli-mock', model: 'cli-mock' },
    isolation: 'none',
    ...overrides,
  }
}

/** Append one durable payload the typed session API would not accept verbatim. */
function append(session: Session, type: string, data: Raw): void {
  ;(session.append as unknown as (eventType: string, eventData: unknown) => unknown)(type, data)
}

/** Mount the store plus the companion, optionally over an already-seeded session. */
async function setup(seed?: readonly SessionEvent[]): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  if (seed !== undefined) ctx.sessions.create(SessionId('experiments-seeded'), { seed })
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(ExperimentInvariantCompanion)
  return ctx
}

/** One seeded stamp event at seq zero. */
function seededStamp(overrides: Raw = {}): SessionEvent[] {
  return [{ type: 'environment/run', seq: 0, time: 1_000, data: stamp(overrides) } as unknown as SessionEvent]
}

describe('experiment group invariants', () => {
  it('accepts a stamp naming an arm of a frozen plan, and one outside the namespace', async () => {
    await expect(setup(seededStamp({ group: experimentGroup(DIGEST, 'candidate') }))).resolves.toBeDefined()
    await expect(setup(seededStamp({ group: 'fleet-batch-1' }))).resolves.toBeDefined()
    await expect(setup(seededStamp())).resolves.toBeDefined()
  })

  it('rejects a live stamp that claims the namespace without a digest and an arm role', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('experiments-lookalike'))
    expect(() => {
      append(session, 'environment/run', stamp({ group: `${EXPERIMENT_GROUP_PREFIX}mine` }))
    }).toThrow(expect.objectContaining<Partial<InvariantError>>({ code: 'INVARIANT', packageName: PACKAGE_NAME }))
    expect(session.seq).toBe(0)
  })

  it('rejects a seeded stamp that claims the namespace with the wrong role', async () => {
    await expect(setup(seededStamp({ group: `${EXPERIMENT_GROUP_PREFIX}${DIGEST}-control` }))).rejects.toThrow(InvariantError)
  })

  it('leaves a malformed stamp to the companion that owns the payload', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('experiments-malformed'))
    expect(() => {
      append(session, 'environment/run', stamp({ isolation: 'imagined', group: `${EXPERIMENT_GROUP_PREFIX}mine` }))
    }).not.toThrow()
    expect(session.seq).toBe(1)
  })

  it('leaves every event that stamps no environment run alone', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('experiments-other'))
    expect(() => {
      session.append('turn/start', { turn: 1 })
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    }).not.toThrow()
    expect(session.seq).toBe(2)
  })
})
