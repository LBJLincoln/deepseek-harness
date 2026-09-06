/**
 * The data-use service over the real session store and agent registry: what a
 * session start pins, what a later pin may narrow, what it may never widen, and
 * which configured or pinned fields are refused before anything is appended.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { agentEvents, Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import DataUseService, {
  DATA_USE_PURPOSES,
  DataUseError,
  termsOf,
  widenedPurposes,
} from '@deepseek-ai/dsh-data-use'
import type { Config, DataUseTerms } from '@deepseek-ai/dsh-data-use'

/** The deployment's default terms every case starts from. */
const DEFAULTS: Config = {
  clientId: 'acme',
  agreementId: 'msa-2026-1',
  purposes: ['delivery', 'evaluation'],
  residency: 'eu-west',
  retentionDays: 90,
  redactionProfile: 'client-v3',
}

/** Build a registry-compatible agent around one concrete session. */
function stubAgent(session: Session): Agent {
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  return {
    id: session.id,
    options: {},
    session,
    inbox,
    ctx: new Context(),
    status: 'idle',
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject(input) { inbox.append('next-step', input) },
    cancel: () => {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

/** Mount the store, the registry, and the service over one live agent. */
async function harness(config: Partial<Config> = {}): Promise<{ ctx: Context; agent: Agent; session: Session }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(DataUseService, { ...DEFAULTS, ...config })
  const session = Session.create(SessionId(`data-use-${Math.random()}`))
  const agent = stubAgent(session)
  ctx.agents.register(agent)
  return { ctx, agent, session }
}

/** Dispatch the real session-start event the plugin pins on. */
function start(ctx: Context, agent: Agent): void {
  agentEvents(ctx, agent).emit('agent/session-start', { source: 'startup' })
}

/** One complete set of terms with the field under test overridable. */
function terms(overrides: Partial<DataUseTerms> = {}): DataUseTerms {
  return { ...DEFAULTS, ...overrides }
}

describe('pinning terms at session start', () => {
  it('records the configured defaults on a session that carries none', async () => {
    const { ctx, agent, session } = await harness()
    start(ctx, agent)
    expect(session.events.map(event => event.type)).toEqual(['dataUse/terms'])
    expect(session.events[0]?.data).toEqual(DEFAULTS)
    expect(termsOf(session.events)).toEqual(DEFAULTS)
    expect(ctx.dataUse.defaultTerms).toEqual(DEFAULTS)
  })

  it('leaves a session that already carries terms alone', async () => {
    const { ctx, agent, session } = await harness()
    ctx.dataUse.pin(agent, terms({ purposes: ['delivery'] }))
    start(ctx, agent)
    expect(session.events).toHaveLength(1)
    expect(termsOf(session.events)?.purposes).toEqual(['delivery'])
  })

  it('answers no terms for a log that carries none', () => {
    expect(termsOf([])).toBeUndefined()
  })
})

describe('pinning narrower terms', () => {
  it('records a pin that drops a purpose and answers the record it appended', async () => {
    const { ctx, agent, session } = await harness()
    start(ctx, agent)
    const narrowed = ctx.dataUse.pin(agent, terms({ purposes: ['delivery'], retentionDays: 30 }))
    expect(narrowed.purposes).toEqual(['delivery'])
    expect(session.events.at(-1)?.data).toEqual(narrowed)
    expect(termsOf(session.events)?.retentionDays).toBe(30)
  })

  it('records a pin on a session that carries no terms at all', async () => {
    const { ctx, agent, session } = await harness()
    ctx.dataUse.pin(agent, terms({ purposes: ['training'] }))
    expect(termsOf(session.events)?.purposes).toEqual(['training'])
  })

  it('refuses a pin that admits a purpose the session does not carry', async () => {
    const { ctx, agent, session } = await harness({ purposes: ['delivery'] })
    start(ctx, agent)
    const before = session.seq
    expect(() => ctx.dataUse.pin(agent, terms({ purposes: ['delivery', 'training'] })))
      .toThrow('this session is pinned to purposes delivery, which the pin widens with training')
    expect(() => ctx.dataUse.pin(agent, terms({ purposes: ['training'] })))
      .toThrow(expect.objectContaining<Partial<DataUseError>>({ code: 'DATA_USE_TERMS_PINNED' }))
    expect(session.seq).toBe(before)
  })

  it('names every purpose one pin adds', () => {
    const standing = terms({ purposes: ['delivery'] })
    expect(widenedPurposes(standing, terms({ purposes: ['delivery'] }))).toEqual([])
    expect(widenedPurposes(standing, terms({ purposes: ['training', 'evaluation'] })))
      .toEqual(['training', 'evaluation'])
  })
})

describe('refusing unusable terms', () => {
  it('refuses configured terms that state no client, agreement, residency, profile, or purpose', async () => {
    for (const [field, value] of [
      ['clientId', ''],
      ['agreementId', ''],
      ['residency', ''],
      ['redactionProfile', ''],
    ] as const) {
      await expect(harness({ [field]: value })).rejects.toThrow(`${field} is empty, so the terms state no ${field}`)
    }
    await expect(harness({ purposes: [] })).rejects.toThrow('purposes is empty, so the terms admit nothing at all')
    await expect(harness({ purposes: ['delivery', 'delivery'] })).rejects.toThrow('purpose "delivery" is listed twice')
    await expect(harness({ retentionDays: 1.5 })).rejects.toThrow('expected number multiple of 1')
    await expect(harness({ clientId: '' })).rejects.toThrow(
      expect.objectContaining<Partial<DataUseError>>({ code: 'DATA_USE_INVALID_CONFIG' }),
    )
  })

  it('refuses a pin whose purposes are outside the vocabulary', async () => {
    const { ctx, agent } = await harness()
    expect(() => ctx.dataUse.pin(agent, terms({ purposes: ['delivery', 'curation' as 'training'] })))
      .toThrow('purpose "curation" is not one of delivery, training, evaluation')
    expect(() => ctx.dataUse.pin(agent, terms({ retentionDays: 1.5 })))
      .toThrow('retentionDays 1.5 is not a positive whole number of days')
    expect(() => ctx.dataUse.pin(agent, terms({ retentionDays: 0 })))
      .toThrow(expect.objectContaining<Partial<DataUseError>>({ code: 'DATA_USE_INVALID_TERMS' }))
  })

  it('names the three purposes a transcript may serve', () => {
    expect([...DATA_USE_PURPOSES]).toEqual(['delivery', 'training', 'evaluation'])
  })
})
