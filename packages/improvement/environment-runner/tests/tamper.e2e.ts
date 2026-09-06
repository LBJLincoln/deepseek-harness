import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import type { Trajectory } from '@deepseek-ai/dsh-trajectories'

const fixture = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/read-barrier-tamper/', import.meta.url))
const binScript = join(fixture, 'driver.ts')
const configPath = join(fixture, 'cordis.yml')
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

interface StreamRecord {
  type: string
  event?: { type: string; data: Record<string, unknown> }
  verdicts?: string[]
  certified?: boolean
}

describe('an environment run whose implementer rewrites the file it is graded on', () => {
  it('records the attempt as tampered, issues no certificate, and exports a zero reward on the tamper basis', async () => {
    let lines: string[] = []
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'read-barrier-tamper',
      tempDirPrefix: 'read-barrier-tamper-e2e-',
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
    const result = records.at(-1)
    expect(result).toMatchObject({ type: 'result', certified: false, verdicts: ['tampered'], exported: 1, rewarded: 0 })

    const events = records.flatMap(record => record.event === undefined ? [] : [record.event])
    const runs = events.filter(event => event.type === 'verification/run')
    expect(runs).toHaveLength(1)
    expect(runs[0]?.data).toMatchObject({
      verdict: 'tampered',
      isolation: 'none',
      executor: 'runner',
      results: [{
        checkId: 'marker-file',
        status: 'fail',
        evidence: 'not executed: the files this task is measured with were modified during the attempt',
      }],
    })
    expect(events.filter(event => event.type === 'verification/certificate')).toEqual([])
    const goals = events.filter(event => event.type === 'goal/change').map(event => event.data['operation'])
    expect(goals).toEqual(['create'])

    // The implementer's last user turn is the tamper directive, not a rerun of the task.
    const prompts = events
      .filter(event => event.type === 'user/message')
      .flatMap(event => (event.data['content'] as { type: string; text?: string }[]).map(block => block.text ?? ''))
    expect(prompts).toHaveLength(2)
    expect(prompts[1]).toBe(
      '<validation_failed>\nthe files this task is measured with were modified during the attempt\nThose files belong to the validator: the task is to make them pass, never to change them. This run is void and no certificate can follow it.\nContinue working on the task; the validator runs again when you stop.\n</validation_failed>',
    )

    expect(lines).toHaveLength(1)
    const trajectory = JSON.parse(lines[0] ?? '') as Trajectory
    expect(trajectory.reward).toMatchObject({ outcome: 0, basis: 'tamper', attempts: 1, directives: 1 })
    expect(trajectory.reward.goal?.phase).toBe('active')
    expect(trajectory.reward).not.toHaveProperty('certificate')
    expect(trajectory.environment?.environmentId).toBe('smoke:immutable-test')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
