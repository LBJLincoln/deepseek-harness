import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import SessionStore from '@deepseek-ai/dsh-session'
import { CheckId } from '@deepseek-ai/dsh-verification'
import EnvironmentRegistry, { EnvironmentError, EnvironmentId } from '@deepseek-ai/dsh-environments'
import type { EnvironmentDefinition } from '@deepseek-ai/dsh-environments'
import * as invariantCompanion from '@deepseek-ai/dsh-environments/invariant'

declare module '@deepseek-ai/dsh-environments/types' {
  interface EnvironmentKindMap {
    'swe-task': { readonly repository: string }
    'terminal-task': { readonly image: string }
  }
}

async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(EnvironmentRegistry)
  return ctx
}

function sweTask(id: string, rest: Partial<EnvironmentDefinition<'swe-task'>> = {}): EnvironmentDefinition<'swe-task'> {
  return {
    id: EnvironmentId(id),
    kind: 'swe-task',
    name: id,
    description: `resolve ${id}`,
    task: { prompt: `Fix the failing test in ${id}.`, fixture: `fixtures/${id}` },
    checks: [
      { id: CheckId('tests-pass'), outcome: 'the suite passes', run: 'pnpm test' },
      { id: CheckId('lint-clean'), outcome: 'lint reports nothing', run: 'pnpm lint' },
    ],
    heldOut: false,
    owner: '@deepseek-ai/dsh-environments-tests',
    provenance: 'curated',
    detail: { repository: `org/${id}` },
    ...rest,
  }
}

describe('EnvironmentRegistry', () => {
  it('registers, reads, lists in registration order, and filters by kind and held-out status', async () => {
    const ctx = await harness()
    ctx.environments.register(sweTask('swe-task:alpha'))
    ctx.environments.register({
      id: EnvironmentId('terminal-task:gamma'),
      kind: 'terminal-task',
      name: 'gamma',
      description: 'compile the kernel module',
      task: { prompt: 'Build the module.' },
      checks: [{ id: CheckId('builds'), outcome: 'make exits 0', run: 'make' }],
      heldOut: true,
      owner: '@deepseek-ai/dsh-environments-tests',
      provenance: 'synthesized',
      lineage: EnvironmentId('swe-task:alpha'),
      detail: { image: 'ubuntu:24.04' },
    })
    ctx.environments.register(sweTask('swe-task:beta', { heldOut: true }))
    expect(ctx.environments.list().map(environment => environment.id)).toEqual([
      'swe-task:alpha', 'terminal-task:gamma', 'swe-task:beta',
    ])
    expect(ctx.environments.list({ kind: 'swe-task' }).map(environment => environment.id)).toEqual(['swe-task:alpha', 'swe-task:beta'])
    expect(ctx.environments.list({ heldOut: true }).map(environment => environment.id)).toEqual(['terminal-task:gamma', 'swe-task:beta'])
    expect(ctx.environments.list({ kind: 'swe-task', heldOut: false }).map(environment => environment.id)).toEqual(['swe-task:alpha'])
    expect(ctx.environments.get(EnvironmentId('terminal-task:gamma'))).toMatchObject({
      kind: 'terminal-task',
      provenance: 'synthesized',
      lineage: 'swe-task:alpha',
      detail: { image: 'ubuntu:24.04' },
    })
    expect(ctx.environments.get(EnvironmentId('missing'))).toBeUndefined()
  })

  it('rejects a duplicate id, an empty check list, and a repeated check id loudly', async () => {
    const ctx = await harness()
    ctx.environments.register(sweTask('swe-task:alpha'))
    expect(() => ctx.environments.register(sweTask('swe-task:alpha')))
      .toThrow(expect.objectContaining({ code: 'ENVIRONMENT_DUPLICATE_ID' }))
    expect(() => ctx.environments.register(sweTask('swe-task:empty', { checks: [] })))
      .toThrow(expect.objectContaining({ code: 'ENVIRONMENT_NO_CHECKS' }))
    const twice = { id: CheckId('tests-pass'), outcome: 'again', run: 'pnpm test' }
    expect(() => ctx.environments.register(sweTask('swe-task:twice', { checks: [twice, twice] })))
      .toThrow(expect.objectContaining({ code: 'ENVIRONMENT_DUPLICATE_CHECK' }))
    try {
      ctx.environments.register(sweTask('swe-task:alpha'))
      throw new Error('expected a rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(EnvironmentError)
    }
    expect(ctx.environments.list()).toHaveLength(1)
  })

  it('removes an environment through its exact disposer and ignores a stale one', async () => {
    const ctx = await harness()
    const first = ctx.environments.register(sweTask('swe-task:alpha'))
    first()
    expect(ctx.environments.get(EnvironmentId('swe-task:alpha'))).toBeUndefined()
    ctx.environments.register(sweTask('swe-task:alpha', { description: 'second registration' }))
    first()
    expect(ctx.environments.get(EnvironmentId('swe-task:alpha'))?.description).toBe('second registration')
  })

  it('detaches check lists on write and on every read', async () => {
    const ctx = await harness()
    const definition = sweTask('swe-task:alpha')
    const checks = [...definition.checks]
    ctx.environments.register({ ...definition, checks })
    checks.push({ id: CheckId('late'), outcome: 'late', run: 'late' })
    const read = ctx.environments.get(EnvironmentId('swe-task:alpha'))
    expect(read?.checks.map(check => check.id)).toEqual(['tests-pass', 'lint-clean'])
    ;(read?.checks as unknown as { id: string }[]).push({ id: 'mutated' })
    expect(ctx.environments.get(EnvironmentId('swe-task:alpha'))?.checks).toHaveLength(2)
    expect(ctx.environments.list()[0]?.checks).toHaveLength(2)
  })

  it('registers its empty invariant companion', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(invariantCompanion)).resolves.toBeDefined()
  })
})
