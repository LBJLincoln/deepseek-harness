import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { BudgetBreach, BudgetCap, UsageForeign } from '@deepseek-ai/dsh-budget-policy'
import type { EnvironmentDelegation } from '@deepseek-ai/dsh-environment-runner/types'
import type { EnvironmentRunStamp } from '@deepseek-ai/dsh-environments/types'
import type { LeaderboardRow } from '@deepseek-ai/dsh-fleet/types'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import type { ScoreboardBatch, SessionFactsRecord } from '@deepseek-ai/dsh-scorekeeper/types'

const binScript = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/external-implementer/driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/external-implementer/cordis.yml', import.meta.url))
const budgetBinScript = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/external-implementer-budget/driver.ts', import.meta.url))
const budgetConfigPath = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/external-implementer-budget/cordis.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

interface DriverResult {
  type: string
  delegated: { leaderboard: LeaderboardRow[]; stamps: (EnvironmentRunStamp | null)[] }
  routed: { leaderboard: LeaderboardRow[] }
  delegations: Record<string, EnvironmentDelegation[]>
  facts: SessionFactsRecord
  scoreboard: ScoreboardBatch
}

/** One cell of the budgeted run as its driver reports it. */
interface BudgetedCell {
  certified: boolean
  caps: BudgetCap[]
  attempts: number
  delegations: EnvironmentDelegation[]
  foreign: UsageForeign[]
  breaches: BudgetBreach[]
  breachCap?: string
}

interface BudgetDriverResult {
  type: string
  leaderboard: LeaderboardRow[]
  cells: Record<string, BudgetedCell>
}

describe('a delegated cell through a real cordis.yml and headless process', () => {
  it('implements every attempt on the subagent provider and certifies on the tree it left', async () => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'external-implementer',
      tempDirPrefix: 'external-implementer-e2e-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath],
      tsconfigPath: repoTsconfig,
    })
    expect(stderr).toBe('')
    const result = JSON.parse(stdout.trimEnd().split('\n').at(-1) ?? '') as DriverResult
    expect(result.type).toBe('result')

    // The runner ran the checks itself on the tree the delegated child left.
    expect(result.delegated.leaderboard.map(row => [row.environmentId, row.implementer, row.certified, row.attemptsMean])).toEqual([
      ['smoke:round-trip', 'spawn', 1, 1],
      ['smoke:unsatisfiable', 'spawn', 0, 2],
    ])
    expect(result.delegated.stamps.map(stamp => stamp?.implementer)).toEqual(['spawn', 'spawn'])
    expect(result.routed.leaderboard.map(row => row.implementer)).toEqual(['route', 'route'])

    // One child run per attempt, the second carrying the directive the first produced.
    // Each child ran the model its cell was stamped with and said so.
    expect(result.delegated.stamps.map(stamp => stamp?.model.model)).toEqual(['cli-mock', 'cli-mock'])
    expect(result.delegations['smoke:round-trip']).toEqual([
      {
        attempt: 1,
        provider: 'spawn',
        runId: expect.any(String) as unknown as string,
        stopReason: 'completed',
        usage: expect.any(Object) as unknown as object,
        reportedModel: 'cli-mock',
      },
    ])
    const failing = result.delegations['smoke:unsatisfiable'] ?? []
    expect(failing.map(delegation => [delegation.attempt, delegation.provider, delegation.stopReason]))
      .toEqual([[1, 'spawn', 'completed'], [2, 'spawn', 'completed']])
    expect(new Set(failing.map(delegation => delegation.runId)).size).toBe(2)

    // The cell session carries the delegation records and no model turn of its own.
    expect(result.facts.identity.environment).toMatchObject({ environmentId: 'smoke:round-trip', implementer: 'spawn', model: 'cli-mock' })
    // The scorekeeper can state what the child reported beside what was asked
    // for, and the delegated spend where a route cell reports its own.
    expect(result.facts.identity.implementerModel).toBe('cli-mock')
    expect(result.facts.efficiency.inputTokens).toBe(0)
    expect(result.facts.efficiency.delegated?.inputTokens).toBeGreaterThan(0)
    expect(result.facts.outcome).toMatchObject({ reward: 1, rewardBasis: 'certificate', certified: true, certificateExecutor: 'runner' })

    // Two implementers on one environment are two rows the scoreboard never
    // merges. Rows follow the first appearance of a session in the store's own
    // listing, which orders random session ids, so the pair is compared without
    // an order the store does not promise.
    const roundTrip = result.scoreboard.rows.filter(row => row.environmentId === 'smoke:round-trip')
    expect(roundTrip.map(row => [row.implementer, row.certified, row.runs]).sort())
      .toEqual([['route', 1, 1], ['spawn', 1, 1]])
    // The delegated children are sessions of their own that no runner stamped.
    expect(result.scoreboard.unstamped).toBeGreaterThan(0)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('charges the child\'s reported spend to the cell and blocks the attempts its budget did not pay for', async () => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'external-implementer-budget',
      tempDirPrefix: 'external-implementer-budget-e2e-',
      binScript: budgetBinScript,
      libBinScript: budgetBinScript,
      configPath: budgetConfigPath,
      binArgs: [budgetConfigPath],
      tsconfigPath: repoTsconfig,
    })
    expect(stderr).toBe('')
    const result = JSON.parse(stdout.trimEnd().split('\n').at(-1) ?? '') as BudgetDriverResult
    expect(result.type).toBe('result')

    // Both cells ran one attempt on a budget of 20 total tokens, which one
    // child's reported spend exceeds; every cell states the caps it ran under.
    for (const cell of Object.values(result.cells)) {
      expect(cell.caps).toEqual([['maxTotalTokens', 20], ['maxWallMs', 600_000]])
      expect(cell.delegations).toHaveLength(1)
      expect(cell.foreign).toHaveLength(1)
      expect(cell.foreign[0]).toMatchObject({ ref: cell.delegations[0]?.runId, source: 'spawn' })
      expect((cell.foreign[0]?.inputTokens ?? 0) + (cell.foreign[0]?.outputTokens ?? 0)).toBeGreaterThan(20)
    }

    // The cell that certified on its first attempt is not blocked by the budget
    // that attempt exhausted; the one that did not gets no second attempt.
    const certified = result.cells['smoke:round-trip'] as BudgetedCell
    expect(certified).toMatchObject({ certified: true, attempts: 1, breaches: [] })
    expect(certified).not.toHaveProperty('breachCap')

    const stopped = result.cells['smoke:unsatisfiable'] as BudgetedCell
    expect(stopped.certified).toBe(false)
    expect(stopped.attempts).toBe(1)
    expect(stopped.breaches).toHaveLength(1)
    expect(stopped.breaches[0]).toMatchObject({ cap: 'maxTotalTokens', limit: 20 })
    expect(stopped.breaches[0]?.measured).toBeGreaterThan(20)
    // The scorekeeper reads a delegated cell's breach through the same fold a
    // route cell's breach goes through.
    expect(stopped.breachCap).toBe('maxTotalTokens')

    expect(result.leaderboard.map(row => [row.environmentId, row.implementer, row.certified, row.attemptsMean])).toEqual([
      ['smoke:round-trip', 'spawn', 1, 1],
      ['smoke:unsatisfiable', 'spawn', 0, 1],
    ])
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
