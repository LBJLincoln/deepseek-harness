import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentPresets, { livePresetMounts } from '@deepseek-ai/dsh-agent-presets'
import ComponentRegistry, { componentDigest } from '@deepseek-ai/dsh-components'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as adapter from '@deepseek-ai/dsh-components-presets'
import { presetComponentId, presetDigest } from '@deepseek-ai/dsh-components-presets'
import * as invariantCompanion from '@deepseek-ai/dsh-components-presets/invariant'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const ROOTS = [
  { path: join(FIXTURES, 'system'), trust: 'system' as const },
  { path: join(FIXTURES, 'user'), trust: 'user' as const },
]

/** The composition rows the shipped `alpha` fixture preset holds, restated so the digest can be recomputed here. */
const ALPHA_ROWS = [
  ['alpha-section', '../../plugins/contribute.js', { section: 'alpha' }, false],
  ['alpha-extra', '../../plugins/contribute.js', { section: 'alpha-extra' }, true],
]

async function harness(roots: { path: string; trust: 'system' | 'user' }[] = ROOTS): Promise<Context> {
  const ctx = new Context()
  ctx.baseUrl = `${pathToFileURL(FIXTURES).href}/`
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(AgentPresets, { default: 'alpha', roots, includeUserRoot: false })
  await ctx.plugin(ComponentRegistry)
  return ctx
}

/** Create one agent composed from `presetId`, exactly as a factory `setup` would. */
async function agentOn(ctx: Context, id: string, presetId?: string): Promise<Agent> {
  const handle = await ctx.agents.create({
    sessionId: SessionId(id),
    setup: async (agentCtx: Context) => void await ctx.agentPresets.mount(agentCtx, presetId),
  })
  return handle.agent
}

let ctx: Context
beforeEach(async () => {
  ctx = await harness()
})
// Standing mounts are process-global and pruned by observation, so a runtime
// left alive would keep serving its mounts to the next test's reconcile.
afterEach(async () => {
  await ctx.fiber.dispose()
})

describe('@deepseek-ai/dsh-components-presets', () => {
  it('mirrors a standing mount once the first agent joins it', async () => {
    await ctx.plugin(adapter)
    expect(adapter.name).toBe('components-presets')
    expect(adapter.inject).toEqual(['components', 'agentPresets'])
    expect(ctx.components.list({ kind: 'preset' })).toHaveLength(0)

    await agentOn(ctx, 'session-alpha', 'alpha')
    expect(ctx.components.get(presetComponentId('alpha'))).toMatchObject({
      kind: 'preset',
      name: 'alpha',
      owner: '@deepseek-ai/dsh-components-presets',
      provenance: 'curated',
      digestBasis: 'content',
      layer: 'global',
      description: 'Agent preset "alpha" of system trust, composing 2 row(s) that every agent joined to it runs on.',
      detail: { trust: 'system', rows: 2 },
    })
    // A preset is not callable, so it carries no invoke pointer.
    expect(ctx.components.get(presetComponentId('alpha'))?.invoke).toBeUndefined()
  })

  it('addresses a preset by the resolved rows this adapter owns', async () => {
    await ctx.plugin(adapter)
    await agentOn(ctx, 'session-alpha', 'alpha')
    const mount = livePresetMounts().find(candidate => candidate.presetId === 'alpha')
    if (mount === undefined) throw new Error('expected the alpha preset to be mounted')
    expect(ctx.components.get(presetComponentId('alpha'))?.digest).toBe(presetDigest(mount))
    expect(presetDigest(mount)).toBe(componentDigest('preset', ['alpha', 'system', ALPHA_ROWS]))
    // Two presets whose rows differ address differently.
    await agentOn(ctx, 'session-beta', 'beta')
    expect(ctx.components.get(presetComponentId('beta'))?.digest)
      .not.toBe(ctx.components.get(presetComponentId('alpha'))?.digest)
  })

  it('records a locally authored preset as synthesized', async () => {
    await ctx.plugin(adapter)
    await agentOn(ctx, 'session-beta', 'beta')
    expect(ctx.components.get(presetComponentId('beta'))).toMatchObject({
      provenance: 'synthesized',
      detail: { trust: 'user', rows: 1 },
    })
  })

  it('mirrors a mount already standing when the adapter loads and keeps it across joins', async () => {
    await agentOn(ctx, 'session-alpha', 'alpha')
    await ctx.plugin(adapter)
    const first = ctx.components.get(presetComponentId('alpha'))
    expect(first).toBeDefined()
    // A second agent on the same standing composition changes nothing.
    await agentOn(ctx, 'session-alpha-2', 'alpha')
    expect(ctx.components.list({ kind: 'preset' })).toHaveLength(1)
    expect(ctx.components.get(presetComponentId('alpha'))?.digest).toBe(first?.digest)
  })

  it('drops a component when the mounted subtree is disposed', async () => {
    await ctx.plugin(adapter)
    const agent = await agentOn(ctx, 'session-alpha', 'alpha')
    const mount = livePresetMounts().find(candidate => candidate.presetId === 'alpha')
    if (mount === undefined) throw new Error('expected the alpha preset to be mounted')
    await mount.fiber.dispose()
    // The roster reports a torn-down mount by pruning it from the live reading,
    // so the next reconcile is what removes the component.
    ctx.emit('agent-preset/selected', agent.session.id, 'alpha')
    expect(ctx.components.get(presetComponentId('alpha'))).toBeUndefined()
  })

  it('rewrites a host path in a row name and pools a row that carries no config', async () => {
    const root = await mkdtemp(join(tmpdir(), 'components-presets-'))
    try {
      const directory = join(root, 'gamma')
      await mkdir(directory, { recursive: true })
      const rowPath = join(directory, 'inert.js')
      await copyFile(join(FIXTURES, 'plugins', 'inert.js'), rowPath)
      // An absolute row name is the one specifier whose text differs per host.
      await writeFile(join(directory, 'agent.cordis.yml'), `- id: absolute-row\n  name: ${JSON.stringify(rowPath)}\n`)

      const local = await harness([{ path: root, trust: 'system' as const }])
      try {
        await local.plugin(adapter)
        await agentOn(local, 'session-gamma', 'gamma')
        expect(local.components.get(presetComponentId('gamma'))?.digest)
          .toBe(componentDigest('preset', ['gamma', 'system', [['absolute-row', 'inert.js', null, false]]]))
      } finally {
        await local.fiber.dispose()
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('removes every mirrored component when the adapter fiber is disposed', async () => {
    const fiber = await ctx.plugin(adapter)
    await agentOn(ctx, 'session-alpha', 'alpha')
    expect(ctx.components.list({ kind: 'preset' })).toHaveLength(1)
    await fiber.dispose()
    expect(ctx.components.list({ kind: 'preset' })).toHaveLength(0)
  })

  it('registers its empty invariant companion', async () => {
    const bare = new Context()
    await bare.plugin(SessionStore)
    await bare.plugin(InvariantRegistry, { enabled: true })
    await expect(bare.plugin(invariantCompanion)).resolves.toBeDefined()
  })
})
