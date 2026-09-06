import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { pricingTableDigest } from '@deepseek-ai/dsh-budget-policy'
import type { LeaderboardRow } from '@deepseek-ai/dsh-fleet'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import type { FactsExportReport, ScoreboardBatch, SessionFactsRecord } from '@deepseek-ai/dsh-scorekeeper'

const binScript = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/scoreboard/driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/scoreboard/cordis.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

/** The `pricing` table the fixture's budget policy configures, restated so the digest can be recomputed here. */
const FIXTURE_PRICING = {
  'cli-mock/cli-mock': { inputEurPerMillionTokens: 1, outputEurPerMillionTokens: 2 },
}

interface DriverResult {
  type: string
  leaderboard: LeaderboardRow[]
  scoreboard: ScoreboardBatch
  facts: SessionFactsRecord
  exported: FactsExportReport
}

describe('the scorekeeper through a real cordis.yml and headless process', () => {
  it('folds a scoreboard from the persisted logs that agrees with the fleet run that produced them', async () => {
    let lines: string[] = []
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'scoreboard',
      tempDirPrefix: 'scoreboard-e2e-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath],
      tsconfigPath: repoTsconfig,
      inspect: async (cwd) => {
        lines = (await readFile(join(cwd, 'facts.jsonl'), 'utf8')).trimEnd().split('\n')
      },
    })
    expect(stderr).toBe('')
    const result = JSON.parse(stdout.trimEnd().split('\n').at(-1) ?? '') as DriverResult
    expect(result.type).toBe('result')

    const { leaderboard, scoreboard } = result
    expect(scoreboard).toMatchObject({ sessions: 4, excluded: 0, unstamped: 0, skipped: [] })
    expect(scoreboard.rows).toHaveLength(leaderboard.length)
    // Rows appear in the order the store lists sessions, so cells are matched by identity.
    const byCell = new Map(scoreboard.rows.map(row => [`${row.provider}/${row.model} ${row.environmentId}`, row]))
    for (const fleetRow of leaderboard) {
      const row = byCell.get(`${fleetRow.provider}/${fleetRow.model} ${fleetRow.environmentId}`)
      expect(row).toBeDefined()
      expect([row?.heldOut, row?.isolation]).toEqual([fleetRow.heldOut, fleetRow.isolation])
      expect([row?.runs, row?.certified, row?.certificateRate, row?.attemptsMean])
        .toEqual([fleetRow.runs, fleetRow.certified, fleetRow.certificateRate, fleetRow.attemptsMean])
    }
    const roundTrip = byCell.get('cli-mock/cli-mock smoke:round-trip')
    expect(roundTrip).toMatchObject({ runs: 2, errors: 0, certified: 2, certificateRate: 1, attemptsMean: 1 })
    expect(roundTrip?.stats).toEqual({
      groups: 1,
      samples: 2,
      passAtK: [{ k: 1, value: 1, groups: 1 }, { k: 2, value: 1, groups: 1 }],
    })
    const unsatisfiable = byCell.get('cli-mock/cli-mock smoke:unsatisfiable')
    expect(unsatisfiable).toMatchObject({ runs: 2, certified: 0, certificateRate: 0, attemptsMean: 2 })
    expect(unsatisfiable?.stats.passAtK).toEqual([{ k: 1, value: 0, groups: 1 }, { k: 2, value: 0, groups: 1 }])

    const { facts } = result
    expect(facts.identity.environment).toMatchObject({
      environmentId: 'smoke:round-trip',
      environmentKind: 'smoke',
      heldOut: false,
      group: 'scoreboard-e2e',
      isolation: 'none',
      provider: 'cli-mock',
      model: 'cli-mock',
    })
    expect(facts.outcome).toMatchObject({
      reward: 1,
      rewardBasis: 'certificate',
      certified: true,
      certificateRevision: 1,
      runsRecorded: 1,
      attempts: 1,
      goalPhase: 'complete',
    })
    expect(facts.efficiency.turns).toBeGreaterThan(0)
    expect(facts.efficiency.inputTokens).toBeGreaterThan(0)
    expect(facts.efficiency.outputTokens).toBeGreaterThan(0)
    expect(facts.tools.toolCalls).toBeGreaterThan(0)

    // Every step of the priced mock route was recorded as a `usage/priced`
    // event, so the log states the cost at the rates the fixture configured.
    const efficiency = facts.efficiency
    expect(efficiency.pricedSteps).toBeGreaterThan(0)
    expect(efficiency.pricingDigests).toEqual([pricingTableDigest(FIXTURE_PRICING)])
    const rates = FIXTURE_PRICING['cli-mock/cli-mock']
    const billedTokens = efficiency.inputTokens + efficiency.cacheReadTokens + efficiency.cacheWriteTokens
    expect(efficiency.costEur).toBeCloseTo(
      (billedTokens * rates.inputEurPerMillionTokens + efficiency.outputTokens * rates.outputEurPerMillionTokens) / 1_000_000,
      12,
    )

    expect(result.exported).toMatchObject({ sessions: 4, exported: 4, skipped: [] })
    expect(lines).toHaveLength(4)
    const records = lines.map(line => JSON.parse(line) as SessionFactsRecord)
    expect(records.every(record => record.identity.environment?.group === 'scoreboard-e2e')).toBe(true)
    expect(records.filter(record => record.outcome.certified)).toHaveLength(2)

    // The row's cost per certified session is the mean over exactly the
    // certified sessions of that cell, as the exported records state them.
    const certifiedRecords = records
      .filter(record => record.outcome.certified && record.identity.environment?.environmentId === 'smoke:round-trip')
    expect(certifiedRecords).toHaveLength(2)
    const certifiedCosts = certifiedRecords.map(record => record.efficiency.costEur).filter(cost => cost !== undefined)
    expect(certifiedCosts).toHaveLength(2)
    expect(certifiedCosts.every(cost => cost > 0)).toBe(true)
    const mean = certifiedCosts.reduce<number>((sum, cost) => sum + cost, 0) / certifiedCosts.length
    expect(roundTrip?.pricingDigests).toEqual([pricingTableDigest(FIXTURE_PRICING)])
    expect(roundTrip?.costEurPerCertified).toBeCloseTo(mean, 12)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
