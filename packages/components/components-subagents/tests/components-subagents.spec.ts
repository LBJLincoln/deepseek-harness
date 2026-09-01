import { describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import ComponentRegistry from '@deepseek-ai/dsh-components'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import SessionStore from '@deepseek-ai/dsh-session'
import * as adapter from '@deepseek-ai/dsh-components-subagents'
import { agentProviderComponentId } from '@deepseek-ai/dsh-components-subagents'
import * as invariantCompanion from '@deepseek-ai/dsh-components-subagents/invariant'

/** The subagent seam surface the adapter consumes: the provider list plus the two provider events. */
class StubSubagentRuntime extends Service {
  providers: string[] = ['spawn-in-process', 'codex']

  constructor(ctx: Context) {
    super(ctx, 'subagents')
  }

  list(): string[] {
    return [...this.providers]
  }
}

async function harness() {
  const ctx = new Context()
  await ctx.plugin(ComponentRegistry)
  await ctx.plugin(StubSubagentRuntime)
  const fiber = await ctx.plugin(adapter)
  return { ctx, fiber }
}

describe('@deepseek-ai/dsh-components-subagents', () => {
  it('mirrors every provider present at mount with its callable route', async () => {
    const { ctx } = await harness()
    expect(adapter.name).toBe('components-subagents')
    expect(adapter.inject).toEqual(['components', 'subagents'])
    expect(ctx.components.list('agent-provider').map(component => component.id)).toEqual([
      'agent-provider:spawn-in-process',
      'agent-provider:codex',
    ])
    expect(ctx.components.get(agentProviderComponentId('codex'))).toMatchObject({
      kind: 'agent-provider',
      name: 'codex',
      provenance: 'curated',
      owner: '@deepseek-ai/dsh-components-subagents',
      invoke: { tool: 'subagent', arguments: { provider: 'codex' } },
      detail: { provider: 'codex' },
    })
  })

  it('follows provider additions and removals through the seam events', async () => {
    const { ctx } = await harness()
    ctx.emit('subagent/provider-added', { name: 'acp' } as never)
    expect(ctx.components.get(agentProviderComponentId('acp'))).toBeDefined()
    ctx.emit('subagent/provider-added', { name: 'acp' } as never)
    expect(ctx.components.list('agent-provider')).toHaveLength(3)
    ctx.emit('subagent/provider-removed', 'codex')
    expect(ctx.components.get(agentProviderComponentId('codex'))).toBeUndefined()
    ctx.emit('subagent/provider-removed', 'never-registered')
    expect(ctx.components.list('agent-provider').map(component => component.name)).toEqual(['spawn-in-process', 'acp'])
  })

  it('removes every mirrored component when the adapter fiber is disposed', async () => {
    const { ctx, fiber } = await harness()
    expect(ctx.components.list('agent-provider')).toHaveLength(2)
    await fiber.dispose()
    expect(ctx.components.list('agent-provider')).toHaveLength(0)
  })

  it('registers its empty invariant companion', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(invariantCompanion)).resolves.toBeDefined()
  })
})
