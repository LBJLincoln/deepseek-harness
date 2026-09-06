import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import type { Trajectory } from '@deepseek-ai/dsh-trajectories'
import type { CheckResult, RunParity } from '@deepseek-ai/dsh-verification'

const fixture = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/instrument-cases/', import.meta.url))
const binScript = join(fixture, 'driver.ts')
const configPath = join(fixture, 'cordis.yml')
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

interface StreamRecord {
  type: string
  event?: { type: string; data: Record<string, unknown> }
  parity?: (RunParity | undefined)[]
  certified?: boolean
}

describe('an environment run whose implementer satisfies part of a weighted case set', () => {
  it('records the parity, the mismatching channels of each failed case, and no certificate', async () => {
    let lines: string[] = []
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'instrument-cases',
      tempDirPrefix: 'instrument-cases-e2e-',
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
    const records = stdout.trimEnd().split('\n').map(line => JSON.parse(line) as StreamRecord)
    expect(records.at(-1)).toMatchObject({
      type: 'result',
      certified: false,
      parity: [{ weightPassed: 3, weightTotal: 15 }, { weightPassed: 3, weightTotal: 15 }],
      exported: 1,
      rewarded: 0,
    })

    const events = records.flatMap(record => record.event === undefined ? [] : [record.event])
    const runs = events.filter(event => event.type === 'verification/run')
    expect(runs).toHaveLength(2)
    expect(runs[0]?.data).toMatchObject({
      verdict: 'failed',
      executor: 'runner',
      parity: { weightPassed: 3, weightTotal: 15 },
    })
    // Every failed case names the channels that disagreed and how the candidate
    // ended, which is what the directive clusters by.
    const result = (runs[0]?.data['results'] as CheckResult[])[0]
    expect(result).toMatchObject({ checkId: 'reverses-words', status: 'fail' })
    expect(result?.cases).toEqual({
      passed: 2,
      total: 5,
      weightPassed: 3,
      weightTotal: 15,
      failed: [
        { id: 'reverse-xy', weight: 3, channels: ['stdout'], exitClass: 'zero' },
        { id: 'reverse-zw', weight: 4, channels: ['stdout'], exitClass: 'zero' },
        { id: 'reverse-bad', weight: 5, channels: ['exit', 'stderr'], exitClass: 'nonzero' },
      ],
    })
    expect(events.filter(event => event.type === 'verification/certificate')).toEqual([])
    expect(events.filter(event => event.type === 'goal/change').map(event => event.data['operation'])).toEqual(['create'])

    const directives = events.filter(event => event.type === 'verification/directive')
    expect(directives).toHaveLength(2)
    expect(directives[0]?.data).toMatchObject({
      rootCause: "1 of the standard's checks failed",
      clusters: [
        { checkId: 'reverses-words', channels: ['stdout'], count: 2, weight: 7 },
        { checkId: 'reverses-words', channels: ['exit', 'stderr'], count: 1, weight: 5 },
      ],
    })

    expect(lines).toHaveLength(1)
    const trajectory = JSON.parse(lines[0] ?? '') as Trajectory
    expect(trajectory.reward).toMatchObject({ outcome: 0, basis: 'certificate', attempts: 2, directives: 2 })
    expect(trajectory.reward).not.toHaveProperty('certificate')
    expect(trajectory.environment?.environmentId).toBe('smoke:reverse-words')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
