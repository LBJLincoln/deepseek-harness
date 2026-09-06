import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import SessionStore from '@deepseek-ai/dsh-session'
import ComponentRegistry, { ComponentError, ComponentId, componentAddress, componentDigest } from '@deepseek-ai/dsh-components'
import type { ComponentDescriptor } from '@deepseek-ai/dsh-components'
import * as invariantCompanion from '@deepseek-ai/dsh-components/invariant'

declare module '@deepseek-ai/dsh-components/types' {
  interface ComponentKindMap {
    'test-kind': { readonly note: string }
    'other-kind': { readonly weight: number }
  }
}

async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(ComponentRegistry)
  return ctx
}

/** Reach the registry through a scoped context so registrations file into that scope's layer. */
function scopedComponents(ctx: Context): ComponentRegistry {
  const components = ctx.get('components')
  if (components === undefined) throw new Error('components service missing')
  return components
}

function testComponent(id: string, rest: Partial<ComponentDescriptor<'test-kind'>> = {}): ComponentDescriptor<'test-kind'> {
  return {
    id: ComponentId(id),
    kind: 'test-kind',
    digest: componentDigest('test-kind', [id]),
    digestBasis: 'content',
    name: id,
    description: `component ${id}`,
    owner: '@deepseek-ai/dsh-components-tests',
    provenance: 'curated',
    detail: { note: 'n' },
    ...rest,
  }
}

describe('componentDigest and componentAddress', () => {
  it('addresses equal content identically and separates kinds, one-byte changes, and ids', () => {
    const canonical = ['alpha', 'a skill body', null, true]
    const first = componentDigest('test-kind', canonical)
    const second = componentDigest('test-kind', ['alpha', 'a skill body', null, true])
    expect(first).toBe(second)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    // One byte of the canonical value changes the address.
    expect(componentDigest('test-kind', ['alpha', 'a skill bodz', null, true])).not.toBe(first)
    // The kind is inside the hashed bytes, so coinciding canonical values never collide.
    expect(componentDigest('other-kind', canonical)).not.toBe(first)
    expect(componentAddress(ComponentId('test-kind:alpha'), first)).toBe(`test-kind:alpha@${first}`)
  })

  it('gives two registrations of equal content one address and separates a mutated one', async () => {
    const ctx = await harness()
    const body = ['skill-body', 'line one\nline two']
    ctx.components.register(testComponent('test-kind:alpha', { digest: componentDigest('test-kind', body) }))
    ctx.components.register(testComponent('test-kind:copy', { digest: componentDigest('test-kind', body) }))
    ctx.components.register(testComponent('test-kind:mutated', {
      digest: componentDigest('test-kind', ['skill-body', 'line one\nline twp']),
    }))
    const [alpha, copy, mutated] = ctx.components.list({ kind: 'test-kind' })
    expect(copy?.digest).toBe(alpha?.digest)
    expect(mutated?.digest).not.toBe(alpha?.digest)
    expect(componentAddress(ComponentId('test-kind:copy'), copy!.digest))
      .not.toBe(componentAddress(ComponentId('test-kind:alpha'), alpha!.digest))
  })
})

describe('ComponentRegistry', () => {
  it('registers, reads, lists in registration order, and filters by kind', async () => {
    const ctx = await harness()
    ctx.components.register(testComponent('test-kind:alpha'))
    ctx.components.register({
      id: ComponentId('other-kind:gamma'),
      kind: 'other-kind',
      digest: componentDigest('other-kind', [3]),
      digestBasis: 'registration',
      name: 'gamma',
      description: 'component gamma',
      owner: '@deepseek-ai/dsh-components-tests',
      provenance: 'synthesized',
      lineage: ComponentId('test-kind:alpha'),
      detail: { weight: 3 },
    })
    ctx.components.register(testComponent('test-kind:beta'))
    expect(ctx.components.list().map(component => component.id)).toEqual(['test-kind:alpha', 'other-kind:gamma', 'test-kind:beta'])
    expect(ctx.components.list({ kind: 'test-kind' }).map(component => component.id)).toEqual(['test-kind:alpha', 'test-kind:beta'])
    expect(ctx.components.get(ComponentId('other-kind:gamma'))).toMatchObject({
      kind: 'other-kind',
      digestBasis: 'registration',
      provenance: 'synthesized',
      lineage: 'test-kind:alpha',
      layer: 'global',
      detail: { weight: 3 },
    })
    expect(ctx.components.get(ComponentId('missing'))).toBeUndefined()
  })

  it('rejects a duplicate id in the same layer loudly', async () => {
    const ctx = await harness()
    ctx.components.register(testComponent('test-kind:alpha'))
    expect(() => ctx.components.register(testComponent('test-kind:alpha')))
      .toThrow('component "test-kind:alpha" is already registered')
    try {
      ctx.components.register(testComponent('test-kind:alpha'))
      throw new Error('expected a rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(ComponentError)
      expect(error).toMatchObject({ code: 'COMPONENT_DUPLICATE_ID' })
    }
  })

  it('removes a component through its exact disposer and ignores a stale one', async () => {
    const ctx = await harness()
    const first = ctx.components.register(testComponent('test-kind:alpha'))
    first()
    expect(ctx.components.get(ComponentId('test-kind:alpha'))).toBeUndefined()
    ctx.components.register(testComponent('test-kind:alpha', { description: 'second registration' }))
    first()
    expect(ctx.components.get(ComponentId('test-kind:alpha'))?.description).toBe('second registration')
  })

  it('detaches member lists on write and on every read', async () => {
    const ctx = await harness()
    const members = [ComponentId('test-kind:alpha')]
    ctx.components.register(testComponent('test-kind:composite', { members }))
    members.push(ComponentId('test-kind:beta'))
    const read = ctx.components.get(ComponentId('test-kind:composite'))
    expect(read?.members).toEqual(['test-kind:alpha'])
    ;(read?.members as unknown as string[]).push('mutated')
    expect(ctx.components.get(ComponentId('test-kind:composite'))?.members).toEqual(['test-kind:alpha'])
    expect(ctx.components.list()[0]?.members).toEqual(['test-kind:alpha'])
  })

  it('registers its empty invariant companion', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(invariantCompanion)).resolves.toBeDefined()
  })
})

