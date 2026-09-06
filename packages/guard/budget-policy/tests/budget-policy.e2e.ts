import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { decodeGoalChange } from '@deepseek-ai/dsh-goal'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { foldBudgetSpend, pricingTableDigest } from '@deepseek-ai/dsh-budget-policy'

/** The rates the fixture's `cordis.yml` configures for the mock route. */
const FIXTURE_PRICING = {
  'cli-mock/cli-mock': { inputEurPerMillionTokens: 1, outputEurPerMillionTokens: 2 },
}

const binScript = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/headless-driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL(
  '../../../../examples/headless-agent/tests/fixtures/budget-policy/cordis.yml',
  import.meta.url,
))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

async function jsonlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const paths = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return jsonlFiles(path)
    return entry.isFile() && entry.name.endsWith('.jsonl') ? [path] : []
  }))
  return paths.flat()
}

describe('budget policy through a real cordis.yml and headless process', () => {
  it('prices the step, records the breach, blocks the goal, and makes no further model request', async () => {
    let events: SessionEvent[] = []
    const { stderr } = await runLoaderSmoke({
      label: 'budget-policy',
      tempDirPrefix: 'budget-policy-e2e-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath, 'spend the session budget'],
      tsconfigPath: repoTsconfig,
      inspect: async (cwd) => {
        const logs = await jsonlFiles(join(cwd, '.sessions'))
        expect(logs).toHaveLength(1)
        const lines = (await readFile(logs[0] as string, 'utf8')).trimEnd().split('\n')
        events = lines.slice(1).map(line => JSON.parse(line) as SessionEvent)
      },
    })
    expect(stderr).toBe('')

    const breaches = events.filter(event => event.type === 'budget/breach')
    expect(breaches).toHaveLength(1)
    const breach = breaches[0]
    if (breach?.type !== 'budget/breach') throw new Error('expected a budget breach event')
    expect(breach.data).toEqual({ cap: 'maxOutputTokens', measured: 3, limit: 1 })
    // The recorded measurement is exactly what the preceding events fold to.
    expect(foldBudgetSpend(events.slice(0, breach.seq), {}).outputTokens).toBe(3)

    // The step that stopped the session is durably priced, before the breach it
    // caused, at the rates the fixture's table held.
    const priced = events.filter(event => event.type === 'usage/priced')
    expect(priced).toHaveLength(1)
    const price = priced[0]
    if (price?.type !== 'usage/priced') throw new Error('expected a usage pricing event')
    expect(price.seq).toBeLessThan(breach.seq)
    expect(price.data).toEqual({
      turn: 1,
      step: 1,
      provider: 'cli-mock',
      model: 'cli-mock',
      // 11 uncached input tokens plus 2 cache reads, as the mock route reports.
      inputTokens: 13,
      outputTokens: 3,
      inputEurPerMillionTokens: 1,
      outputEurPerMillionTokens: 2,
      costEur: (13 * 1 + 3 * 2) / 1_000_000,
      pricingDigest: pricingTableDigest(FIXTURE_PRICING),
    })

    const blocks = events.flatMap(event => event.type === 'goal/change'
      ? [decodeGoalChange(event.data)].filter(change => change?.operation === 'block')
      : [])
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      goal: {
        phase: 'blocked',
        blockedReason: {
          code: 'budget-exhausted',
          message: 'Session budget maxOutputTokens exceeded: 3 of 1.',
        },
      },
    })

    // The stopped step never reached a model request, and the blocked goal was
    // not continued: one assistant message, one blocked turn, no goal round.
    expect(events.filter(event => event.type === 'assistant/message')).toHaveLength(1)
    expect(events.filter(event => event.type === 'turn/end')
      .map(event => event.type === 'turn/end' ? event.data.reason.kind : undefined)).toEqual(['blocked'])
    expect(events.filter(event => event.type === 'user/message'
      && event.data.source.kind === 'goal' && event.data.source.round > 0)).toHaveLength(0)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
