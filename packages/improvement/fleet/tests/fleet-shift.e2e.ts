import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { FleetRunReport } from '@deepseek-ai/dsh-fleet'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import type { Trajectory, TrajectoryExportReport } from '@deepseek-ai/dsh-trajectories'

const binScript = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/fleet-shift/driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/fleet-shift/cordis.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

interface DriverResult {
  type: string
  report: FleetRunReport
  withheld: TrajectoryExportReport
  named: TrajectoryExportReport
  workspaces: string[]
}

describe('a districted fleet shift through a real cordis.yml and headless process', () => {
  it('stamps the district, stops at the token ceiling, reaps the workspaces, and withholds the district by default', async () => {
    let lines: string[] = []
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'fleet-shift',
      tempDirPrefix: 'fleet-shift-e2e-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath],
      tsconfigPath: repoTsconfig,
      inspect: async (cwd) => {
        lines = (await readFile(join(cwd, 'workshop.jsonl'), 'utf8')).trimEnd().split('\n')
      },
    })
    expect(stderr).toBe('')
    const result = JSON.parse(stdout.trimEnd().split('\n').at(-1) ?? '') as DriverResult
    expect(result.type).toBe('result')

    // The ceiling of one token is crossed by the first report, so the three
    // cells behind it never start and stay on the leaderboard as errors.
    const { report } = result
    expect(report.cells.map(outcome => ('report' in outcome ? 'report' : outcome.error.code))).toEqual([
      'report', 'FLEET_TOKEN_CEILING_REACHED', 'FLEET_TOKEN_CEILING_REACHED', 'FLEET_TOKEN_CEILING_REACHED',
    ])
    expect(report.spend.inputTokens).toBeGreaterThan(0)
    expect(report.leaderboard.map(row => [row.environmentId, row.runs, row.errors])).toEqual([
      ['smoke:round-trip', 1, 1],
      ['smoke:unsatisfiable', 0, 2],
    ])

    expect(result.workspaces).toEqual([])

    expect(result.withheld).toEqual({ sessions: 1, exported: 0, rewarded: 0, filtered: 0, heldOut: 0, withheld: 1, skipped: [] })
    expect(result.named).toEqual({ sessions: 1, exported: 1, rewarded: 1, filtered: 0, heldOut: 0, withheld: 0, skipped: [] })
    expect(lines).toHaveLength(1)
    const trajectory = JSON.parse(lines[0] as string) as Trajectory
    expect(trajectory.environment).toMatchObject({
      environmentId: 'smoke:round-trip',
      group: 'fleet-shift-e2e',
      district: 'workshop',
    })
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
