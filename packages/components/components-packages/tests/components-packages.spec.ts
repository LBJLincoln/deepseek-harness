import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Group from '@deepseek-ai/cordis-plugin-group'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import ComponentRegistry, { componentDigest } from '@deepseek-ai/dsh-components'
import DynamicCordisRunner from '@deepseek-ai/dsh-cordis-host-runner'
import type { ApprovalRequestId, CordisDynamicPluginId } from '@deepseek-ai/dsh-cordis-host-runner/types'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as adapter from '@deepseek-ai/dsh-components-packages'
import {
  dynamicPackageComponentId, dynamicPackageDigest, pluginComponentId, pluginDigest,
  type DynamicPackageComponentDetail,
} from '@deepseek-ai/dsh-components-packages'
import * as invariantCompanion from '@deepseek-ai/dsh-components-packages/invariant'

/** A host half that registers nothing beyond a service, so activation is observable. */
const HOST_CODE = `
  return {
    name: 'probe',
    apply(ctx) {
      ctx.provide('dynProbe', { ok: true })
    },
  }
`

/** One composed row, mounted from a builtin so the tree needs no module on disk. */
const PROBE_PLUGIN = { name: 'probe-plugin', apply: () => {} }

async function harness(): Promise<{ ctx: Context; fiber: Awaited<ReturnType<Context['plugin']>> }> {
  const ctx = new Context()
  await ctx.plugin(Loader)
  ctx.loader.builtins.probe = PROBE_PLUGIN
  ctx.loader.builtins.group = Group
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(ComponentRegistry)
  const fiber = await ctx.plugin(adapter)
  return { ctx, fiber }
}

/** Mint a scope whose key doubles as a minimal Agent carrying its own context. */
async function mintAgent(ctx: Context, id: string): Promise<{ scope: Scope; agent: Agent }> {
  const key = { id: SessionId(id), steer: () => {}, inject: () => {} } as unknown as { id: SessionId; ctx: Context }
  let scope!: Scope
  await ctx.plugin(Object.assign(
    (inner: Context) => { scope = createScope(inner, key) },
    { inject: ['components'] },
  ))
  key.ctx = scope.ctx
  return { scope, agent: key as unknown as Agent }
}

/** Define and run one dynamic package for `agent`, returning its plugin identity. */
async function mount(ctx: Context, agent: Agent, name: string, host: string): Promise<CordisDynamicPluginId> {
  const { pluginId, packageId } = ctx.dynamicCordisRunner.define({
    sessionId: agent.id,
    plugin: { kind: 'new', idPrefix: 'dyn' },
    name,
    purpose: 'spec fixture',
    code: { host },
  })
  const started = await ctx.dynamicCordisRunner.run(agent, pluginId, packageId, 'run')
  if (!started.ok) throw new Error(started.message)
  return pluginId
}

describe('@deepseek-ai/dsh-components-packages over the Loader tree', () => {
  it('mirrors every mounted entry as a curated plugin component', async () => {
    const { ctx } = await harness()
    expect(adapter.name).toBe('components-packages')
    expect(adapter.inject).toEqual(['components', 'loader'])
    await ctx.loader.create({ name: 'cordis:probe', config: { label: 'first' } })

    const component = ctx.components.get(pluginComponentId('probe-row'))
      ?? ctx.components.list({ kind: 'plugin' })[0]
    expect(component).toMatchObject({
      kind: 'plugin',
      digestBasis: 'registration',
      provenance: 'curated',
      layer: 'global',
      owner: '@deepseek-ai/dsh-components-packages',
      detail: { specifier: 'cordis:probe' },
    })
    expect(component?.digest).toBe(pluginDigest('cordis:probe', { label: 'first' }))
    expect(pluginDigest('cordis:probe', { label: 'first' }))
      .toBe(componentDigest('plugin', ['cordis:probe', { label: 'first' }]))
  })

  it('re-addresses an entry whose config changed and drops a removed one', async () => {
    const { ctx } = await harness()
    const id = await ctx.loader.create({ name: 'cordis:probe', config: { label: 'first' } })
    const first = ctx.components.get(pluginComponentId(id))?.digest
    expect(first).toBeDefined()

    await ctx.loader.update(id, { config: { label: 'second' } })
    expect(ctx.components.get(pluginComponentId(id))?.digest)
      .toBe(pluginDigest('cordis:probe', { label: 'second' }))
    expect(ctx.components.get(pluginComponentId(id))?.digest).not.toBe(first)

    await ctx.loader.remove(id)
    expect(ctx.components.get(pluginComponentId(id))).toBeUndefined()
  })

  it('records a config no JSON encoding preserves exactly as an absent one', () => {
    expect(pluginDigest('cordis:probe', { when: () => 'now' })).toBe(pluginDigest('cordis:probe', undefined))
  })

  it('leaves a disabled entry and a group row out of the inventory', async () => {
    const { ctx } = await harness()
    const group = await ctx.loader.create({ name: 'cordis:group', group: true, config: [] })
    await ctx.loader.create({ name: 'cordis:probe', disabled: true })
    expect(ctx.components.list({ kind: 'plugin' })).toEqual([])
    // The group becomes a container for a mounted row, which is what enters.
    const child = await ctx.loader.create({ name: 'cordis:probe' }, group)
    expect(ctx.components.list({ kind: 'plugin' }).map(component => component.name)).toEqual([child])
  })

  it('removes every mirrored component when the adapter fiber is disposed', async () => {
    const { ctx, fiber } = await harness()
    await ctx.loader.create({ name: 'cordis:probe' })
    expect(ctx.components.list({ kind: 'plugin' })).toHaveLength(1)
    await fiber.dispose()
    expect(ctx.components.list({ kind: 'plugin' })).toEqual([])
  })

  it('registers its empty invariant companion', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(invariantCompanion)).resolves.toBeDefined()
  })
})

