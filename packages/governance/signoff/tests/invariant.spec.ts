/**
 * The package companion's owned relation over signed transitions: usable
 * fields, and one artefact per transition per session. Seeded sessions exercise
 * the startup scan and live appends the pre-publication check.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry, { InvariantError } from '@deepseek-ai/dsh-invariants'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import * as SignoffInvariantCompanion from '@deepseek-ai/dsh-signoff/invariant'

const PACKAGE_NAME = '@deepseek-ai/dsh-signoff'
const ARTEFACT = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)

/** One durable payload as the log carries it, before the typed map narrows it. */
type Raw = Record<string, unknown>

/** Append one durable payload the typed session API would not accept verbatim. */
function append(session: Session, type: string, data: Raw): void {
  ;(session.append as unknown as (eventType: string, eventData: unknown) => unknown)(type, data)
}

/** One complete record with the field under test overridable. */
function record(overrides: Raw = {}): Raw {
  return {
    transition: 'spec-freeze',
    principal: { kind: 'human', id: 'product-owner' },
    artefactSha256: ARTEFACT,
    evidence: [{ kind: 'spec', ref: 'the frozen spec' }],
    ...overrides,
  }
}

/** Mount the store plus the companion, optionally over an already-seeded session. */
async function setup(seed?: readonly SessionEvent[]): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  if (seed !== undefined) ctx.sessions.create(SessionId('signoff-seeded'), { seed })
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(SignoffInvariantCompanion)
  return ctx
}

/** A seeded log of the given durable payloads, in order. */
function seeded(...events: readonly [string, Raw][]): SessionEvent[] {
  return events.map(([type, data], seq) => ({ type, seq, time: 1_000 + seq, data } as unknown as SessionEvent))
}

describe('signoff record invariants', () => {
  it('accepts a signed session and leaves every other event alone', async () => {
    await expect(setup(seeded(
      ['signoff/recorded', record()],
      ['signoff/recorded', record({ transition: 'release', artefactSha256: OTHER })],
      ['signoff/recorded', record({ principal: { kind: 'human', id: 'lead', displayName: 'Lead' } })],
    ))).resolves.toBeDefined()

    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('signoff-other'))
    expect(() => {
      session.append('turn/start', { turn: 1 })
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    }).not.toThrow()
    expect(session.seq).toBe(2)
  })

  it('rejects a record whose fields cannot address anything', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('signoff-malformed'))
    const refuse = (overrides: Raw): void => {
      expect(() => {
        append(session, 'signoff/recorded', record(overrides))
      }).toThrow(expect.objectContaining<Partial<InvariantError>>({ code: 'INVARIANT', packageName: PACKAGE_NAME }))
    }
    refuse({ transition: 'promotion' })
    refuse({ artefactSha256: 'A'.repeat(64) })
    refuse({ principal: { kind: 'policy', id: 'a-rule' } })
    refuse({ principal: { kind: 'human', id: '' } })
    refuse({ principal: { kind: 'human', id: 'x', displayName: '' } })
    refuse({ evidence: [{ kind: '', ref: 'x' }] })
    refuse({ evidence: [{ kind: 'run', ref: '' }] })
    expect(session.seq).toBe(0)
  })

  it('rejects a second signature of one transition over another artefact', async () => {
    const ctx = await setup(seeded(['signoff/recorded', record()]))
    const session = ctx.sessions.get(SessionId('signoff-seeded')) as Session
    expect(() => {
      append(session, 'signoff/recorded', record({ artefactSha256: OTHER }))
    }).toThrow(`signs "spec-freeze" on artefact ${OTHER}, which this session already signed on ${ARTEFACT}`)
    expect(() => {
      append(session, 'signoff/recorded', record({ transition: 'release', artefactSha256: OTHER }))
    }).not.toThrow()

    await expect(setup(seeded(
      ['signoff/recorded', record()],
      ['signoff/recorded', record({ artefactSha256: OTHER })],
    ))).rejects.toThrow(InvariantError)
  })
})
