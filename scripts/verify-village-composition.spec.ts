/**
 * The verify-village-composition rule set: a district composition carries a
 * capped budget policy, a persistence backend, and the checkpoint policy; a
 * fleet entry sets `workspaceRetention`; an unproven runner isolation warns
 * until `--strict`.
 */

import { describe, expect, it } from 'vitest'
import {
  formatVillageDiagnostic,
  parseStrictFlag,
  villageCompositionDiagnostics,
  type VillageDiagnostic,
  type VillageRuleId,
} from './verify-village-composition.ts'

const FILE = 'examples/village/cordis.yml'

const RUNNER = row('environment-runner', '@deepseek-ai/dsh-environment-runner', ['isolation: none'])
const BUDGET = row('budget-policy', '@deepseek-ai/dsh-budget-policy', ['maxTotalTokens: 5000000'])
const PERSISTENCE = row('persistence', '@deepseek-ai/dsh-session-persistence-jsonl')
const CHECKPOINT = row('checkpoint-policy', '@deepseek-ai/dsh-session-checkpoint-policy')

/**
 * One Loader entry as YAML text.
 * @param id - the entry id.
 * @param name - the composed package.
 * @param config - `config` lines, omitted when empty.
 * @param metadata - entry metadata lines placed before `config`.
 * @returns the entry text, newline-terminated.
 */
function row(id: string, name: string, config: readonly string[] = [], metadata: readonly string[] = []): string {
  const lines = [`- id: ${id}`, `  name: '${name}'`, ...metadata.map(line => `  ${line}`)]
  if (config.length > 0) lines.push('  config:', ...config.map(line => `    ${line}`))
  return `${lines.join('\n')}\n`
}

/**
 * Assemble one configuration file.
 * @param parts - entry texts in composition order.
 * @returns the document text.
 */
function config(...parts: string[]): string {
  return parts.join('\n')
}

/** A compliant district composition plus any extra entries. */
function district(...parts: string[]): string {
  return config(RUNNER, BUDGET, PERSISTENCE, CHECKPOINT, ...parts)
}

/**
 * The rules one configuration violates, in the order the gate reports them.
 * @param source - the configuration text.
 * @returns the violated rule ids.
 */
function rules(source: string): VillageRuleId[] {
  return villageCompositionDiagnostics(FILE, source).map(diagnostic => diagnostic.rule)
}

/**
 * The single diagnostic a configuration must produce.
 * @param source - the configuration text.
 * @returns that diagnostic.
 */
function only(source: string): VillageDiagnostic {
  const diagnostics = villageCompositionDiagnostics(FILE, source)
  expect(diagnostics).toHaveLength(1)
  const [first] = diagnostics
  if (first === undefined) throw new Error('village diagnostics were empty')
  return first
}

describe('village composition scope', () => {
  it('ignores a configuration that composes no district plugin', () => {
    expect(rules(row('bash', '@deepseek-ai/dsh-bash-local'))).toEqual([])
  })

  it('accepts a district composition that carries every required plugin', () => {
    expect(rules(district())).toEqual([])
  })

  it('accepts the sqlite backend as the persistence requirement', () => {
    const sqlite = row('persistence', '@deepseek-ai/dsh-session-persistence-sqlite')
    expect(rules(config(RUNNER, BUDGET, sqlite, CHECKPOINT))).toEqual([])
  })

  it('leaves a document that is not an entry array to verify-cordis-config', () => {
    expect(rules('plugins: {}\n')).toEqual([])
  })
})

describe('district requirements', () => {
  it('names the file, the triggering entry, and the rule', () => {
    const line = formatVillageDiagnostic(only(config(RUNNER, PERSISTENCE, CHECKPOINT)))
    expect(line).toContain(FILE)
    expect(line).toContain('[entry "environment-runner"]')
    expect(line).toContain('village rule budget-policy')
  })

  it('rejects a fleet composition with no budget policy', () => {
    const fleet = row('fleet', '@deepseek-ai/dsh-fleet', ['workspaceRetention: keep'])
    expect(rules(config(fleet, PERSISTENCE, CHECKPOINT))).toEqual(['budget-policy'])
  })

  it('rejects an experiment composition with no budget policy', () => {
    const experiments = row('experiments', '@deepseek-ai/dsh-experiments')
    expect(rules(config(experiments, PERSISTENCE, CHECKPOINT))).toEqual(['budget-policy'])
  })

  it('rejects a budget policy that sets no cap', () => {
    const uncapped = row('budget-policy', '@deepseek-ai/dsh-budget-policy', ['pricing: {}'])
    const diagnostic = only(config(RUNNER, uncapped, PERSISTENCE, CHECKPOINT))
    expect(diagnostic.rule).toBe('budget-policy')
    expect(diagnostic.detail).toContain('entry "budget-policy" sets none of')
  })

  it.each(['maxTotalTokens', 'maxInputTokens', 'maxOutputTokens', 'maxWallMs', 'maxCostEur'])(
    'accepts %s on its own as the enforced cap',
    (cap) => {
      const capped = row('budget-policy', '@deepseek-ai/dsh-budget-policy', [`${cap}: 1000`])
      expect(rules(config(RUNNER, capped, PERSISTENCE, CHECKPOINT))).toEqual([])
    },
  )

  it('rejects a district composition with no persistence backend', () => {
    expect(rules(config(RUNNER, BUDGET, CHECKPOINT))).toEqual(['session-persistence'])
  })

  it('rejects a district composition with no checkpoint policy', () => {
    expect(rules(config(RUNNER, BUDGET, PERSISTENCE))).toEqual(['session-checkpoint-policy'])
  })

  it('reports every unmet requirement of one file', () => {
    expect(rules(RUNNER)).toEqual(['budget-policy', 'session-persistence', 'session-checkpoint-policy'])
  })
})

