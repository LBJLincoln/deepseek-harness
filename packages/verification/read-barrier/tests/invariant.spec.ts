/**
 * Durable read-barrier invariants: the refusal record's own fields, and the one
 * role and one root every refusal in a session must agree on.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry, { InvariantError } from '@deepseek-ai/dsh-invariants'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import * as ReadBarrierInvariant from '../src/invariant.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-read-barrier'
const ROOT = '/srv/verification'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(ReadBarrierInvariant)
  return ctx
}

function denial(overrides: Record<string, unknown> = {}, seq = 0): SessionEvent {
  return {
    type: 'read-barrier/denied',
    seq,
    time: seq,
    data: { version: 1, role: 'implementer', capability: 'fs', displayPath: '/srv/verification/runs/a/check', root: ROOT, ...overrides },
  } as unknown as SessionEvent
}

function feed(ctx: Context, session: Session, ...events: SessionEvent[]): void {
  for (const event of events) ctx.emit('session/event', session, event)
}

describe('read-barrier invariants', () => {
  it('accepts a session whose refusals agree on role and root', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('agreeing'))
    expect(() => { feed(ctx, session, denial(), denial({ capability: 'shell' }, 1)) }).not.toThrow()
  })

  it('ignores unrelated event streams', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('unrelated'))
    expect(() => { feed(ctx, session, { type: 'turn/start', seq: 0, time: 0, data: {} } as SessionEvent) }).not.toThrow()
    expect(() => { ctx.emit('tools/change') }).not.toThrow()
  })

  it.each([
    ['unknown version', { version: 2 }, 'records a read-barrier/denied of unknown version 2'],
    ['unknown capability', { capability: 'lsp' }, 'records a read-barrier/denied from unknown capability "lsp"'],
    ['a role the barrier denies nothing', { role: 'validator' }, 'records a read-barrier/denied for role "validator"; only an implementer is denied a read'],
    ['an unknown role', { role: 'auditor' }, 'records a read-barrier/denied for role "auditor"; only an implementer is denied a read'],
  ])('rejects %s', async (_name, overrides, message) => {
    const ctx = await setup()
    const session = Session.create(SessionId('malformed'))
    expect(() => { feed(ctx, session, denial(overrides)) })
      .toThrow(new InvariantError(PACKAGE_NAME, `session event 0 ${message}`))
  })

  it('rejects a refusal recorded under a second root', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('two-roots'))
    expect(() => { feed(ctx, session, denial(), denial({ root: '/other' }, 1)) })
      .toThrow(new InvariantError(PACKAGE_NAME, 'session event 1 records a read-barrier/denied under root "/other" after "/srv/verification"'))
  })

  it('validates the sessions already loaded when the companion installs', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('loaded'))
    session.append('read-barrier/denied', {
      version: 1, role: 'implementer', capability: 'fs', displayPath: '/srv/verification/x', root: ROOT,
    })
    session.append('read-barrier/denied', {
      version: 1, role: 'implementer', capability: 'fs', displayPath: '/srv/verification/y', root: '/elsewhere',
    })
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(ReadBarrierInvariant)).rejects.toThrow(InvariantError)
  })
})