describe('@deepseek-ai/dsh-components-packages over the dynamic runner', () => {
  async function dynamicHarness(): Promise<{
    ctx: Context
    agent: Agent
    scope: Scope
    fiber: Awaited<ReturnType<Context['plugin']>>
  }> {
    const { ctx, fiber } = await harness()
    await ctx.plugin(DynamicCordisRunner, {})
    const { scope, agent } = await mintAgent(ctx, 'dynamic-session')
    ctx.reflect.provide('agents', { get: (id: SessionId) => id === agent.id ? agent : undefined })
    return { ctx, agent, scope, fiber }
  }

  it('marks a live activation as synthesized in the mounting agent own layer', async () => {
    const { ctx, agent } = await dynamicHarness()
    const pluginId = await mount(ctx, agent, 'probe', HOST_CODE)

    const component = ctx.components.get(dynamicPackageComponentId(pluginId), { scope: agent })
    expect(component).toMatchObject({
      kind: 'dynamic-package',
      name: 'probe',
      provenance: 'synthesized',
      digestBasis: 'content',
      layer: 'agent',
      owner: '@deepseek-ai/dsh-components-packages',
    })
    // Synthesized code is named in the session that wrote it, not globally.
    expect(ctx.components.list({ kind: 'dynamic-package' })).toEqual([])
    // The reading above asserted the kind, so the detail is this kind's.
    const detail = component?.detail as DynamicPackageComponentDetail | undefined
    if (detail === undefined) throw new Error('expected the mirrored package identity')
    expect(component?.digest).toBe(dynamicPackageDigest(pluginId, detail.packageId, HOST_CODE, null))
  })

  it('re-addresses a corrected package and drops the component when the run stops', async () => {
    const { ctx, agent } = await dynamicHarness()
    const pluginId = await mount(ctx, agent, 'probe', HOST_CODE)
    const first = ctx.components.get(dynamicPackageComponentId(pluginId), { scope: agent })?.digest

    const corrected = ctx.dynamicCordisRunner.define({
      sessionId: agent.id,
      plugin: { kind: 'existing', pluginId },
      name: 'probe',
      purpose: 'corrected',
      code: { host: `${HOST_CODE}\n// corrected` },
    })
    const updated = await ctx.dynamicCordisRunner.run(agent, pluginId, corrected.packageId, 'update')
    if (!updated.ok) throw new Error(updated.message)
    expect(ctx.components.get(dynamicPackageComponentId(pluginId), { scope: agent })?.digest).not.toBe(first)

    await ctx.dynamicCordisRunner.stop(agent, pluginId)
    expect(ctx.components.get(dynamicPackageComponentId(pluginId), { scope: agent })).toBeUndefined()
  })

  it('addresses a client-only package by its client half alone', async () => {
    const { ctx, agent } = await dynamicHarness()
    const clientCode = 'return { name: "panel", apply() {} }'
    const { pluginId, packageId } = ctx.dynamicCordisRunner.define({
      sessionId: agent.id,
      plugin: { kind: 'new', idPrefix: 'dyn' },
      name: 'panel',
      purpose: 'spec fixture',
      code: { client: clientCode },
    })
    // Stand in for the page: approve the request, then report the activation.
    let requestId: ApprovalRequestId | undefined
    ctx.on('cordis/request-run', (request) => { requestId = request.requestId })
    const pending = await ctx.dynamicCordisRunner.run(agent, pluginId, packageId, 'run')
    expect(pending).toMatchObject({ ok: true, status: 'awaiting-approval' })
    if (requestId === undefined) throw new Error('expected an activation request')
    const half = await ctx.dynamicCordisRunner.runHostHalf(agent, pluginId, packageId, 'run', requestId, false)
    if (!half.ok) throw new Error(half.message)
    await ctx.dynamicCordisRunner.resolveRequestRun(requestId, { ok: true, pluginRunId: half.pluginRunId })

    expect(ctx.components.get(dynamicPackageComponentId(pluginId), { scope: agent })?.digest)
      .toBe(dynamicPackageDigest(pluginId, packageId, null, clientCode))
  })

  it('prunes only the notifying session own activations', async () => {
    const { ctx } = await harness()
    await ctx.plugin(DynamicCordisRunner, {})
    const first = await mintAgent(ctx, 'first-session')
    const second = await mintAgent(ctx, 'second-session')
    const byId = new Map([[first.agent.id, first.agent], [second.agent.id, second.agent]])
    ctx.reflect.provide('agents', { get: (id: SessionId) => byId.get(id) })

    const firstPlugin = await mount(ctx, first.agent, 'first-probe', HOST_CODE)
    const secondPlugin = await mount(ctx, second.agent, 'second-probe', 'return { name: "second", apply() {} }')
    expect(ctx.components.get(dynamicPackageComponentId(firstPlugin), { scope: first.agent })).toBeDefined()
    expect(ctx.components.get(dynamicPackageComponentId(secondPlugin), { scope: second.agent })).toBeDefined()

    // Stopping one session's package answers for that session alone.
    await ctx.dynamicCordisRunner.stop(first.agent, firstPlugin)
    expect(ctx.components.get(dynamicPackageComponentId(firstPlugin), { scope: first.agent })).toBeUndefined()
    expect(ctx.components.get(dynamicPackageComponentId(secondPlugin), { scope: second.agent })).toBeDefined()
  })

  it('reports a session whose service isolate cannot reach the component registry', async () => {
    const { ctx } = await harness()
    await ctx.plugin(DynamicCordisRunner, {})
    // An agent context outside the registry's isolate: nothing it mounts can be
    // named, and the adapter says so instead of filing the descriptor elsewhere.
    const agent = {
      id: SessionId('isolated-session'),
      ctx: new Context(),
      steer: () => {},
      inject: () => {},
    } as unknown as Agent
    ctx.reflect.provide('agents', { get: (id: SessionId) => id === agent.id ? agent : undefined })
    const warnings: string[] = []
    ctx.logger.warn = (message: unknown) => { warnings.push(String(message)) }

    await mount(ctx, agent, 'probe', HOST_CODE)
    expect(warnings.some(entry => entry.includes('isolated-session'))).toBe(true)
    expect(ctx.components.list({ kind: 'dynamic-package' })).toEqual([])
  })

  it('keeps a defined but unstarted package out of the inventory', async () => {
    const { ctx, agent } = await dynamicHarness()
    ctx.dynamicCordisRunner.define({
      sessionId: agent.id,
      plugin: { kind: 'new', idPrefix: 'dyn' },
      name: 'unstarted',
      purpose: 'spec fixture',
      code: { host: HOST_CODE },
    })
    expect(ctx.components.list({ kind: 'dynamic-package', scope: agent })).toEqual([])
  })

  it('removes a mirrored activation when the adapter fiber is disposed', async () => {
    const { ctx, agent, fiber } = await dynamicHarness()
    await mount(ctx, agent, 'probe', HOST_CODE)
    expect(ctx.components.list({ kind: 'dynamic-package', scope: agent })).toHaveLength(1)
    await fiber.dispose()
    expect(ctx.components.list({ kind: 'dynamic-package', scope: agent })).toEqual([])
  })
})
