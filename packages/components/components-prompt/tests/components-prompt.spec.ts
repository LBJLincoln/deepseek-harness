import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ComponentRegistry, { componentDigest } from '@deepseek-ai/dsh-components'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { Scope, ScopeKey } from '@deepseek-ai/dsh-scope'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as adapter from '@deepseek-ai/dsh-components-prompt'
import { promptSectionComponentId, promptSectionDigest, promptSectionDigestBasis } from '@deepseek-ai/dsh-components-prompt'
import * as invariantCompanion from '@deepseek-ai/dsh-components-prompt/invariant'

async function harness() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, persona: 'be useful' })
  await ctx.plugin(ComponentRegistry)
  const producer = await ctx.plugin(Object.assign(
    (inner: Context) => {
      inner.systemPrompt.section({ name: 'fixture:static', order: 10, text: 'stored bytes' })
      inner.systemPrompt.section({ name: 'fixture:dynamic', order: 20, text: () => 'rendered now' })
    },
    { inject: ['systemPrompt'] },
  ))
  const fiber = await ctx.plugin(adapter)
  return { ctx, fiber, producer }
}

/** Mint a scope usable as a viewing key for the registry reads. */
async function mintScope(ctx: Context): Promise<{ scope: Scope; key: ScopeKey }> {
  const key: ScopeKey = { agent: 'scoped' }
  let scope!: Scope
  await ctx.plugin(Object.assign(
    (inner: Context) => { scope = createScope(inner, key) },
    { inject: ['systemPrompt', 'components'] },
  ))
  return { scope, key }
}

describe('@deepseek-ai/dsh-components-prompt', () => {
  it('mirrors every resolved section, separating stored bytes from a per-assembly provider', async () => {
    const { ctx } = await harness()
    expect(adapter.name).toBe('components-prompt')
    expect(adapter.inject).toEqual(['components', 'systemPrompt'])
    expect(ctx.components.list({ kind: 'prompt-section' }).map(component => component.name))
      .toEqual(['deployment:persona', 'fixture:static', 'fixture:dynamic'])
    expect(ctx.components.get(promptSectionComponentId('fixture:static'))).toMatchObject({
      kind: 'prompt-section',
      digestBasis: 'content',
      owner: '@deepseek-ai/dsh-components-prompt',
      provenance: 'curated',
      layer: 'global',
      description: 'System prompt section at order 10, registered as stored text.',
      detail: { order: 10, complete: false, static: true },
    })
    expect(ctx.components.get(promptSectionComponentId('fixture:dynamic'))).toMatchObject({
      digestBasis: 'registration',
      description: 'System prompt section at order 20, rendered for each assembly.',
      detail: { order: 20, complete: false, static: false },
    })
    // A prompt section is not callable, so it carries no invoke pointer.
    expect(ctx.components.get(promptSectionComponentId('fixture:static'))?.invoke).toBeUndefined()
  })

  it('addresses a section by the canonical value this adapter owns', async () => {
    const { ctx } = await harness()
    const stored = { name: 'fixture:static', order: 10, text: 'stored bytes' }
    expect(ctx.components.get(promptSectionComponentId('fixture:static'))?.digest)
      .toBe(componentDigest('prompt-section', ['fixture:static', 10, false, 'stored bytes']))
    expect(promptSectionDigest(stored)).toBe(componentDigest('prompt-section', ['fixture:static', 10, false, 'stored bytes']))
    // One byte changed in stored text moves the address; two providers share one.
    expect(promptSectionDigest({ ...stored, text: 'stored byte' })).not.toBe(promptSectionDigest(stored))
    const provider = { name: 'p', order: 1, text: () => 'a' }
    expect(promptSectionDigest(provider)).toBe(promptSectionDigest({ name: 'p', order: 1, text: () => 'b' }))
    expect(promptSectionDigestBasis(provider)).toBe('registration')
    expect(promptSectionDigestBasis(stored)).toBe('content')
    // A complete section is a different composition of the same bytes.
    expect(promptSectionDigest({ ...stored, complete: true })).not.toBe(promptSectionDigest(stored))
  })

  it('describes a complete section as the complete system prompt', async () => {
    const { ctx } = await harness()
    await ctx.plugin(Object.assign(
      (inner: Context) => {
        inner.systemPrompt.section({ name: 'fixture:complete', order: 5, text: 'only this', complete: true })
      },
      { inject: ['systemPrompt'] },
    ))
    expect(ctx.components.get(promptSectionComponentId('fixture:complete'))).toMatchObject({
      description: 'System prompt section at order 5, registered as stored text, declared as the complete system prompt.',
      detail: { order: 5, complete: true, static: true },
    })
  })

  it('re-addresses a section whose stored text changed under the same id', async () => {
    const { ctx, producer } = await harness()
    const before = ctx.components.get(promptSectionComponentId('fixture:static'))?.digest
    await producer.dispose()
    expect(ctx.components.get(promptSectionComponentId('fixture:static'))).toBeUndefined()
    await ctx.plugin(Object.assign(
      (inner: Context) => { inner.systemPrompt.section({ name: 'fixture:static', order: 10, text: 'other bytes' }) },
      { inject: ['systemPrompt'] },
    ))
    expect(ctx.components.get(promptSectionComponentId('fixture:static'))?.digest).not.toBe(before)
  })

  it('removes every mirrored component when the adapter fiber is disposed', async () => {
    const { ctx, fiber } = await harness()
    expect(ctx.components.list({ kind: 'prompt-section' }).length).toBeGreaterThan(0)
    await fiber.dispose()
    expect(ctx.components.list({ kind: 'prompt-section' })).toHaveLength(0)
  })

  it('mirrors an agent scope into that agent layer when mounted through its context', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
    await ctx.plugin(ComponentRegistry)
    const { scope, key } = await mintScope(ctx)
    scope.ctx.systemPrompt.section({ name: 'scoped:only', order: 30, text: 'per agent' })
    await scope.ctx.plugin(adapter)

    const scoped = ctx.components.list({ kind: 'prompt-section', scope: key })
    expect(scoped.map(component => component.name)).toEqual(['deployment:persona', 'scoped:only'])
    expect(scoped.every(component => component.layer === 'agent')).toBe(true)
    expect(ctx.components.list({ kind: 'prompt-section' })).toHaveLength(0)
    await scope.dispose()
    expect(ctx.components.list({ kind: 'prompt-section', scope: key })).toHaveLength(0)
  })

  it('registers its empty invariant companion', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(invariantCompanion)).resolves.toBeDefined()
  })
})
