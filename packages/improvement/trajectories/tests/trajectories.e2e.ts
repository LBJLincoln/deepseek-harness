import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import type { Trajectory, TrajectoryExportReport } from '@deepseek-ai/dsh-trajectories'

const binScript = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/trajectory-export/driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL(
  '../../../../examples/headless-agent/tests/fixtures/trajectory-export/cordis.yml',
  import.meta.url,
))
// The instrument-cases fixture is the runnable environment whose checks carry
// weighted cases, so it is what a record with a parity is exported from.
const casedBinScript = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/instrument-cases/driver.ts', import.meta.url))
const casedConfigPath = fileURLToPath(new URL(
  '../../../../examples/headless-agent/tests/fixtures/instrument-cases/cordis.yml',
  import.meta.url,
))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

describe('trajectory export through a real cordis.yml and headless process', () => {
  it('exports the certified session as one rewarded dsh-trajectory/1 line', async () => {
    let lines: string[] = []
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'trajectory-export',
      tempDirPrefix: 'trajectory-export-e2e-',
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
    const result = JSON.parse(stdout.trimEnd().split('\n').at(-1) ?? '') as { type: string; report: TrajectoryExportReport }
    expect(result.type).toBe('result')
    expect(result.report).toEqual({ sessions: 1, exported: 1, rewarded: 1, filtered: 0, heldOut: 0, withheld: 0, skipped: [] })

    expect(lines).toHaveLength(1)
    const trajectory = JSON.parse(lines[0] as string) as Trajectory
    expect(trajectory.format).toBe('dsh-trajectory/1')
    expect(trajectory.config).toMatchObject({ provider: 'cli-mock', model: 'cli-mock' })
    expect(trajectory.reward).toMatchObject({
      outcome: 1,
      basis: 'certificate',
      goal: { phase: 'complete' },
      directives: 1,
      attempts: 2,
    })
    expect(trajectory.reward.certificate?.results.map(result => result.checkId)).toEqual(['round-trip-prints', 'final-answer-quotes'])
    expect(trajectory.provenance.isolation).toBe('none')
    expect(trajectory.provenance.components).toContain('model-provider:cli-mock')
    expect(trajectory.messages[0]).toMatchObject({ role: 'user', sourceKind: 'user' })
    expect(trajectory.messages.some(message => message.role === 'tool')).toBe(true)
    expect(trajectory.steps.length).toBeGreaterThan(0)
    // Nothing this session ran was measured case by case, so the record states no parity.
    expect(trajectory).not.toHaveProperty('parity')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('exports the weighted pass rate of a case-measured session beside its uncertified outcome', async () => {
    let lines: string[] = []
    const { stderr } = await runLoaderSmoke({
      label: 'trajectory-export-cases',
      tempDirPrefix: 'trajectory-export-cases-e2e-',
      binScript: casedBinScript,
      libBinScript: casedBinScript,
      configPath: casedConfigPath,
      binArgs: [casedConfigPath],
      tsconfigPath: repoTsconfig,
      inspect: async (cwd) => {
        lines = (await readFile(join(cwd, 'trajectories.jsonl'), 'utf8')).trimEnd().split('\n')
      },
    })
    expect(stderr).toBe('')
    expect(lines).toHaveLength(1)
    const trajectory = JSON.parse(lines[0] as string) as Trajectory
    // Three of the check's fifteen case weights passed, which never certifies:
    // the record carries the rate beside an outcome the certificate alone decides.
    expect(trajectory.parity).toEqual({ weightPassed: 3, weightTotal: 15 })
    expect(trajectory.reward).toMatchObject({ outcome: 0, basis: 'certificate' })
    expect(trajectory.reward).not.toHaveProperty('certificate')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
