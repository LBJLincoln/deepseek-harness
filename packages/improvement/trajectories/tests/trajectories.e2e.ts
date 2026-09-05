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
    expect(result.report).toEqual({ sessions: 1, exported: 1, rewarded: 1, filtered: 0, heldOut: 0, skipped: [] })

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
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
