import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import ComponentRegistry, { ComponentId, componentDigest } from '@deepseek-ai/dsh-components'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { createScope } from '@deepseek-ai/dsh-scope'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import * as commandComponents from '@deepseek-ai/dsh-command-components'
import * as invariantCompanion from '@deepseek-ai/dsh-command-components/invariant'

declare module '@deepseek-ai/dsh-components/types' {
  interface ComponentKindMap {
    'test-kind': { readonly note: string }
    'other-kind': { readonly weight: number }
  }
}

interface Harness {
  readonly ctx: Context
  readonly agent: Agent
  readonly session: Session
  readonly plugin: Awaited<ReturnType<Context['plugin']>>
}

/** Build a live idle agent the command executor can log lifecycle events on. */
function stubAgent(ctx: Context, id: string): { agent: Agent; session: Session } {
  const session = ctx.sessions.create(SessionId(id))
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  let status: AgentStatus = 'idle'
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    inbox,
    ctx: new Context(),
    get status() { return status },
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject(input) { inbox.append('next-step', input) },
    cancel() { status = 'idle' },
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
  return { agent, session }
}

/** Mount the real command registry, component registry, and producer. */
async function harness(): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(ComponentRegistry)
  const plugin = await ctx.plugin(commandComponents)
  const { agent, session } = stubAgent(ctx, `command-components-${Math.random()}`)
  ctx.agents.register(agent)
  return { ctx, agent, session, plugin }
}

/** Execute `/components` through the same registry boundary as a UI adapter. */
async function run(test: Harness, suffix = ''): Promise<NonNullable<Awaited<ReturnType<CommandRuntime['execute']>>>['result']> {
  const execution = await test.ctx.commands.execute(
    test.agent,
    `/components${suffix}`,
    new AbortController().signal,
  )
  if (execution === undefined) throw new Error('components command was not registered')
  return execution.result
}

describe('@deepseek-ai/dsh-command-components registration', () => {
  it('registers one global command with Loader-safe exports and disposes it', async () => {
    const test = await harness()
    expect(commandComponents.name).toBe('command-components')
    expect(commandComponents.inject).toEqual(['commands', 'components'])
    expect('default' in commandComponents).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    expect(loader.unwrapExports(commandComponents)).toBe(commandComponents)
    expect(test.ctx.commands.list(test.agent)).toContainEqual({
      name: 'components',
      description: 'view every addressable component in this composition, grouped by kind',
    })
    await test.plugin.dispose()
    expect(test.ctx.commands.find(test.agent, 'components')).toBeUndefined()
  })

  it('registers its empty invariant companion', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(invariantCompanion)).resolves.toBeDefined()
  })
})

describe('/components human command', () => {
  it('shows the empty inventory without writing session events and rejects arguments', async () => {
    const test = await harness()
    await expect(run(test)).resolves.toEqual({
      kind: 'success',
      text: 'No components are registered in this composition.\nUsage: /components',
    })
    await expect(run(test, ' extra')).resolves.toEqual({
      kind: 'error',
      text: 'The components command takes no arguments. Usage: /components',
    })
    const bookkeeping = new Set(['command/run', 'command/done', 'turn/start', 'turn/end'])
    expect(test.session.events.filter(event => !bookkeeping.has(event.type))).toEqual([])
  })

  it('renders the inventory grouped by kind with provenance, lineage, members, and routes', async () => {
    const test = await harness()
    test.ctx.components.register({
      id: ComponentId('test-kind:alpha'),
      kind: 'test-kind',
      digest: componentDigest('test-kind', ['alpha']),
      digestBasis: 'content',
      name: 'alpha',
      description: 'component alpha',
      owner: '@deepseek-ai/dsh-command-components-tests',
      provenance: 'curated',
      invoke: { tool: 'alpha_tool', arguments: { target: 'alpha' } },
      detail: { note: 'a' },
    })
    test.ctx.components.register({
      id: ComponentId('other-kind:gamma'),
      kind: 'other-kind',
      digest: componentDigest('other-kind', [2]),
      digestBasis: 'registration',
      name: 'gamma',
      description: 'component gamma',
      owner: '@deepseek-ai/dsh-command-components-tests',
      provenance: 'curated',
      members: [ComponentId('test-kind:alpha'), ComponentId('test-kind:beta')],
      detail: { weight: 2 },
    })
    test.ctx.components.register({
      id: ComponentId('test-kind:beta'),
      kind: 'test-kind',
      digest: componentDigest('test-kind', ['beta']),
      digestBasis: 'content',
      name: 'beta',
      description: 'component beta',
      owner: '@deepseek-ai/dsh-command-components-tests',
      provenance: 'synthesized',
      lineage: ComponentId('test-kind:alpha'),
      detail: { note: 'b' },
    })
    await expect(run(test)).resolves.toEqual({
      kind: 'success',
      text: [
        'Components (3)',
        'test-kind (2):',
        '- test-kind:alpha: component alpha · curated · via alpha_tool',
        '- test-kind:beta: component beta · synthesized · from test-kind:alpha',
        'other-kind (1):',
        '- other-kind:gamma: component gamma · curated · 2 members',
      ].join('\n'),
    })
  })

  it('renders what the invoking agent sees, including its own scope layer', async () => {
    const test = await harness()
    const scope = createScope(test.ctx, test.agent)
    const scoped = scope.ctx.get('components')
    if (scoped === undefined) throw new Error('components service missing')
    scoped.register({
      id: ComponentId('test-kind:agent-owned'),
      kind: 'test-kind',
      digest: componentDigest('test-kind', ['agent-owned']),
      digestBasis: 'content',
      name: 'agent-owned',
      description: 'component mounted for this agent alone',
      owner: '@deepseek-ai/dsh-command-components-tests',
      provenance: 'curated',
      detail: { note: 'scoped' },
    })
    await expect(run(test)).resolves.toEqual({
      kind: 'success',
      text: [
        'Components (1)',
        'test-kind (1):',
        '- test-kind:agent-owned: component mounted for this agent alone · curated',
      ].join('\n'),
    })
    expect(test.ctx.components.list()).toEqual([])
    await scope.dispose()
  })
})
