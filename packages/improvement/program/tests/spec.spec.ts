/**
 * The frozen spec: what a program's identity covers, what it deliberately does
 * not, the rules a spec must satisfy before any department starts, and the
 * dependency order the integration merges in.
 */

import { describe, expect, it } from 'vitest'
import type { CheckId } from '@deepseek-ai/dsh-verification/types'
import {
  dependencyOrder,
  INTEGRATION_KEY,
  integrationChecks,
  ProgramError,
  ProgramId,
  programIdFor,
  PROGRAM_ID_PREFIX,
  programSpecDigest,
  resolveProgramSpec,
} from '@deepseek-ai/dsh-program'
import type { ProgramGoalSpec, ProgramSpec } from '@deepseek-ai/dsh-program'

/** One goal with every field a program requires. */
function goal(overrides: Partial<ProgramGoalSpec> = {}): ProgramGoalSpec {
  return {
    key: 'api',
    objective: 'deliver the api',
    preset: 'implementing',
    isolation: 'none',
    budget: { maxTotalTokens: 1_000 },
    dependsOn: [],
    checks: [{ id: 'api-builds' as CheckId, outcome: 'the api builds', run: 'check-api' }],
    ...overrides,
  }
}

/** One well-formed spec with the goals a case needs. */
function spec(goals: readonly ProgramGoalSpec[] = [goal()], overrides: Partial<ProgramSpec> = {}): ProgramSpec {
  return {
    objective: 'ship the release',
    baseRevision: 'base',
    goals,
    integration: {
      checks: [{ id: 'merged-builds' as CheckId, outcome: 'the merged head builds', run: 'check-merged' }],
      gates: ['run-lint'],
    },
    ...overrides,
  }
}

describe('resolveProgramSpec', () => {
  it('accepts a spec whose keys, dependencies, budgets, and checks hold', () => {
    const frozen = resolveProgramSpec(spec([goal(), goal({ key: 'docs', dependsOn: ['api'] })]))
    expect(frozen.goals.map(entry => entry.key)).toEqual(['api', 'docs'])
  })

  it('refuses a program with no goal', () => {
    expect(() => resolveProgramSpec(spec([])))
      .toThrow(expect.objectContaining<Partial<ProgramError>>({ code: 'PROGRAM_INVALID_SPEC' }))
    expect(() => resolveProgramSpec(spec([]))).toThrow('a program declares at least one goal')
  })

  it('refuses a key that is not lower-kebab-case, and one declared twice', () => {
    expect(() => resolveProgramSpec(spec([goal({ key: 'Api' })])))
      .toThrow('goal key "Api" must be lower-kebab-case')
    expect(() => resolveProgramSpec(spec([goal(), goal()])))
      .toThrow('goal key "api" is declared twice')
  })

  it('refuses a dependency on itself, on an unknown key, or stated twice', () => {
    expect(() => resolveProgramSpec(spec([goal({ dependsOn: ['api'] })])))
      .toThrow('goal "api" depends on itself')
    expect(() => resolveProgramSpec(spec([goal({ dependsOn: ['ui'] })])))
      .toThrow('goal "api" depends on "ui", which the program does not declare')
    expect(() => resolveProgramSpec(spec([goal(), goal({ key: 'docs', dependsOn: ['api', 'api'] })])))
      .toThrow('goal "docs" depends on "api" twice')
  })

  it('refuses a budget field that cannot express a ceiling', () => {
    expect(() => resolveProgramSpec(spec([goal({ budget: { maxTotalTokens: -1 } })])))
      .toThrow('goal "api" budget maxTotalTokens must be a finite non-negative number, got -1')
    expect(() => resolveProgramSpec(spec([goal({ budget: { maxWallMs: Number.NaN } })])))
      .toThrow('goal "api" budget maxWallMs must be a finite non-negative number, got NaN')
    expect(() => resolveProgramSpec(spec([goal({ budget: { maxCostEur: Number.POSITIVE_INFINITY } })])))
      .toThrow('goal "api" budget maxCostEur must be a finite non-negative number, got Infinity')
    expect(() => resolveProgramSpec(spec([goal({ budget: {} })]))).not.toThrow()
  })

  it('refuses a goal with no check and a goal that declares one check twice', () => {
    expect(() => resolveProgramSpec(spec([goal({ checks: [] })])))
      .toThrow('goal "api" declares no check, so nothing can certify it')
    const twice = { id: 'api-builds' as CheckId, outcome: 'the api builds', run: 'check-api' }
    expect(() => resolveProgramSpec(spec([goal({ checks: [twice, twice] })])))
      .toThrow('goal "api" declares check "api-builds" twice')
  })

  it('refuses an integration that certifies nothing, and one that repeats a check id', () => {
    expect(() => resolveProgramSpec(spec([goal()], { integration: { checks: [], gates: [] } })))
      .toThrow('the integration declares no check and no gate, so nothing can certify the merged head')
    const twice = { id: 'merged-builds' as CheckId, outcome: 'the merged head builds', run: 'check-merged' }
    expect(() => resolveProgramSpec(spec([goal()], { integration: { checks: [twice, twice], gates: [] } })))
      .toThrow('the integration declares check "merged-builds" twice')
  })

  it('refuses an integration check that claims an id the gates own', () => {
    expect(() => resolveProgramSpec(spec([goal()], {
      integration: { checks: [{ id: 'gate-1' as CheckId, outcome: 'no', run: 'no' }], gates: [] },
    }))).toThrow('integration check "gate-1" uses an id the program reserves for integration.gates')
  })

  it('accepts a gate-only integration', () => {
    const frozen = resolveProgramSpec(spec([goal()], { integration: { checks: [], gates: ['run-lint'] } }))
    expect(integrationChecks(frozen.integration).map(check => check.id)).toEqual(['gate-1'])
  })
})

