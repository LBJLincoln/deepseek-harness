import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { FleetRunReport } from '@deepseek-ai/dsh-fleet'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import type { Trajectory, TrajectoryExportReport } from '@deepseek-ai/dsh-trajectories'

const binScript = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/fleet-run/driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/fleet-run/cordis.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

interface DriverResult {
  type: string
  report: FleetRunReport
  markdown: string
  exported: TrajectoryExportReport
}

describe('fleet runs through a real cordis.yml and headless process', () => {
  it('runs two environments twice each, folds the leaderboard, and exports every stamped session', async () => {
    let lines: string[] = []
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'fleet-run',
      tempDirPrefix: 'fleet-run-e2e-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath],
      tsconfigPath: repoTsconfig,
      inspect: async (cwd) => {
        lines = (await readFile(join(cwd, 'trajectories.jsonl'), 'utf8')).trimEnd().split('\n')
      },
    })
    expect(stderr).toBe('')
    const result = JSON.parse(stdout.trimEnd().split('\n').at(-1) ?? '') as DriverResult
    expect(result.type).toBe('result')

    const { report } = result
    expect(report.group).toBe('fleet-e2e')
    expect(report.cells.map(outcome => [outcome.cell.environment, outcome.cell.repetition])).toEqual([
      ['smoke:round-trip', 0], ['smoke:round-trip', 1], ['smoke:unsatisfiable', 0], ['smoke:unsatisfiable', 1],
    ])
    expect(report.cells.every(outcome => 'report' in outcome)).toBe(true)
    expect(report.leaderboard).toHaveLength(2)
    expect(report.leaderboard[0]).toMatchObject({
      provider: 'cli-mock', model: 'cli-mock', environmentId: 'smoke:round-trip', heldOut: false, isolation: 'none',
      runs: 2, errors: 0, certified: 2, certificateRate: 1, attemptsMean: 1,
    })
    expect(report.leaderboard[1]).toMatchObject({
      environmentId: 'smoke:unsatisfiable', runs: 2, errors: 0, certified: 0, certificateRate: 0, attemptsMean: 2,
    })
    expect(report.leaderboard[0]?.inputTokens).toBeGreaterThan(0)
    expect(result.markdown.startsWith('Fleet run `fleet-e2e`\n')).toBe(true)
    expect(result.markdown).toContain('| cli-mock/cli-mock | route | smoke:round-trip | no | none | 2 | 0 | 2 | 1.00 | 1.00 |')

    // Every cell of the plan is stamped with the plan's policy version, and its
    // seed is the plan's base offset by the cell's repetition index.
    expect(report.cells.map(outcome => (
      'report' in outcome ? [outcome.report.stamp.policyVersion, outcome.report.stamp.seed] : ['error', -1]
    ))).toEqual([
      ['policy-2026-09', 100], ['policy-2026-09', 101], ['policy-2026-09', 100], ['policy-2026-09', 101],
    ])

    expect(report.spend.inputTokens).toBe(report.leaderboard.reduce((sum, row) => sum + row.inputTokens, 0))
    expect(result.exported).toEqual({ sessions: 4, exported: 4, rewarded: 2, filtered: 0, heldOut: 0, withheld: 0, skipped: [] })
    expect(lines).toHaveLength(4)
    const trajectories = lines.map(line => JSON.parse(line) as Trajectory)
    expect(trajectories.every(trajectory => trajectory.environment?.group === 'fleet-e2e')).toBe(true)
    expect(trajectories.map(trajectory => trajectory.environment?.repetition).sort()).toEqual([0, 0, 1, 1])
    expect(trajectories.filter(trajectory => trajectory.reward.outcome === 1).map(trajectory => trajectory.environment?.environmentId))
      .toEqual(['smoke:round-trip', 'smoke:round-trip'])
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