describe('ComponentRegistry scoped layers', () => {
  it('derives the layer, hides one agent scope from another, and shadows a global id', async () => {
    const ctx = await harness()
    ctx.components.register(testComponent('test-kind:global-only'))
    ctx.components.register(testComponent('test-kind:shadowed', { description: 'the global registration' }))
    const agentA = createScope(ctx, { agent: 'a' })
    const agentB = createScope(ctx, { agent: 'b' })
    scopedComponents(agentA.ctx).register(testComponent('test-kind:a-only'))
    scopedComponents(agentA.ctx).register(testComponent('test-kind:shadowed', { description: "agent A's registration" }))
    scopedComponents(agentB.ctx).register(testComponent('test-kind:b-only'))

    const keyA = scopeOf(agentA.ctx)
    expect(ctx.components.list({ scope: keyA }).map(component => [component.id, component.layer])).toEqual([
      ['test-kind:global-only', 'global'],
      ['test-kind:shadowed', 'agent'],
      ['test-kind:a-only', 'agent'],
    ])
    expect(ctx.components.get(ComponentId('test-kind:shadowed'), { scope: keyA }))
      .toMatchObject({ description: "agent A's registration", layer: 'agent' })
    expect(ctx.components.get(ComponentId('test-kind:shadowed')))
      .toMatchObject({ description: 'the global registration', layer: 'global' })
    expect(ctx.components.get(ComponentId('test-kind:a-only'), { scope: scopeOf(agentB.ctx) })).toBeUndefined()
    expect(ctx.components.list().map(component => component.id))
      .toEqual(['test-kind:global-only', 'test-kind:shadowed'])
    await agentA.dispose()
    await agentB.dispose()
  })

  it('inherits an enclosing scope down the chain and reports every overlay as the agent layer', async () => {
    const ctx = await harness()
    ctx.components.register(testComponent('test-kind:global-only'))
    const preset = createScope(ctx, { preset: 'standing' })
    const presetKey = scopeOf(preset.ctx)
    if (presetKey === undefined) throw new Error('preset scope missing')
    const agent = createScope(ctx, { agent: 'nested' }, { parent: presetKey })
    scopedComponents(preset.ctx).register(testComponent('test-kind:preset-owned'))
    scopedComponents(agent.ctx).register(testComponent('test-kind:agent-owned'))
    expect(ctx.components.list({ scope: scopeOf(agent.ctx) }).map(component => [component.id, component.layer])).toEqual([
      ['test-kind:global-only', 'global'],
      ['test-kind:preset-owned', 'agent'],
      ['test-kind:agent-owned', 'agent'],
    ])
    expect(ctx.components.list({ scope: presetKey, kind: 'test-kind' }).map(component => component.id))
      .toEqual(['test-kind:global-only', 'test-kind:preset-owned'])
    await agent.dispose()
    await preset.dispose()
  })

  it('scopes duplicate-id rejection per layer and reclaims a drained scope layer', async () => {
    const ctx = await harness()
    ctx.components.register(testComponent('test-kind:alpha'))
    const agent = createScope(ctx, { agent: 'duplicate' })
    const key = scopeOf(agent.ctx)
    // The same id in a different layer shadows rather than collides.
    const scoped = scopedComponents(agent.ctx).register(testComponent('test-kind:alpha', { description: 'scoped' }))
    expect(() => scopedComponents(agent.ctx).register(testComponent('test-kind:alpha')))
      .toThrow('component "test-kind:alpha" is already registered in this scope')
    scoped()
    expect(ctx.components.get(ComponentId('test-kind:alpha'), { scope: key }))
      .toMatchObject({ description: 'component test-kind:alpha', layer: 'global' })
    await agent.dispose()
  })

  it('removes every scoped registration when the owning scope is disposed', async () => {
    const ctx = await harness()
    const agent = createScope(ctx, { agent: 'disposed' })
    const key = scopeOf(agent.ctx)
    scopedComponents(agent.ctx).register(testComponent('test-kind:scoped'))
    expect(ctx.components.list({ scope: key })).toHaveLength(1)
    await agent.dispose()
    expect(ctx.components.list({ scope: key })).toHaveLength(0)
  })
})
