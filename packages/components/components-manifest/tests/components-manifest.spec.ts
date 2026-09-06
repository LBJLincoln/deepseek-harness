/**
 * Unit coverage for @deepseek-ai/dsh-components-manifest. The writer cases
 * dispatch the real `agent/pre-step` waterfall over a hand-built agent, so the
 * durable consequence — one manifest per composition change and none for an
 * unchanged step — is observed exactly as the loop would produce it.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { agentEvents, Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import ComponentRegistry, { ComponentId, componentAddress, componentDigest } from '@deepseek-ai/dsh-components'
import type { ComponentDescriptor, ComponentView } from '@deepseek-ai/dsh-components/types'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { Scope } from '@deepseek-ai/dsh-scope'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import * as manifestWriter from '@deepseek-ai/dsh-components-manifest'
import {
  buildCompositionManifest,
  COMPOSITION_MANIFEST_VERSION,
  compositionSha256,
  isComponentAddress,
  lastCompositionManifest,
  manifestEntries,
} from '@deepseek-ai/dsh-components-manifest'
import type { CompositionManifest } from '@deepseek-ai/dsh-components-manifest'

declare module '@deepseek-ai/dsh-components/types' {
  interface ComponentKindMap {
    /** Test-only kind: the writer never switches on a kind, so one stands in for every producer. */
    'fixture': undefined
  }
}

