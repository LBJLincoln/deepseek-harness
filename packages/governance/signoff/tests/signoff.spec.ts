/**
 * The signoff service over the real session store: what a recorded signature
 * states, which fields it refuses before anything becomes durable, and what
 * folding one transition out of a log answers.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SignoffService, {
  ARTEFACT_SHA256,
  latestSignoff,
  SIGNOFF_TRANSITIONS,
  SignoffError,
} from '@deepseek-ai/dsh-signoff'
import type { SignoffRecord } from '@deepseek-ai/dsh-signoff'
import { stubAgent } from './agent.ts'

const ARTEFACT = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)

/** Mount the store and the service over one live agent. */
async function harness(config = { maxEvidence: 4, maxEvidenceRefChars: 32 }): Promise<{
  ctx: Context
  agent: Agent
  session: Session
}> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SignoffService, config)
  const session = Session.create(SessionId('signoff-session'))
  return { ctx, agent: stubAgent(session), session }
}

/** One complete input with the field under test overridable. */
function input(overrides: Partial<SignoffRecord> = {}): SignoffRecord {
  return {
    transition: 'spec-freeze',
    principal: { kind: 'human', id: 'product-owner' },
    artefactSha256: ARTEFACT,
    evidence: [{ kind: 'spec', ref: 'the frozen spec' }],
    ...overrides,
  }
}

describe('recording a signature', () => {
  it('appends the record it returns and folds it back out of the log', async () => {
    const { ctx, agent, session } = await harness()
    const record = ctx.signoffs.record(agent, input({
      principal: { kind: 'human', id: 'product-owner', displayName: 'Product Owner' },
    }))
    expect(record).toEqual({
      transition: 'spec-freeze',
      principal: { kind: 'human', id: 'product-owner', displayName: 'Product Owner' },
      artefactSha256: ARTEFACT,
      evidence: [{ kind: 'spec', ref: 'the frozen spec' }],
    })
    const appended = session.events.at(-1)
    expect(appended?.type).toBe('signoff/recorded')
    expect(appended?.data).toEqual(record)
    expect(ctx.signoffs.latest(agent, 'spec-freeze')).toEqual(record)
    expect(ctx.signoffs.latest(agent, 'release')).toBeUndefined()
  })

  it('drops an omitted display name rather than recording it as undefined', async () => {
    const { ctx, agent } = await harness()
    const record = ctx.signoffs.record(agent, input())
    expect(Object.hasOwn(record.principal, 'displayName')).toBe(false)
  })

  it('answers the newest record of one transition and leaves the others alone', async () => {
    const { ctx, agent, session } = await harness()
    ctx.signoffs.record(agent, input({ principal: { kind: 'human', id: 'first' } }))
    ctx.signoffs.record(agent, input({ transition: 'release', artefactSha256: OTHER }))
    ctx.signoffs.record(agent, input({ principal: { kind: 'human', id: 'second' } }))
    expect(ctx.signoffs.latest(agent, 'spec-freeze')?.principal.id).toBe('second')
    expect(ctx.signoffs.latest(agent, 'release')?.artefactSha256).toBe(OTHER)
    expect(latestSignoff(session.events, 'relaxation')).toBeUndefined()
  })

  it('refuses a second signature of one transition over another artefact', async () => {
    const { ctx, agent, session } = await harness()
    ctx.signoffs.record(agent, input())
    const before = session.seq
    expect(() => ctx.signoffs.record(agent, input({ artefactSha256: OTHER })))
      .toThrow(`this session signed "spec-freeze" on artefact ${ARTEFACT}, which ${OTHER} does not match`)
    expect(session.seq).toBe(before)
  })

  it('refuses a transition, a digest, or a principal a durable record may not carry', async () => {
    const { ctx, agent, session } = await harness()
    const refuse = (overrides: Partial<SignoffRecord>, message: string): void => {
      expect(() => ctx.signoffs.record(agent, input(overrides))).toThrow(message)
    }
    refuse({ transition: 'promotion' as SignoffRecord['transition'] }, 'transition "promotion" is not one of')
    refuse({ artefactSha256: 'A'.repeat(64) }, 'is not a lowercase 64-character SHA-256 hex digest')
    refuse({ principal: { kind: 'policy' as 'human', id: 'a-rule' } }, 'is not "human"; only a person signs a transition')
    refuse({ principal: { kind: 'human', id: '' } }, 'principal id is empty, so the record names nobody')
    refuse({ principal: { kind: 'human', id: 'x', displayName: '' } }, 'principal displayName is present and empty')
    expect(session.seq).toBe(0)
  })

  it('carries the error code every refusal shares', async () => {
    const { ctx, agent } = await harness()
    expect(() => ctx.signoffs.record(agent, input({ artefactSha256: 'short' })))
      .toThrow(expect.objectContaining<Partial<SignoffError>>({ code: 'SIGNOFF_INVALID_RECORD' }))
  })

  it('bounds the evidence list and each pointer at the configured limits', async () => {
    const { ctx, agent, session } = await harness()
    const pointer = { kind: 'run', ref: 'session-1' }
    expect(() => ctx.signoffs.record(agent, input({ evidence: [pointer, pointer, pointer, pointer, pointer] })))
      .toThrow('the record carries 5 evidence pointers, above the configured maximum of 4')
    expect(() => ctx.signoffs.record(agent, input({ evidence: [{ kind: '', ref: 'x' }] })))
      .toThrow('evidence kind is empty, so the pointer names nothing')
    expect(() => ctx.signoffs.record(agent, input({ evidence: [{ kind: 'run', ref: '' }] })))
      .toThrow('evidence ref is empty, so the pointer names nothing')
    expect(() => ctx.signoffs.record(agent, input({ evidence: [{ kind: 'r'.repeat(33), ref: 'x' }] })))
      .toThrow('evidence kind is 33 characters, above the configured maximum of 32')
    expect(() => ctx.signoffs.record(agent, input({ evidence: [{ kind: 'run', ref: 'r'.repeat(33) }] })))
      .toThrow('evidence ref is 33 characters, above the configured maximum of 32')
    expect(session.seq).toBe(0)
    expect(ctx.signoffs.record(agent, input({ evidence: [] })).evidence).toEqual([])
  })
})

describe('the transition and digest vocabularies', () => {
  it('names the five transitions a signature may close', async () => {
    const { ctx, agent } = await harness()
    expect([...SIGNOFF_TRANSITIONS]).toEqual([
      'spec-freeze',
      'relaxation',
      'review-acceptance',
      'release',
      'training-data-release',
    ])
    for (const transition of SIGNOFF_TRANSITIONS) {
      expect(ctx.signoffs.record(agent, input({ transition })).transition).toBe(transition)
    }
  })

  it('accepts only a lowercase 64-hex digest', () => {
    expect(ARTEFACT_SHA256.test(ARTEFACT)).toBe(true)
    expect(ARTEFACT_SHA256.test('a'.repeat(63))).toBe(false)
    expect(ARTEFACT_SHA256.test(`${'a'.repeat(63)}G`)).toBe(false)
  })
})
