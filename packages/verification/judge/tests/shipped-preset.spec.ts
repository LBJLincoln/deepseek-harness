/**
 * The shipped `judge` preset as the roster discovers it: a `system`-trust row
 * declaring the read barrier's `judge` role, composing no tool.
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { discoverPresets } from '@deepseek-ai/dsh-agent-presets'
import { DEFAULT_JUDGE_PRESET } from '@deepseek-ai/dsh-judge'

const shippedRoot = fileURLToPath(new URL('../../../../apps/cli/config/agent-presets', import.meta.url))
const composition = fileURLToPath(new URL('../../../../apps/cli/config/agent-presets/judge/agent.cordis.yml', import.meta.url))

describe('the shipped judge preset', () => {
  it('is discovered like every other shipped preset, declaring the judge role', async () => {
    const presets = await discoverPresets([{ path: shippedRoot, trust: 'system' }])
    const judge = presets.find(preset => preset.id === DEFAULT_JUDGE_PRESET)

    expect(judge).toMatchObject({ id: 'judge', trust: 'system', role: 'judge' })
    expect(judge?.broken).toBeUndefined()
    // It is the only shipped preset that claims a role at all.
    expect(presets.filter(preset => preset.role !== undefined).map(preset => preset.id)).toEqual(['judge'])
  })

  it('composes one persona row and no tool', async () => {
    const rows = load(await readFile(composition, 'utf8')) as { name: string }[]

    expect(rows.map(row => row.name)).toEqual(['@deepseek-ai/dsh-persona'])
  })
})
