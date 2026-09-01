import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import SessionStore from '@deepseek-ai/dsh-session'
import ComponentRegistry, { ComponentError, ComponentId } from '@deepseek-ai/dsh-components'
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

function testComponent(id: string, rest: Partial<ComponentDescriptor<'test-kind'>> = {}): ComponentDescriptor<'test-kind'> {
  return {
    id: ComponentId(id),
    kind: 'test-kind',
    name: id,
    description: `component ${id}`,
    owner: '@deepseek-ai/dsh-components-tests',
    provenance: 'curated',
    detail: { note: 'n' },
    ...rest,
  }
}

describe('ComponentRegistry', () => {
  it('registers, reads, lists in registration order, and filters by kind', async () => {
    const ctx = await harness()
    ctx.components.register(testComponent('test-kind:alpha'))
    ctx.components.register({
      id: ComponentId('other-kind:gamma'),
      kind: 'other-kind',
      name: 'gamma',
      description: 'component gamma',
      owner: '@deepseek-ai/dsh-components-tests',
      provenance: 'synthesized',
      lineage: ComponentId('test-kind:alpha'),
      detail: { weight: 3 },
    })
    ctx.components.register(testComponent('test-kind:beta'))
    expect(ctx.components.list().map(component => component.id)).toEqual(['test-kind:alpha', 'other-kind:gamma', 'test-kind:beta'])
    expect(ctx.components.list('test-kind').map(component => component.id)).toEqual(['test-kind:alpha', 'test-kind:beta'])
    expect(ctx.components.get(ComponentId('other-kind:gamma'))).toMatchObject({
      kind: 'other-kind',
      provenance: 'synthesized',
      lineage: 'test-kind:alpha',
      detail: { weight: 3 },
    })
    expect(ctx.components.get(ComponentId('missing'))).toBeUndefined()
  })

  it('rejects a duplicate id loudly', async () => {
    const ctx = await harness()
    ctx.components.register(testComponent('test-kind:alpha'))
    expect(() => ctx.components.register(testComponent('test-kind:alpha')))
      .toThrow(expect.objectContaining({ code: 'COMPONENT_DUPLICATE_ID' }))
    try {
      ctx.components.register(testComponent('test-kind:alpha'))
      throw new Error('expected a rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(ComponentError)
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
