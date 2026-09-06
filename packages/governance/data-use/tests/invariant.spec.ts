/**
 * The package companion's owned relation over pinned terms: usable fields, and
 * purposes that only ever narrow. Seeded sessions exercise the startup scan and
 * live appends the pre-publication check.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry, { InvariantError } from '@deepseek-ai/dsh-invariants'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import * as DataUseInvariantCompanion from '@deepseek-ai/dsh-data-use/invariant'

const PACKAGE_NAME = '@deepseek-ai/dsh-data-use'

/** One durable payload as the log carries it, before the typed map narrows it. */
type Raw = Record<string, unknown>

/** Append one durable payload the typed session API would not accept verbatim. */
function append(session: Session, type: string, data: Raw): void {
  ;(session.append as unknown as (eventType: string, eventData: unknown) => unknown)(type, data)
}

/** One complete set of terms with the field under test overridable. */
function terms(overrides: Raw = {}): Raw {
  return {
    clientId: 'acme',
    agreementId: 'msa-2026-1',
    purposes: ['delivery', 'evaluation'],
    residency: 'eu-west',
    retentionDays: 90,
    redactionProfile: 'client-v3',
    ...overrides,
  }
}

/** Mount the store plus the companion, optionally over an already-seeded session. */
async function setup(seed?: readonly SessionEvent[]): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  if (seed !== undefined) ctx.sessions.create(SessionId('data-use-seeded'), { seed })
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(DataUseInvariantCompanion)
  return ctx
}

/** A seeded log of the given durable payloads, in order. */
function seeded(...events: readonly [string, Raw][]): SessionEvent[] {
  return events.map(([type, data], seq) => ({ type, seq, time: 1_000 + seq, data } as unknown as SessionEvent))
}

describe('data-use terms invariants', () => {
  it('accepts terms that only narrow and leaves every other event alone', async () => {
    await expect(setup(seeded(
      ['dataUse/terms', terms()],
      ['dataUse/terms', terms({ purposes: ['delivery'], retentionDays: 30 })],
    ))).resolves.toBeDefined()

    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('data-use-other'))
    expect(() => {
      session.append('turn/start', { turn: 1 })
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    }).not.toThrow()
    expect(session.seq).toBe(2)
  })

  it('rejects terms whose fields state nothing usable', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('data-use-malformed'))
    const refuse = (overrides: Raw): void => {
      expect(() => {
        append(session, 'dataUse/terms', terms(overrides))
      }).toThrow(expect.objectContaining<Partial<InvariantError>>({ code: 'INVARIANT', packageName: PACKAGE_NAME }))
    }
    refuse({ clientId: '' })
    refuse({ agreementId: '' })
    refuse({ residency: '' })
    refuse({ redactionProfile: '' })
    refuse({ purposes: [] })
    refuse({ purposes: ['curation'] })
    refuse({ purposes: ['delivery', 'delivery'] })
    refuse({ retentionDays: 0 })
    refuse({ retentionDays: 1.5 })
    expect(session.seq).toBe(0)
  })

  it('rejects a second record that widens the purposes the session carries', async () => {
    const ctx = await setup(seeded(['dataUse/terms', terms({ purposes: ['delivery'] })]))
    const session = ctx.sessions.get(SessionId('data-use-seeded')) as Session
    expect(() => {
      append(session, 'dataUse/terms', terms({ purposes: ['delivery', 'training'] }))
    }).toThrow("widens this session's purposes delivery with training")
    expect(() => {
      append(session, 'dataUse/terms', terms({ purposes: ['delivery'], residency: 'us-east' }))
    }).not.toThrow()

    await expect(setup(seeded(
      ['dataUse/terms', terms({ purposes: ['delivery'] })],
      ['dataUse/terms', terms({ purposes: ['training'] })],
    ))).rejects.toThrow(InvariantError)
  })
})
