/**
 * The verify-cordis-config metadata and include-patch contracts: `disabled` is
 * the one entry metadata field whose `!!js` expression the Loader interpolates,
 * every other metadata field must stay static, a disabled expression must
 * parse, and every patch of an include entry must reach an entry of the file it
 * includes.
 */

import { describe, expect, it } from 'vitest'
import { metadataExpressionErrors, skippedIncludePatches } from './verify-cordis-config.ts'

describe('verify-cordis-config metadata expressions', () => {
  it('accepts a disabled !!js expression', () => {
    const problems = metadataExpressionErrors(
      { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash', disabled: { __jsExpr: "process.platform === 'win32'" } },
      '[0]',
    )
    expect(problems).toEqual([])
  })

  it('rejects an expression in a static metadata field', () => {
    const problems = metadataExpressionErrors({ id: { __jsExpr: 'process.platform' }, name: 'pkg' }, '[0]')
    expect(problems).toContain('[0].id: !!js is not interpolated here')
  })

  it('rejects an expression nested below disabled (only the field itself interpolates)', () => {
    const problems = metadataExpressionErrors(
      { id: 'tool-bash', name: 'pkg', disabled: { when: { __jsExpr: 'process.platform' } } },
      '[0]',
    )
    expect(problems).toContain('[0].disabled.when: !!js is not interpolated here')
  })

  it('rejects a disabled expression that does not parse (the loader would fail the boot)', () => {
    const problems = metadataExpressionErrors(
      { id: 'tool-bash', name: 'pkg', disabled: { __jsExpr: 'process.platform ===' } },
      '[0]',
    )
    expect(problems.some(problem => problem.includes('[0].disabled: disabled expression does not parse'))).toBe(true)
  })
})

describe('verify-cordis-config include patches', () => {
  const BASE = [
    { id: 'settings', name: '@deepseek-ai/dsh-settings-file' },
    { id: 'tools', name: '@deepseek-ai/cordis-plugin-group', group: true, config: [{ id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs' }] },
  ]

  it('reports a non-insert patch whose id the included file never names', () => {
    expect(skippedIncludePatches([{ id: 'subagent-spawn', name: '@deepseek-ai/dsh-subagent-spawn-in-process' }], BASE))
      .toEqual(['patch: entry subagent-spawn not found'])
  })

  it('accepts a patch that reaches an entry, including one inside a group and one an earlier insert added', () => {
    expect(skippedIncludePatches([
      { id: 'settings', config: { root: './settings' } },
      { id: 'tool-fs', config: { maxBytes: 1024 } },
      { insert: [{ id: 'subagent-spawn', name: '@deepseek-ai/dsh-subagent-spawn-in-process' }] },
      { id: 'subagent-spawn', disabled: true },
    ], BASE)).toEqual([])
  })

  it('reports an insert the included file cannot receive and a patch carrying no id', () => {
    expect(skippedIncludePatches([{ id: 'settings', insert: [{ id: 'nested', name: 'pkg' }] }], BASE))
      .toEqual(['patch insert: entry settings is not a group'])
    expect(skippedIncludePatches([{ id: 'absent', insert: [{ id: 'nested', name: 'pkg' }] }], BASE))
      .toEqual(['patch insert: entry absent not found'])
    expect(skippedIncludePatches([{ config: { root: './settings' } }], BASE))
      .toEqual(['patch: id is required for non-insert patches'])
  })

  it('reports a patch whose name disagrees with the entry it targets', () => {
    expect(skippedIncludePatches([{ id: 'settings', name: '@deepseek-ai/dsh-settings-memory' }], BASE))
      .toEqual(['patch: name mismatch for settings (expected @deepseek-ai/dsh-settings-file, got @deepseek-ai/dsh-settings-memory), skipping'])
  })

  it('skips nothing for an entry that carries no patches', () => {
    expect(skippedIncludePatches(undefined, BASE)).toEqual([])
    expect(skippedIncludePatches([], BASE)).toEqual([])
  })
})
