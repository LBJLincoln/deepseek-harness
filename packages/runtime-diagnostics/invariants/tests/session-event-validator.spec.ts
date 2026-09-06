import { describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import InvariantRegistry, { InvariantError, sessionEventValidator } from '@deepseek-ai/dsh-invariants'

/** Minimal event shape the helper needs: nothing beyond object identity. */
interface FakeEvent {
  readonly id: string
}

/** Minimal session shape the helper needs: its currently committed events. */
interface FakeSession {
  readonly events: FakeEvent[]
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    // Deliberately NOT `session/event`: this whole workspace's host build
    // typechecks every package's tests in one TypeScript program, so
    // augmenting a real event name here would merge into `dsh-session`'s own
    // `Events['session/event'](Session, SessionEvent)` declaration and break
    // every other caller. `emitSessionEvent` below reaches the real
    // `session/event` string by an untyped cast instead.
    'invariants-test/unrelated'(): void
  }
}

/**
 * Stands in for `dsh-session`'s real `sessions` service so `inject:
 * ['sessions']` — which every helper-built installer declares — resolves.
 * Registered under the plain string name; `Service` needs no type-level
 * `Context.sessions` declaration, which would collide the same way.
 */
class FakeSessionsService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'sessions')
  }
}

/** Mount the registry plus a stand-in `sessions` service every installer needs. */
async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(FakeSessionsService)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  return ctx
}

/** Dispatch the real `session/event` by name without a typed `Events` member (see above). */
function emitSessionEvent(ctx: Context, session: FakeSession, event: FakeEvent): void {
  (ctx.emit as unknown as (name: string, session: FakeSession, event: FakeEvent) => void)('session/event', session, event)
}

/**
 * `register()`'s declared return type is a plain disposer; Cordis attaches
 * setup thenability to the same callable at runtime (mirrors `service.spec.ts`).
 */
interface RuntimeRegistration extends PromiseLike<() => void> {
  (): void | Promise<void>
}

function runtimeRegistration(registration: () => void): RuntimeRegistration {
  return registration as RuntimeRegistration
}

describe('sessionEventValidator', () => {
  it('seeds from every session the accessor returns, threading committed events as prior', async () => {
    const e1: FakeEvent = { id: 'e1' }
    const e2: FakeEvent = { id: 'e2' }
    const e3: FakeEvent = { id: 'e3' }
    const sessionA: FakeSession = { events: [e1, e2] }
    const sessionB: FakeSession = { events: [e3] }
    const calls: Array<{ prior: readonly FakeEvent[]; event: FakeEvent }> = []
    const validate = (prior: readonly FakeEvent[], event: FakeEvent): void => {
      // sessionEventValidator threads one mutable array through the whole
      // seed loop, appending after each call; snapshot it before it changes.
      calls.push({ prior: [...prior], event })
    }

    const ctx = await setup()
    const install = sessionEventValidator(validate, () => [sessionA, sessionB])
    await runtimeRegistration(ctx.invariants.register('@fake/session-seed', install))

    expect(calls).toEqual([
      { prior: [], event: e1 },
      { prior: [e1], event: e2 },
      { prior: [], event: e3 },
    ])
  })

  it('declares the sessions service injection every current caller requires', () => {
    const install = sessionEventValidator(() => {}, () => [])
    expect(install.inject).toEqual(['sessions'])
  })

  it('revalidates a live session/event dispatch against the dispatching session\'s committed events', async () => {
    const seeded: FakeEvent = { id: 'seeded' }
    const live: FakeEvent = { id: 'live' }
    const session: FakeSession = { events: [seeded] }
    const validate = vi.fn()

    const ctx = await setup()
    await runtimeRegistration(ctx.invariants.register('@fake/session-dispatch', sessionEventValidator(validate, () => [])))

    emitSessionEvent(ctx, session, live)

    expect(validate).toHaveBeenCalledExactlyOnceWith([seeded], live, expect.any(Function))
  })

  it('ignores internal/dispatch traffic for every other event name', async () => {
    const validate = vi.fn()
    const ctx = await setup()
    await runtimeRegistration(ctx.invariants.register('@fake/session-ignore', sessionEventValidator(validate, () => [])))

    ctx.emit('invariants-test/unrelated')

    expect(validate).not.toHaveBeenCalled()
  })

  it('reports a seed-phase violation as an InvariantError attributed to the registering package', async () => {
    const ctx = await setup()
    const session: FakeSession = { events: [{ id: 'bad' }] }
    const install = sessionEventValidator<FakeEvent>((_prior, _event, fail) => fail('seeded event is invalid'), () => [session])

    await expect(ctx.invariants.register('@fake/session-seed-fail', install))
      .rejects.toMatchObject(new InvariantError('@fake/session-seed-fail', 'seeded event is invalid'))
  })

  it('reports a live dispatch violation as an InvariantError attributed to the registering package', async () => {
    const ctx = await setup()
    const install = sessionEventValidator<FakeEvent>((_prior, _event, fail) => fail('live event is invalid'), () => [])
    await runtimeRegistration(ctx.invariants.register('@fake/session-live-fail', install))

    expect(() => { emitSessionEvent(ctx, { events: [] }, { id: 'live' }) })
      .toThrow(new InvariantError('@fake/session-live-fail', 'live event is invalid'))
  })
})
