import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseExperimentGroup } from '@deepseek-ai/dsh-experiments'
import type { ExperimentResult } from '@deepseek-ai/dsh-experiments'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import type { Trajectory, TrajectoryExportReport } from '@deepseek-ai/dsh-trajectories'

const binScript = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/experiment/driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/experiment/cordis.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

interface DriverResult {
  type: string
  result: ExperimentResult
  exported: TrajectoryExportReport
}

describe('an experiment through a real cordis.yml and headless process', () => {
  it('runs both arms on one route and folds a null comparison whose groups name the frozen plan', async () => {
    let written: string[] = []
    let trajectoryLines: string[] = []
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'experiment',
      tempDirPrefix: 'experiment-e2e-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath],
      tsconfigPath: repoTsconfig,
      inspect: async (cwd) => {
        written = (await readFile(join(cwd, 'experiment.jsonl'), 'utf8')).trimEnd().split('\n')
        trajectoryLines = (await readFile(join(cwd, 'trajectories.jsonl'), 'utf8')).trimEnd().split('\n')
      },
    })
    expect(stderr).toBe('')
    const driver = JSON.parse(stdout.trimEnd().split('\n').at(-1) ?? '') as DriverResult
    expect(driver.type).toBe('result')

    const { result } = driver
    expect(result.digest).toMatch(/^[0-9a-f]{64}$/)
    expect(result.thresholds).toEqual({ bootstrapResamples: 200, confidenceLevel: 0.95, minimumDelta: 0, cellTokenCap: 20000 })
    expect(result.arms.baseline.model).toEqual(result.arms.candidate.model)
    expect([result.arms.baseline.implementer, result.arms.candidate.implementer]).toEqual([{ kind: 'route' }, { kind: 'route' }])
    expect(parseExperimentGroup(result.arms.baseline.group)).toEqual({ digest: result.digest, role: 'baseline' })
    expect(parseExperimentGroup(result.arms.candidate.group)).toEqual({ digest: result.digest, role: 'candidate' })

    expect(result.seedsPaired).toBe(4)
    expect(result.delta).toBe(0)
    expect(result.interval).toEqual({ lower: 0, upper: 0 })
    expect(result.verdict).toBe('inconclusive')
    expect(result.cells.map(cell => [cell.environment, cell.pairs, cell.unpaired, cell.delta])).toEqual([
      ['smoke:round-trip', 2, 0, 0],
      ['smoke:unsatisfiable', 2, 0, 0],
    ])
    expect(result.cells[0]?.baselineRate).toBe(1)
    expect(result.cells[1]?.candidateRate).toBe(0)
    expect(result.spend.inputTokens).toBeGreaterThan(0)
    expect(result.spend.outputTokens).toBeGreaterThan(0)

    expect(written).toHaveLength(1)
    expect(JSON.parse(written[0] as string)).toEqual(JSON.parse(JSON.stringify(result)))

    expect(driver.exported).toMatchObject({ sessions: 8, exported: 8, rewarded: 4, heldOut: 0, skipped: [] })
    const groups = trajectoryLines
      .map(line => (JSON.parse(line) as Trajectory).environment?.group)
      .map(group => (group === undefined ? undefined : parseExperimentGroup(group)))
    expect(groups.every(parsed => parsed?.digest === result.digest)).toBe(true)
    expect(groups.filter(parsed => parsed?.role === 'baseline')).toHaveLength(4)
    expect(groups.filter(parsed => parsed?.role === 'candidate')).toHaveLength(4)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