describe('dependencyOrder', () => {
  it('puts every goal after the goals it depends on, breaking ties by key', () => {
    expect(dependencyOrder([
      goal({ key: 'docs', dependsOn: ['api'] }),
      goal({ key: 'ui', dependsOn: ['api'] }),
      goal({ key: 'api' }),
    ])).toEqual(['api', 'docs', 'ui'])
    // The same graph listed the other way round merges in the same order.
    expect(dependencyOrder([
      goal({ key: 'ui', dependsOn: ['api'] }),
      goal({ key: 'docs', dependsOn: ['api'] }),
      goal({ key: 'api' }),
    ])).toEqual(['api', 'docs', 'ui'])
  })

  it('refuses a cycle, naming every goal still waiting', () => {
    expect(() => dependencyOrder([
      goal({ key: 'api', dependsOn: ['docs'] }),
      goal({ key: 'docs', dependsOn: ['api'] }),
    ])).toThrow('goals "api", "docs" form a dependency cycle')
    expect(() => dependencyOrder([
      goal({ key: 'docs', dependsOn: ['api'] }),
      goal({ key: 'api', dependsOn: ['docs'] }),
    ])).toThrow('goals "api", "docs" form a dependency cycle')
    expect(() => resolveProgramSpec(spec([
      goal({ key: 'api', dependsOn: ['docs'] }),
      goal({ key: 'docs', dependsOn: ['api'] }),
    ]))).toThrow('form a dependency cycle')
  })
})

describe('integrationChecks', () => {
  it('follows the declared checks with one check per gate, in gate order', () => {
    expect(integrationChecks({
      checks: [{ id: 'merged-builds' as CheckId, outcome: 'builds', run: 'check-merged' }],
      gates: ['run-lint', 'run-test'],
    })).toEqual([
      { id: 'merged-builds', outcome: 'builds', run: 'check-merged' },
      { id: 'gate-1', outcome: 'the merged head passes the gate: run-lint', run: 'run-lint' },
      { id: 'gate-2', outcome: 'the merged head passes the gate: run-test', run: 'run-test' },
    ])
  })
})

describe('programSpecDigest', () => {
  it('is stable under goal reordering and under dependency reordering', () => {
    const forward = resolveProgramSpec(spec([
      goal(),
      goal({ key: 'docs', dependsOn: ['api'] }),
      goal({ key: 'ui', dependsOn: ['api', 'docs'] }),
    ]))
    const reversed = resolveProgramSpec(spec([
      goal({ key: 'ui', dependsOn: ['docs', 'api'] }),
      goal({ key: 'docs', dependsOn: ['api'] }),
      goal(),
    ]))
    expect(programSpecDigest(forward)).toMatch(/^[0-9a-f]{64}$/)
    expect(programSpecDigest(reversed)).toBe(programSpecDigest(forward))
  })

  it('changes with any check, budget, dependency, gate, base revision, or ceiling', () => {
    const base = resolveProgramSpec(spec([goal(), goal({ key: 'docs' })]))
    const digest = programSpecDigest(base)
    const variants: ProgramSpec[] = [
      spec([goal({ checks: [{ id: 'api-builds' as CheckId, outcome: 'the api builds', run: 'check-api --strict' }] }), goal({ key: 'docs' })]),
      spec([goal({ budget: { maxTotalTokens: 2_000 } }), goal({ key: 'docs' })]),
      spec([goal(), goal({ key: 'docs', dependsOn: ['api'] })]),
      spec([goal(), goal({ key: 'docs' })], { integration: { checks: [], gates: ['run-test'] } }),
      spec([goal(), goal({ key: 'docs' })], { baseRevision: 'other' }),
      spec([goal(), goal({ key: 'docs' })], { tokenCeiling: 10 }),
      spec([goal(), goal({ key: 'docs' })], { objective: 'ship something else' }),
    ]
    for (const variant of variants) {
      expect(programSpecDigest(resolveProgramSpec(variant))).not.toBe(digest)
    }
  })

  it('distinguishes a goal that states no budget from one that caps its tokens', () => {
    const uncapped = programSpecDigest(resolveProgramSpec(spec([goal({ budget: {} })])))
    const capped = programSpecDigest(resolveProgramSpec(spec([goal({ budget: { maxTotalTokens: 1_000 } })])))
    expect(uncapped).toMatch(/^[0-9a-f]{64}$/)
    expect(uncapped).not.toBe(capped)
  })

  it('is unchanged by the attested artefact, which the signatures cover rather than the program', () => {
    const base = resolveProgramSpec(spec())
    const signed = resolveProgramSpec(spec([goal()], {
      signoff: { artefactSha256: 'a'.repeat(64) },
    }))
    expect(programSpecDigest(signed)).toBe(programSpecDigest(base))
  })
})

describe('program identity', () => {
  it('names one digest as a program id and brands a raw one unchanged', () => {
    expect(programIdFor('a'.repeat(64))).toBe(`${PROGRAM_ID_PREFIX}${'a'.repeat(64)}`)
    expect(ProgramId('program-x')).toBe('program-x')
  })

  it('reserves an integration key no goal key can claim', () => {
    expect(() => resolveProgramSpec(spec([goal({ key: INTEGRATION_KEY })])))
      .toThrow(`goal key "${INTEGRATION_KEY}" must be lower-kebab-case`)
  })
})
