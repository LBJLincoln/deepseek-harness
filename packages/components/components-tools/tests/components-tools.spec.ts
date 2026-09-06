import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import ComponentRegistry, { componentDigest } from '@deepseek-ai/dsh-components'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { Scope } from '@deepseek-ai/dsh-scope'
import type { SessionId } from '@deepseek-ai/dsh-session'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import * as adapter from '@deepseek-ai/dsh-components-tools'
import { toolComponentId, toolDigest } from '@deepseek-ai/dsh-components-tools'
import * as invariantCompanion from '@deepseek-ai/dsh-components-tools/invariant'

function tool(name: string, description = `tool ${name}`): ToolDefinition {
  return {
    name,
    description,
    parameters: { type: 'object', properties: {} },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value as string }],
    },
    execute: (): Promise<string> => Promise.resolve(`ran:${name}`),
  }
}

async function harness() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(ComponentRegistry)
  const producer = await ctx.plugin(Object.assign(
    (inner: Context) => { inner.tools.register(tool('read_file')) },
    { inject: ['tools'] },
  ))
  const fiber = await ctx.plugin(adapter)
  return { ctx, fiber, producer }
}

/** Mint a scope whose key doubles as a minimal Agent-like object. */
async function mintAgentScope(ctx: Context, id: string): Promise<{ scope: Scope; key: Agent }> {
  const key = { id: id as SessionId } as Agent
  let scope!: Scope
  await ctx.plugin(Object.assign(
    (inner: Context) => { scope = createScope(inner, key) },
    { inject: ['tools', 'systemPrompt', 'components'] },
  ))
  return { scope, key }
}

describe('@deepseek-ai/dsh-components-tools', () => {
  it('mirrors every visible tool at mount with the tool itself as the callable route', async () => {
    const { ctx } = await harness()
    expect(adapter.name).toBe('components-tools')
    expect(adapter.inject).toEqual(['components', 'tools'])
    const read = ctx.components.get(toolComponentId('read_file'))
    expect(read).toMatchObject({
      kind: 'tool',
      name: 'read_file',
      description: 'tool read_file',
      provenance: 'curated',
      owner: '@deepseek-ai/dsh-components-tools',
      layer: 'global',
      digestBasis: 'content',
      invoke: { tool: 'read_file' },
      detail: { toolName: 'read_file' },
    })
  })

  it('addresses a tool by the model-facing schema this adapter owns', async () => {
    const { ctx } = await harness()
    const schema = ctx.tools.schemas().find(candidate => candidate.name === 'read_file')
    if (schema === undefined) throw new Error('expected the registered tool to be visible')
    expect(ctx.components.get(toolComponentId('read_file'))?.digest).toBe(toolDigest(schema))
    expect(toolDigest(schema)).toBe(componentDigest('tool', schema as never))
    // A changed description is a changed model-facing schema, so the address moves.
    expect(toolDigest({ ...schema, description: 'other' })).not.toBe(toolDigest(schema))
  })

  it('registers a tool added later and re-addresses one whose schema changed', async () => {
    const { ctx } = await harness()
    const added = await ctx.plugin(Object.assign(
      (inner: Context) => { inner.tools.register(tool('write_file')) },
      { inject: ['tools'] },
    ))
    const first = ctx.components.get(toolComponentId('write_file'))
    expect(first?.digest).toBeDefined()
    await added.dispose()
    await ctx.plugin(Object.assign(
      (inner: Context) => { inner.tools.register(tool('write_file', 'a different description')) },
      { inject: ['tools'] },
    ))
    const second = ctx.components.get(toolComponentId('write_file'))
    expect(second?.description).toBe('a different description')
    expect(second?.digest).not.toBe(first?.digest)
  })

  it('drops a component when the fiber that registered its tool is disposed', async () => {
    const { ctx, producer } = await harness()
    expect(ctx.components.list({ kind: 'tool' })).toHaveLength(1)
    await producer.dispose()
    expect(ctx.components.get(toolComponentId('read_file'))).toBeUndefined()
    expect(ctx.components.list({ kind: 'tool' })).toHaveLength(0)
  })

  it('removes every mirrored component when the adapter fiber is disposed', async () => {
    const { ctx, fiber } = await harness()
    expect(ctx.components.list({ kind: 'tool' })).toHaveLength(1)
    await fiber.dispose()
    expect(ctx.components.list({ kind: 'tool' })).toHaveLength(0)
  })

  it('mirrors an agent scope into that agent layer when mounted through its context', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(ComponentRegistry)
    await ctx.plugin(Object.assign(
      (inner: Context) => { inner.tools.register(tool('read_file')) },
      { inject: ['tools'] },
    ))
    const { scope, key } = await mintAgentScope(ctx, 'agent-1')
    scope.ctx.tools.register(tool('scoped_only'))
    await scope.ctx.plugin(adapter)

    const scoped = ctx.components.list({ kind: 'tool', scope: key })
    expect(scoped.map(component => component.name).sort()).toEqual(['read_file', 'scoped_only'])
    expect(scoped.every(component => component.layer === 'agent')).toBe(true)
    // The registrations sit in the agent's layer alone: a global reader sees none.
    expect(ctx.components.list({ kind: 'tool' })).toHaveLength(0)
    await scope.dispose()
    expect(ctx.components.list({ kind: 'tool', scope: key })).toHaveLength(0)
  })

  it('registers its empty invariant companion', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(invariantCompanion)).resolves.toBeDefined()
  })
})