describe('disabled entries', () => {
  const EXPRESSION = "disabled: !!js process.platform === 'win32'"

  it('does not count a disabled runner as a district', () => {
    const off = row('environment-runner', '@deepseek-ai/dsh-environment-runner', [], ['disabled: true'])
    expect(rules(off)).toEqual([])
  })

  it('counts a runner gated by a disabled expression as a district', () => {
    const gated = row('environment-runner', '@deepseek-ai/dsh-environment-runner', [], [EXPRESSION])
    expect(rules(gated)).toEqual(['budget-policy', 'session-persistence', 'session-checkpoint-policy'])
  })

  it('rejects a disabled budget policy', () => {
    const off = row('budget-policy', '@deepseek-ai/dsh-budget-policy', ['maxTotalTokens: 1000'], ['disabled: true'])
    const diagnostic = only(config(RUNNER, off, PERSISTENCE, CHECKPOINT))
    expect(diagnostic.detail).toContain('composes none of them')
  })

  it('rejects a budget policy gated by a disabled expression', () => {
    const gated = row('budget-policy', '@deepseek-ai/dsh-budget-policy', ['maxTotalTokens: 1000'], [EXPRESSION])
    expect(only(config(RUNNER, gated, PERSISTENCE, CHECKPOINT)).detail).toContain('gated by a disabled expression')
  })

  it('accepts a cap set by an interpolated config expression', () => {
    const interpolated = row('budget-policy', '@deepseek-ai/dsh-budget-policy', ['maxWallMs: !!js 10 * 60 * 1000'])
    expect(rules(config(RUNNER, interpolated, PERSISTENCE, CHECKPOINT))).toEqual([])
  })
})

describe('nested rows', () => {
  it('finds a district and its requirements inside a group', () => {
    expect(rules(`- id: district\n  group: true\n  config:\n${indent(district(), 4)}`)).toEqual([])
  })

  it('rejects a grouped district whose group omits the checkpoint policy', () => {
    const grouped = `- id: district\n  group: true\n  config:\n${indent(config(RUNNER, BUDGET, PERSISTENCE), 4)}`
    expect(rules(grouped)).toEqual(['session-checkpoint-policy'])
  })

  it('finds a district inserted by an include patch', () => {
    const anchor = `      - id: anchor\n        name: '@deepseek-ai/dsh-bash-local'\n        insert:\n${indent(RUNNER, 10)}`
    const patched = `- id: overlay\n  name: '@deepseek-ai/cordis-plugin-include'\n  config:\n    patches:\n${anchor}`
    expect(rules(patched)).toEqual(['budget-policy', 'session-persistence', 'session-checkpoint-policy'])
  })
})

describe('fleet workspace retention', () => {
  it('rejects a fleet entry that sets no workspaceRetention', () => {
    const fleet = row('fleet', '@deepseek-ai/dsh-fleet', ['maxConcurrent: 1'])
    const diagnostic = only(district(fleet))
    expect(diagnostic.rule).toBe('fleet-workspace-retention')
    expect(diagnostic.entryId).toBe('fleet')
    expect(formatVillageDiagnostic(diagnostic)).toContain('village rule fleet-workspace-retention')
  })

  it('rejects a fleet entry with no config at all', () => {
    expect(rules(district(row('fleet', '@deepseek-ai/dsh-fleet')))).toEqual(['fleet-workspace-retention'])
  })

  it('accepts a fleet entry that sets workspaceRetention', () => {
    expect(rules(district(row('fleet', '@deepseek-ai/dsh-fleet', ['workspaceRetention: remove-all'])))).toEqual([])
  })
})

describe('runner isolation', () => {
  it.each(['process', 'host'])('warns on an unproven isolation: %s claim', (isolation) => {
    const runner = row('environment-runner', '@deepseek-ai/dsh-environment-runner', [`isolation: ${isolation}`])
    const diagnostic = only(config(runner, BUDGET, PERSISTENCE, CHECKPOINT))
    expect(diagnostic.rule).toBe('runner-isolation')
    expect(diagnostic.severity).toBe('warning')
    expect(diagnostic.detail).toContain(`isolation: ${isolation}`)
  })

  it('does not warn on isolation: none', () => {
    expect(rules(district())).toEqual([])
  })
})

describe('strict flag', () => {
  it('defaults to non-strict', () => {
    expect(parseStrictFlag([])).toBe(false)
  })

  it('reads --strict', () => {
    expect(parseStrictFlag(['--strict'])).toBe(true)
  })

  it('rejects any other argument', () => {
    expect(() => parseStrictFlag(['--warnings-are-errors'])).toThrow('--warnings-are-errors')
  })
})

/**
 * Indent a nested entry list so it parses as a child sequence.
 * @param source - the entry list text.
 * @param spaces - the indentation width.
 * @returns the indented text.
 */
function indent(source: string, spaces: number): string {
  return source.split('\n').map(line => line === '' ? line : `${' '.repeat(spaces)}${line}`).join('\n')
}
