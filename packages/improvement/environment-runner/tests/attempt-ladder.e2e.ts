import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { EnvironmentRunReport } from '@deepseek-ai/dsh-environment-runner'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const binScript = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/attempt-ladder/driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/attempt-ladder/cordis.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

/** One laddered cell as the driver reports it. */
interface Cell {
  report: EnvironmentRunReport
  requestedModels: string[]
  prompts: string[]
  delegations: { attempt: number; restatedTask: boolean; runId: string }[]
}

interface DriverResult {
  type: string
  route: Cell
  delegated: Cell
  /** The runner's own messages in each delegated child's session, in attempt order. */
  childPrompts: string[][]
}

const TASK = 'Prove the CLI tool round trip.'
const DIRECTIVE = "<validation_failed>\n1 of the standard's checks failed\n1. exit 1\nContinue working on the task; the validator runs again when you stop.\n</validation_failed>"

describe('an attempt ladder through a real cordis.yml and headless process', () => {
  it('runs each attempt on its own rung and restates the task for a fresh child', async () => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'attempt-ladder',
      tempDirPrefix: 'attempt-ladder-e2e-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath],
      tsconfigPath: repoTsconfig,
    })
    expect(stderr).toBe('')
    const result = JSON.parse(stdout.trimEnd().split('\n').at(-1) ?? '') as DriverResult
    expect(result.type).toBe('result')

    // The ladder is the attempt bound: the composition allows one attempt and
    // both cells ran two, each on its own rung.
    for (const cell of [result.route, result.delegated]) {
      expect(cell.report.certified).toBe(false)
      expect(cell.report.attempts.map(attempt => attempt.model.model)).toEqual(['cli-mock-small', 'cli-mock-large'])
      expect(cell.report.attempts[0]?.model).not.toEqual(cell.report.attempts[1]?.model)
      expect(cell.report.stamp.model).toEqual({ provider: 'cli-mock', model: 'cli-mock-small' })
      expect(cell.report.stamp.ladder).toEqual([
        { provider: 'cli-mock', model: 'cli-mock-small' },
        { provider: 'cli-mock', model: 'cli-mock-large' },
      ])
    }

    // A route cell keeps its transcript: every request of the second attempt
    // went to the second rung, and the follow-up carries the directive alone.
    expect(result.route.report.attempts.map(attempt => attempt.transcript)).toEqual(['kept', 'kept'])
    expect(new Set(result.route.requestedModels)).toEqual(new Set(['cli-mock-small', 'cli-mock-large']))
    expect(result.route.requestedModels[0]).toBe('cli-mock-small')
    expect(result.route.requestedModels.at(-1)).toBe('cli-mock-large')
    expect(result.route.prompts).toEqual([TASK, DIRECTIVE])
    expect(result.route.delegations).toEqual([])

    // A delegated cell drops it: the cell drives no request of its own, and the
    // second child's prompt restates the task ahead of the same directive.
    expect(result.delegated.report.attempts.map(attempt => attempt.transcript)).toEqual(['dropped', 'dropped'])
    expect(result.delegated.requestedModels).toEqual([])
    expect(result.delegated.prompts).toEqual([])
    expect(result.delegated.delegations.map(entry => [entry.attempt, entry.restatedTask]))
      .toEqual([[1, false], [2, true]])
    // Two attempts, two children: the second holds none of the first one's work.
    expect(new Set(result.delegated.delegations.map(entry => entry.runId)).size).toBe(2)

    // What the fresh children were actually asked to do: the task alone, then
    // the task again ahead of the directive the first attempt earned.
    expect(result.childPrompts).toEqual([[TASK], [`${TASK}\n\n${DIRECTIVE}`]])
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
