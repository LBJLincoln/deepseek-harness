/**
 * Durable read-barrier invariants: the refusal record's own fields, the census
 * and attestation records, and the one role and one root every record in a
 * session must agree on.
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

function scope(overrides: Record<string, unknown> = {}, seq = 0): SessionEvent {
  return {
    type: 'read-barrier/scope',
    seq,
    time: seq,
    data: {
      version: 1,
      role: 'implementer',
      presetId: 'implementing',
      root: ROOT,
      denied: [ROOT],
      census: [{ name: 'read', authority: [] }],
      enforcement: [{ capability: 'fs', state: 'denied-at-executor' }],
      ...overrides,
    },
  } as unknown as SessionEvent
}

function attestation(overrides: Record<string, unknown> = {}, seq = 0): SessionEvent {
  return {
    type: 'read-barrier/attestation',
    seq,
    time: seq,
    data: { version: 1, path: '/srv/attestation.json', owner: 4242, sha256: 'abc', ...overrides },
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

  it('accepts a refusal recorded for a judge, the barrier\'s other denied role', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('judging'))
    expect(() => { feed(ctx, session, denial({ role: 'judge' })) }).not.toThrow()
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
    ['a role the barrier denies nothing', { role: 'validator' }, 'records a read-barrier/denied for role "validator"; only implementer or judge is denied a read'],
    ['an unknown role', { role: 'auditor' }, 'records a read-barrier/denied for role "auditor"; only implementer or judge is denied a read'],
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

  it('accepts one census, its attestation, and the refusals that follow', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('censused'))
    expect(() => { feed(ctx, session, scope(), attestation({}, 1), denial({}, 2)) }).not.toThrow()
  })

  it.each([
    ['a census of unknown version', { version: 2 }, 'records a read-barrier/scope of unknown version 2'],
    ['a census for an unknown role', { role: 'auditor' }, 'records a read-barrier/scope for unknown role "auditor"'],
    [
      'enforcement for a capability that opens no path',
      { enforcement: [{ capability: 'lsp', state: 'unenforced' }] },
      'records read-barrier/scope enforcement for unknown capability "lsp"',
    ],
    [
      'an enforcement decision outside the vocabulary',
      { enforcement: [{ capability: 'fs', state: 'partly' }] },
      'records read-barrier/scope enforcement state "partly" for "fs"',
    ],
  ])('rejects %s', async (_name, overrides, message) => {
    const ctx = await setup()
    const session = Session.create(SessionId('malformed-scope'))
    expect(() => { feed(ctx, session, scope(overrides)) })
      .toThrow(new InvariantError(PACKAGE_NAME, `session event 0 ${message}`))
  })

  it('rejects a second census in one session', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('two-censuses'))
    expect(() => { feed(ctx, session, scope(), scope({}, 1)) })
      .toThrow(new InvariantError(PACKAGE_NAME, 'session event 1 records a second read-barrier/scope; one session composes one census'))
  })

  it('rejects a census recorded under a second root', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('scope-two-roots'))
    expect(() => { feed(ctx, session, denial(), scope({ root: '/other' }, 1)) })
      .toThrow(new InvariantError(PACKAGE_NAME, 'session event 1 records a read-barrier/scope under root "/other" after "/srv/verification"'))
  })

  it.each([
    ['an attestation of unknown version', { version: 2 }, 'records a read-barrier/attestation of unknown version 2'],
    ['an attestation naming no file', { path: '' }, 'records a read-barrier/attestation with no file path'],
  ])('rejects %s', async (_name, overrides, message) => {
    const ctx = await setup()
    const session = Session.create(SessionId('malformed-attestation'))
    expect(() => { feed(ctx, session, attestation(overrides)) })
      .toThrow(new InvariantError(PACKAGE_NAME, `session event 0 ${message}`))
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
