/**
 * Durable judge invariants: a verdict is admissible only from a session with no
 * fork parent, no inherited seed, a recorded `judge/session`, and a derived
 * history that opened with exactly the three messages an audit may carry.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry, { InvariantError } from '@deepseek-ai/dsh-invariants'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import * as JudgeInvariant from '../src/invariant.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-judge'
const JUDGE = SessionId('judge-1')
const AUDITED = SessionId('environment-audited')

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(JudgeInvariant)
  return ctx
}

/** A judge session whose header, opening messages, and lineage record are all under test. */
function judgeSession(options: {
  header?: Partial<SessionHeader>
  openingMessages?: number
  lineage?: boolean
} = {}): Session {
  const header: SessionHeader = {
    version: SESSION_FORMAT_VERSION,
    id: JUDGE,
    createdAt: 0,
    ...options.header,
  }
  const session = Session.create(JUDGE, undefined, header)
  if (options.lineage !== false) {
    session.append('judge/session', {
      judgeSessionId: JUDGE, auditedSessionId: AUDITED, attempt: 1, treeHash: 'abc',
    })
  }
  for (let index = 0; index < (options.openingMessages ?? 3); index += 1) {
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: `message ${String(index)}` }],
      source: { kind: 'plugin', plugin: 'judge' },
    }), { surfaceOp: 'append' })
  }
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: 'text', text: 'verdict: upheld' }],
      source: { provider: 'mock', model: 'mock' },
    }),
  }, { surfaceOp: 'append' })
  return session
}

/** The verdict event as it would be appended, without appending it to the session. */
function verdict(overrides: Record<string, unknown> = {}, seq = 0): SessionEvent {
  return {
    type: 'judge/verdict',
    seq,
    time: seq,
    data: { auditedSessionId: AUDITED, attempt: 1, verdict: 'upheld', rationale: 'every check passed.', ...overrides },
  } as unknown as SessionEvent
}

describe('judge invariants', () => {
  it('accepts a verdict from a parentless, unseeded, three-message judge session', async () => {
    const ctx = await setup()
    const session = judgeSession()
    expect(() => { ctx.emit('session/event', session, verdict({}, session.events.length)) }).not.toThrow()
  })

  it('ignores unrelated event streams', async () => {
    const ctx = await setup()
    const session = judgeSession()
    expect(() => {
      ctx.emit('session/event', session, { type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } } as SessionEvent)
    }).not.toThrow()
    expect(() => { ctx.emit('session/created', session) }).not.toThrow()
  })

  it('rejects a verdict outside the vocabulary', async () => {
    const ctx = await setup()
    const session = judgeSession()
    expect(() => { ctx.emit('session/event', session, verdict({ verdict: 'guilty' }, 5)) })
      .toThrow(new InvariantError(PACKAGE_NAME, 'session event 5 records a judge/verdict of unknown verdict "guilty"'))
  })

  it('rejects a verdict from a forked session', async () => {
    const ctx = await setup()
    const session = judgeSession({ header: { parentSession: AUDITED } })
    expect(() => { ctx.emit('session/event', session, verdict({}, 5)) })
      .toThrow(new InvariantError(
        PACKAGE_NAME,
        `session event 5 records a judge/verdict in a session forked from "${AUDITED}"; a judge session carries no lineage`,
      ))
  })

  it('rejects a verdict from a seeded session', async () => {
    const ctx = await setup()
    const session = judgeSession({ header: { seedLength: 2 } })
    expect(() => { ctx.emit('session/event', session, verdict({}, 5)) })
      .toThrow(new InvariantError(
        PACKAGE_NAME,
        'session event 5 records a judge/verdict in a session seeded with 2 inherited event(s); a judge session carries no lineage',
      ))
  })

  it('rejects a verdict from a session nothing established as a judge', async () => {
    const ctx = await setup()
    const session = judgeSession({ lineage: false })
    expect(() => { ctx.emit('session/event', session, verdict({}, 5)) })
      .toThrow(new InvariantError(
        PACKAGE_NAME,
        'session event 5 records a judge/verdict with no judge/session; nothing established this session as a judge',
      ))
  })

  it.each([
    ['a fourth opening message', 4],
    ['only two opening messages', 2],
  ])('rejects a verdict from a history with %s', async (_name, openingMessages) => {
    const ctx = await setup()
    const session = judgeSession({ openingMessages })
    expect(() => { ctx.emit('session/event', session, verdict({}, 9)) })
      .toThrow(new InvariantError(
        PACKAGE_NAME,
        `session event 9 records a judge/verdict from a history opening with ${String(openingMessages)} message(s); a judge reads exactly 3`,
      ))
  })

  it('rejects a verdict from a judge that never answered', async () => {
    const ctx = await setup()
    const session = Session.create(JUDGE)
    session.append('judge/session', {
      judgeSessionId: JUDGE, auditedSessionId: AUDITED, attempt: 1, treeHash: 'abc',
    })
    expect(() => { ctx.emit('session/event', session, verdict({}, 5)) })
      .toThrow(new InvariantError(
        PACKAGE_NAME,
        'session event 5 records a judge/verdict from a history opening with 0 message(s); a judge reads exactly 3',
      ))
  })

  it('validates the sessions already loaded when the companion installs', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(JUDGE)
    session.append('judge/verdict', {
      auditedSessionId: AUDITED, attempt: 1, verdict: 'upheld', rationale: 'every check passed.',
    })
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(JudgeInvariant)).rejects.toThrow(InvariantError)
  })
})
