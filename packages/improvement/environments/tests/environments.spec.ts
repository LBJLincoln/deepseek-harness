import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import SessionStore from '@deepseek-ai/dsh-session'
import { CheckCaseId, checkCasesRef, CheckId } from '@deepseek-ai/dsh-verification'
import type { AuthoredCheck, CheckCase } from '@deepseek-ai/dsh-verification'
import EnvironmentRegistry, {
  decodeEnvironmentRun,
  ENVIRONMENT_RUN_VERSION,
  environmentContentHashes,
  EnvironmentError,
  EnvironmentId,
  isSeed,
} from '@deepseek-ai/dsh-environments'
import type { Config, EnvironmentDefinition, EnvironmentRunStamp } from '@deepseek-ai/dsh-environments'
import * as invariantCompanion from '@deepseek-ai/dsh-environments/invariant'

declare module '@deepseek-ai/dsh-environments/types' {
  interface EnvironmentKindMap {
    'swe-task': { readonly repository: string }
    'terminal-task': { readonly image: string }
  }
}

async function harness(config: Config = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(EnvironmentRegistry, config)
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

  it('accepts a normalized workspace-relative immutable set and rejects every other form', async () => {
    const ctx = await harness()
    const immutable = (paths: string[], id = 'swe-task:immutable') =>
      sweTask(id, { task: { prompt: 'Fix it.', fixture: 'fixtures/immutable', immutable: paths } })
    ctx.environments.register(immutable(['tests/suite.spec.ts', 'reference', 'a.b~c']))
    expect(ctx.environments.get(EnvironmentId('swe-task:immutable'))?.task.immutable)
      .toEqual(['tests/suite.spec.ts', 'reference', 'a.b~c'])

    for (const [paths, reason] of [
      [[''], 'that is empty'],
      [['/etc/passwd'], 'that is not workspace-relative'],
      [['C:/checks'], 'that is not workspace-relative'],
      [['tests\\suite.spec.ts'], 'that uses a backslash'],
      [['tests//suite.spec.ts'], 'it holds an empty segment'],
      [['./tests'], 'it holds a "." segment'],
      [['../tests'], 'it holds a ".." segment'],
      [['tests', 'tests'], 'twice'],
    ] as const) {
      expect(() => ctx.environments.register(immutable([...paths], 'swe-task:rejected')))
        .toThrow(expect.objectContaining({ code: 'ENVIRONMENT_INVALID_IMMUTABLE', message: expect.stringContaining(reason) as unknown as string }))
    }
    expect(ctx.environments.get(EnvironmentId('swe-task:rejected'))).toBeUndefined()
  })

  it('detaches the immutable set on write and on every read', async () => {
    const ctx = await harness()
    const paths = ['tests/suite.spec.ts']
    ctx.environments.register(sweTask('swe-task:alpha', { task: { prompt: 'Fix it.', immutable: paths } }))
    paths.push('reference')
    const read = ctx.environments.get(EnvironmentId('swe-task:alpha'))
    expect(read?.task.immutable).toEqual(['tests/suite.spec.ts'])
    ;(read?.task.immutable as string[]).push('mutated')
    expect(ctx.environments.list()[0]?.task.immutable).toEqual(['tests/suite.spec.ts'])
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

describe('near-duplicate admission', () => {
  /** 13 words, so the prompt shingles into exactly nine word 5-grams. */
  const HELD_OUT_PROMPT = 'Fix the failing unit test in the parser module and make it pass.'
  /** The same 13 words with the last one replaced: one shingle differs, so the similarity is 8/10. */
  const RESTATED_PROMPT = 'Fix the failing unit test in the parser module and make it green.'

  function task(id: string, prompt: string, heldOut: boolean): EnvironmentDefinition<'swe-task'> {
    return sweTask(id, { task: { prompt }, heldOut })
  }

  it('registers a pair just below the threshold and refuses it at the threshold', async () => {
    const admitting = await harness({ nearDuplicate: { threshold: 0.81 } })
    admitting.environments.register(task('swe-task:held-out', HELD_OUT_PROMPT, true))
    admitting.environments.register(task('swe-task:restated', RESTATED_PROMPT, false))
    expect(admitting.environments.list()).toHaveLength(2)

    const refusing = await harness({ nearDuplicate: { threshold: 0.8 } })
    refusing.environments.register(task('swe-task:held-out', HELD_OUT_PROMPT, true))
    expect(() => refusing.environments.register(task('swe-task:restated', RESTATED_PROMPT, false)))
      .toThrow(expect.objectContaining({
        code: 'ENVIRONMENT_NEAR_DUPLICATE',
        message: 'environment "swe-task:restated" near-duplicates held-out environment "swe-task:held-out": word 5-gram Jaccard similarity 0.8 reaches the 0.8 admission threshold',
      }))
    expect(refusing.environments.get(EnvironmentId('swe-task:restated'))).toBeUndefined()
  })

  it('refuses a held-out environment that restates a registered training-eligible one', async () => {
    const ctx = await harness({ nearDuplicate: { threshold: 0.8 } })
    ctx.environments.register(task('swe-task:training', HELD_OUT_PROMPT, false))
    expect(() => ctx.environments.register(task('swe-task:late-held-out', RESTATED_PROMPT, true)))
      .toThrow(expect.objectContaining({
        code: 'ENVIRONMENT_NEAR_DUPLICATE',
        message: 'environment "swe-task:late-held-out" near-duplicates training-eligible environment "swe-task:training": word 5-gram Jaccard similarity 0.8 reaches the 0.8 admission threshold',
      }))
  })

  it('admits an unrelated prompt, and admits everything when no threshold is configured', async () => {
    const ctx = await harness({ nearDuplicate: { threshold: 0.8 } })
    ctx.environments.register(task('swe-task:held-out', HELD_OUT_PROMPT, true))
    ctx.environments.register(task('swe-task:unrelated', 'Package the release notes for the next tag.', false))
    // Nothing is registered on the opposite side of the first held-out entry.
    ctx.environments.register(task('swe-task:second-held-out', 'Profile the allocator and cut its peak resident set.', true))
    expect(ctx.environments.list()).toHaveLength(3)

    const open = await harness()
    open.environments.register(task('swe-task:held-out', HELD_OUT_PROMPT, true))
    open.environments.register(task('swe-task:restated', RESTATED_PROMPT, false))
    expect(open.environments.list()).toHaveLength(2)
  })

  it('normalizes case and punctuation, and treats a sub-shingle prompt as one shingle', async () => {
    const ctx = await harness({ nearDuplicate: { threshold: 1 } })
    ctx.environments.register(task('swe-task:held-out', HELD_OUT_PROMPT, true))
    expect(() => ctx.environments.register(task('swe-task:respaced', '  FIX -- the failing, unit test; in the parser module (and) make it pass!  ', false)))
      .toThrow(expect.objectContaining({ code: 'ENVIRONMENT_NEAR_DUPLICATE', message: expect.stringContaining('similarity 1 ') as unknown as string }))

    const short = await harness({ nearDuplicate: { threshold: 1 } })
    short.environments.register(task('swe-task:short-held-out', 'Ship it.', true))
    short.environments.register(task('swe-task:short-other', 'Ship them.', false))
    expect(() => short.environments.register(task('swe-task:short-same', 'ship IT!', false)))
      .toThrow(expect.objectContaining({ code: 'ENVIRONMENT_NEAR_DUPLICATE' }))

    // Two promptless environments are identical rather than incomparable.
    const empty = await harness({ nearDuplicate: { threshold: 1 } })
    empty.environments.register(task('swe-task:empty-held-out', '', true))
    expect(() => empty.environments.register(task('swe-task:empty-other', '   ', false)))
      .toThrow(expect.objectContaining({ code: 'ENVIRONMENT_NEAR_DUPLICATE' }))
  })

  it('reports the nearest held-out environment for a curator, threshold or not', async () => {
    const ctx = await harness()
    expect(ctx.environments.nearestHeldOut(HELD_OUT_PROMPT)).toBeUndefined()
    ctx.environments.register(task('swe-task:far', 'Package the release notes for the next tag.', true))
    ctx.environments.register(task('swe-task:near', HELD_OUT_PROMPT, true))
    ctx.environments.register(task('swe-task:training', RESTATED_PROMPT, false))
    expect(ctx.environments.nearestHeldOut(RESTATED_PROMPT))
      .toEqual({ environment: 'swe-task:near', similarity: 0.8 })
    // Registration order does not decide the answer; the highest similarity does.
    expect(ctx.environments.nearestHeldOut('Package the release notes for the next tag.'))
      .toEqual({ environment: 'swe-task:far', similarity: 1 })
  })
})

describe('environment run stamps', () => {
  const HEX = 'a'.repeat(64)
  function stamp(rest: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      kind: 'environment/run',
      version: ENVIRONMENT_RUN_VERSION,
      environmentId: 'swe-task:alpha',
      environmentKind: 'swe-task',
      heldOut: false,
      promptSha256: HEX,
      checksSha256: HEX,
      contentSha256: HEX,
      repetition: 0,
      model: { provider: 'cli-mock', model: 'cli-mock' },
      isolation: 'none',
      ...rest,
    }
  }

  it('hashes prompt, checks, and fixture deterministically and keys the content on all three', () => {
    const definition = sweTask('swe-task:alpha')
    const bare = environmentContentHashes(definition)
    expect(bare).toEqual(environmentContentHashes(sweTask('swe-task:alpha')))
    expect(bare.fixtureSha256).toBeUndefined()
    expect(bare.promptSha256).toMatch(/^[0-9a-f]{64}$/)
    const withFixture = environmentContentHashes(definition, HEX)
    expect(withFixture.fixtureSha256).toBe(HEX)
    expect(withFixture.promptSha256).toBe(bare.promptSha256)
    expect(withFixture.checksSha256).toBe(bare.checksSha256)
    expect(withFixture.contentSha256).not.toBe(bare.contentSha256)
    const otherChecks = environmentContentHashes(sweTask('swe-task:alpha', {
      checks: [{ id: CheckId('tests-pass'), outcome: 'the suite passes', run: 'pnpm test -- --changed' }],
    }))
    expect(otherChecks.checksSha256).not.toBe(bare.checksSha256)
  })

  it('covers case bodies and tree scopes, so changing one case changes the key', () => {
    const caseBodies: CheckCase[] = [{
      id: CheckCaseId('reverse-empty'),
      weight: 2,
      input: { argv: [] },
      expected: { stdoutSha256: 'a'.repeat(64) },
      comparator: { channels: ['stdout'], normalizers: ['crlf'] },
    }]
    const cased = (bodies: readonly CheckCase[], rest: Partial<AuthoredCheck> = {}): EnvironmentDefinition<'swe-task'> =>
      sweTask('swe-task:alpha', {
        checks: [{
          id: CheckId('tests-pass'),
          outcome: 'the suite passes',
          run: 'pnpm test',
          cases: checkCasesRef(bodies),
          caseBodies: bodies,
          ...rest,
        }],
      })
    const caseless = environmentContentHashes(sweTask('swe-task:alpha', {
      checks: [{ id: CheckId('tests-pass'), outcome: 'the suite passes', run: 'pnpm test' }],
    }))
    const withCases = environmentContentHashes(cased(caseBodies))
    expect(withCases.checksSha256).not.toBe(caseless.checksSha256)
    expect(withCases.checksSha256).toBe(environmentContentHashes(cased(caseBodies)).checksSha256)
    const changed = environmentContentHashes(cased([{ ...caseBodies[0] as CheckCase, weight: 3 }]))
    expect(changed.checksSha256).not.toBe(withCases.checksSha256)
    // A registry entry is hashed as it stands; authorship, not registration,
    // is where a reference without bodies is refused.
    const referenceOnly = environmentContentHashes(sweTask('swe-task:alpha', {
      checks: [{ id: CheckId('tests-pass'), outcome: 'the suite passes', run: 'pnpm test', cases: checkCasesRef(caseBodies) }],
    }))
    expect(referenceOnly.checksSha256).not.toBe(withCases.checksSha256)
    const bodiesOnly = environmentContentHashes(sweTask('swe-task:alpha', {
      checks: [{ id: CheckId('tests-pass'), outcome: 'the suite passes', run: 'pnpm test', caseBodies }],
    }))
    expect(bodiesOnly.checksSha256).not.toBe(referenceOnly.checksSha256)
    expect(environmentContentHashes(cased(caseBodies, { treeScope: 'out' })).checksSha256)
      .not.toBe(withCases.checksSha256)
  })

  it('detaches the case bodies it stores', async () => {
    const ctx = await harness()
    const caseBodies: CheckCase[] = [{
      id: CheckCaseId('reverse-empty'),
      weight: 1,
      input: { argv: [] },
      expected: { exitCode: 0 },
      comparator: { channels: ['exit'], normalizers: [] },
    }]
    ctx.environments.register(sweTask('swe-task:cased', {
      checks: [{
        id: CheckId('tests-pass'),
        outcome: 'the suite passes',
        run: 'pnpm test',
        cases: checkCasesRef(caseBodies),
        caseBodies,
      }],
    }))
    const stored = ctx.environments.get(EnvironmentId('swe-task:cased'))
    expect(stored?.checks[0]?.caseBodies).toEqual(caseBodies)
    expect(stored?.checks[0]?.caseBodies).not.toBe(caseBodies)
  })

  it('decodes a complete stamp, leaves unrelated values alone, and keeps optional fields exact', () => {
    const decoded = decodeEnvironmentRun(stamp({
      fixtureSha256: HEX, group: 'batch-7', district: 'workshop', heldOut: true, repetition: 3,
      policyVersion: 'policy-2026-09', seed: 0,
    }))
    expect(decoded).toEqual<EnvironmentRunStamp>({
      kind: 'environment/run',
      version: 1,
      environmentId: EnvironmentId('swe-task:alpha'),
      environmentKind: 'swe-task',
      heldOut: true,
      promptSha256: HEX,
      checksSha256: HEX,
      fixtureSha256: HEX,
      contentSha256: HEX,
      repetition: 3,
      group: 'batch-7',
      district: 'workshop',
      policyVersion: 'policy-2026-09',
      seed: 0,
      model: { provider: 'cli-mock', model: 'cli-mock' },
      isolation: 'none',
    })
    expect(decodeEnvironmentRun(stamp())).not.toHaveProperty('fixtureSha256')
    expect(decodeEnvironmentRun(stamp())).not.toHaveProperty('group')
    expect(decodeEnvironmentRun(stamp())).not.toHaveProperty('district')
    expect(decodeEnvironmentRun(stamp())).not.toHaveProperty('policyVersion')
    expect(decodeEnvironmentRun(stamp())).not.toHaveProperty('seed')
    expect(decodeEnvironmentRun({ kind: 'goal/change' })).toBeUndefined()
    expect(decodeEnvironmentRun('environment/run')).toBeUndefined()
    expect(decodeEnvironmentRun([stamp()])).toBeUndefined()
  })

  it('accepts a seed a provider could have been asked for and rejects every other value', () => {
    expect(isSeed(0)).toBe(true)
    expect(isSeed(Number.MAX_SAFE_INTEGER)).toBe(true)
    expect(isSeed(-1)).toBe(false)
    expect(isSeed(1.5)).toBe(false)
    expect(isSeed(Number.MAX_SAFE_INTEGER + 2)).toBe(false)
    expect(isSeed(Number.NaN)).toBe(false)
    expect(isSeed('7')).toBe(false)
  })

  it('fails replay loudly on a malformed stamp', () => {
    const cases: [Record<string, unknown>, string][] = [
      [stamp({ version: 2 }), 'unsupported environment/run version 2'],
      [stamp({ heldOut: 'no' }), 'heldOut must be a boolean'],
      [stamp({ repetition: -1 }), 'repetition must be a non-negative integer'],
      [stamp({ repetition: 1.5 }), 'repetition must be a non-negative integer'],
      [stamp({ model: 'cli-mock' }), 'model must be a record'],
      [stamp({ model: { provider: 'cli-mock' } }), 'model must be a non-empty string'],
      [stamp({ isolation: 'shared' }), 'isolation must be none, process, or host'],
      [stamp({ environmentId: '' }), 'environmentId must be a non-empty string'],
      [stamp({ promptSha256: 'xyz' }), 'promptSha256 must be a SHA-256 hex digest'],
      [stamp({ fixtureSha256: 12 }), 'fixtureSha256 must be a non-empty string'],
      [stamp({ group: '' }), 'group must be a non-empty string'],
      [stamp({ district: 7 }), 'district must be a non-empty string'],
      [stamp({ policyVersion: '' }), 'policyVersion must be a non-empty string'],
      [stamp({ seed: -1 }), 'seed must be a non-negative integer'],
      [stamp({ seed: '7' }), 'seed must be a non-negative integer'],
    ]
    for (const [value, message] of cases) {
      expect(() => decodeEnvironmentRun(value), message).toThrow(message)
    }
  })
})