/** Build a registry-compatible agent around one concrete session. */
function stubAgent(session: Session, ctx: Context): Agent {
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  return {
    id: session.id,
    options: {},
    session,
    inbox,
    ctx,
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

/** One component of the test kind, addressed by its own body. */
function descriptor(id: string, body: string, extra: Partial<ComponentDescriptor> = {}): ComponentDescriptor {
  return {
    id: ComponentId(id),
    kind: 'fixture',
    digest: componentDigest('fixture', [body]),
    digestBasis: 'content',
    name: id,
    description: `fixture component ${id}`,
    owner: '@deepseek-ai/dsh-components-manifest',
    provenance: 'curated',
    detail: undefined,
    ...extra,
  }
}

/** One component as a scope-aware registry read returns it. */
function view(id: string, body: string, extra: Partial<ComponentView> = {}): ComponentView {
  return { ...descriptor(id, body), layer: 'global', ...extra }
}

/**
 * Mount the agent registry, the component registry, and the writer over one
 * live agent whose own scope owns an overlay layer.
 */
async function harness() {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(ComponentRegistry)
  const session = Session.create(SessionId(`manifest-${String(Math.random())}`))
  let scope!: Scope
  const agent = stubAgent(session, ctx)
  await ctx.plugin(Object.assign(
    (inner: Context) => { scope = createScope(inner, agent) },
    { inject: ['components'] },
  ))
  ctx.agents.register(agent)
  const fiber = await ctx.plugin(manifestWriter)
  return { ctx, agent, session, fiber, scope }
}

/** Dispatch one proposed step through the real waterfall with a plain enter default. */
function preStep(ctx: Context, agent: Agent, step = 1): Promise<PreStepDecision> {
  return agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { messages: [], turn: 1, step, signal: new AbortController().signal },
    (): Promise<PreStepDecision> => Promise.resolve({ kind: 'enter', messages: [] }),
  )
}

/** The manifests a session recorded, in log order. */
function manifests(session: Session): CompositionManifest[] {
  return session.events
    .filter((event): event is SessionEvent<'composition/manifest'> => event.type === 'composition/manifest')
    .map(event => event.data)
}

describe('the composition manifest fold', () => {
  it('orders entries by address and hashes exactly that order', () => {
    const manifest = buildCompositionManifest([view('b', 'one'), view('a', 'two')])
    expect(manifest.version).toBe(COMPOSITION_MANIFEST_VERSION)
    expect(manifest.components.map(entry => entry.id)).toEqual(['a', 'b'])
    expect(manifest.compositionSha256).toBe(compositionSha256(
      manifest.components.map(entry => componentAddress(entry.id, entry.digest)),
    ))
    // The reading order does not reach the hash.
    expect(buildCompositionManifest([view('a', 'two'), view('b', 'one')]).compositionSha256)
      .toBe(manifest.compositionSha256)
    // One byte changed in one component moves the whole composition hash.
    expect(buildCompositionManifest([view('b', 'one!'), view('a', 'two')]).compositionSha256)
      .not.toBe(manifest.compositionSha256)
    // Two readings of one address keep their relative order rather than swapping.
    expect(manifestEntries([view('a', 'one'), view('a', 'one')]).map(entry => entry.id)).toEqual(['a', 'a'])
  })

  it('carries lineage only for a component that declares one', () => {
    const [root, derived] = manifestEntries([
      view('a', 'one'),
      view('b', 'two', {
        lineage: ComponentId('a'), layer: 'agent', digestBasis: 'registration', provenance: 'synthesized',
      }),
    ])
    expect(root).not.toHaveProperty('lineage')
    expect(derived).toEqual({
      id: 'b',
      digest: componentDigest('fixture', ['two']),
      kind: 'fixture',
      digestBasis: 'registration',
      provenance: 'synthesized',
      lineage: 'a',
      layer: 'agent',
    })
  })

  it('reports the newest recorded manifest and nothing for a log that holds none', () => {
    const session = Session.create(SessionId('fold-last'))
    expect(lastCompositionManifest(session.events)).toBeUndefined()
    session.append('turn/start', { turn: 1 })
    expect(lastCompositionManifest(session.events)).toBeUndefined()
    const first = buildCompositionManifest([view('a', 'one')])
    const second = buildCompositionManifest([view('a', 'two')])
    session.append('composition/manifest', first)
    session.append('composition/manifest', second)
    expect(lastCompositionManifest(session.events)?.compositionSha256).toBe(second.compositionSha256)
  })

  it('accepts only an address a generation comparison can key on', () => {
    const digest = componentDigest('fixture', ['one'])
    expect(isComponentAddress(componentAddress(ComponentId('tool:read'), digest))).toBe(true)
    expect(isComponentAddress(`tool:read@${digest.slice(0, 16)}`)).toBe(false)
    expect(isComponentAddress(`tool:read@${digest.toUpperCase()}`)).toBe(false)
    expect(isComponentAddress(`@${digest}`)).toBe(false)
    expect(isComponentAddress(`tool@read@${digest}`)).toBe(false)
  })
})

describe('@deepseek-ai/dsh-components-manifest', () => {
  it('records the composition before the first step and nothing for an unchanged one', async () => {
    const { ctx, agent, session } = await harness()
    expect(manifestWriter.name).toBe('components-manifest')
    expect(manifestWriter.inject).toEqual(['agents', 'components'])
    ctx.components.register(descriptor('fixture:one', 'one'))

    await expect(preStep(ctx, agent)).resolves.toEqual({ kind: 'enter', messages: [] })
    expect(manifests(session)).toHaveLength(1)
    expect(manifests(session)[0]?.components).toEqual([{
      id: 'fixture:one',
      digest: componentDigest('fixture', ['one']),
      kind: 'fixture',
      digestBasis: 'content',
      provenance: 'curated',
      layer: 'global',
    }])

    await preStep(ctx, agent, 2)
    expect(manifests(session)).toHaveLength(1)
  })

  it('records the next manifest at the first step after the composition changed', async () => {
    const { ctx, agent, session } = await harness()
    const dispose = ctx.components.register(descriptor('fixture:one', 'one'))
    await preStep(ctx, agent)
    ctx.components.register(descriptor('fixture:two', 'two'))
    await preStep(ctx, agent, 2)
    expect(manifests(session)).toHaveLength(2)
    expect(manifests(session)[1]?.components.map(entry => entry.id)).toEqual(['fixture:one', 'fixture:two'])

    dispose()
    await preStep(ctx, agent, 3)
    expect(manifests(session)).toHaveLength(3)
    expect(manifests(session)[2]?.components.map(entry => entry.id)).toEqual(['fixture:two'])
  })

  it('re-emits nothing for a resumed session whose recorded composition still holds', async () => {
    const { ctx, agent, session } = await harness()
    ctx.components.register(descriptor('fixture:one', 'one'))
    // Seeded as a resumed log carries it, before this process proposed a step.
    session.append('composition/manifest', buildCompositionManifest(ctx.components.list({ scope: agent })))
    await preStep(ctx, agent)
    expect(manifests(session)).toHaveLength(1)
  })

  it('records the components the calling agent sees, not the global layer alone', async () => {
    const { ctx, agent, session, scope } = await harness()
    ctx.components.register(descriptor('fixture:global', 'global'))
    scope.ctx.components.register(descriptor('fixture:agent', 'agent'))
    await preStep(ctx, agent)
    expect(manifests(session)[0]?.components.map(entry => [entry.id, entry.layer])).toEqual([
      ['fixture:agent', 'agent'],
      ['fixture:global', 'global'],
    ])
  })

  it('stops writing once the plugin fiber is disposed', async () => {
    const { ctx, agent, session, fiber } = await harness()
    ctx.components.register(descriptor('fixture:one', 'one'))
    await fiber.dispose()
    await preStep(ctx, agent)
    expect(manifests(session)).toHaveLength(0)
  })
})
