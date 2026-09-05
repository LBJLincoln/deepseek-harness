import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { LeaderboardRow } from '@deepseek-ai/dsh-fleet'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import type { FactsExportReport, ScoreboardBatch, SessionFactsRecord } from '@deepseek-ai/dsh-scorekeeper'

const binScript = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/scoreboard/driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/scoreboard/cordis.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

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

    expect(result.exported).toMatchObject({ sessions: 4, exported: 4, skipped: [] })
    expect(lines).toHaveLength(4)
    const records = lines.map(line => JSON.parse(line) as SessionFactsRecord)
    expect(records.every(record => record.identity.environment?.group === 'scoreboard-e2e')).toBe(true)
    expect(records.filter(record => record.outcome.certified)).toHaveLength(2)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
