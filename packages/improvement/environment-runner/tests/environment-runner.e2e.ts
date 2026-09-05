import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { EnvironmentRunReport } from '@deepseek-ai/dsh-environment-runner'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import type { Trajectory, TrajectoryExportReport } from '@deepseek-ai/dsh-trajectories'

const binScript = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/environment-run/driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/environment-run/cordis.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

interface DriverResult {
  type: string
  reports: EnvironmentRunReport[]
  report: TrajectoryExportReport
}

describe('environment runs through a real cordis.yml and headless process', () => {
  it('runs three environments as three stamped sessions and exports all but the held-out one', async () => {
    let lines: string[] = []
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'environment-run',
      tempDirPrefix: 'environment-run-e2e-',
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

    const [roundTrip, unsatisfiable, reserved] = result.reports
    expect(roundTrip).toMatchObject({ environment: 'smoke:round-trip', certified: true })
    expect(roundTrip?.attempts).toHaveLength(1)
    expect(roundTrip?.attempts[0]?.treeHash).toMatch(/^[0-9a-f]{64}$/)
    expect(roundTrip?.stamp).toMatchObject({ environmentId: 'smoke:round-trip', heldOut: false, repetition: 0, isolation: 'none', model: { provider: 'cli-mock', model: 'cli-mock' } })
    expect(roundTrip?.certificate?.results).toEqual([{ checkId: 'round-trip-prints', status: 'pass', evidence: 'exit 0\nstdout: CLI_TOOL_ROUND_TRIP' }])
    expect(roundTrip?.usage?.inputTokens).toBeGreaterThan(0)
    expect(unsatisfiable).toMatchObject({ environment: 'smoke:unsatisfiable', certified: false })
    expect(unsatisfiable?.attempts.map(attempt => attempt.results[0]?.status)).toEqual(['fail', 'fail'])
    expect(reserved).toMatchObject({ environment: 'smoke:reserved', certified: true })
    expect(reserved?.stamp.heldOut).toBe(true)
    expect(new Set(result.reports.map(report => report.sessionId)).size).toBe(3)

    expect(result.report).toEqual({ sessions: 3, exported: 2, rewarded: 1, filtered: 0, heldOut: 1, withheld: 0, skipped: [] })
    expect(lines).toHaveLength(2)
    const trajectories = lines.map(line => JSON.parse(line) as Trajectory)
    const byEnvironment = new Map(trajectories.map(trajectory => [trajectory.environment?.environmentId, trajectory]))
    const certified = byEnvironment.get(roundTrip?.stamp.environmentId)
    expect(certified?.reward).toMatchObject({ outcome: 1, basis: 'certificate', goal: { phase: 'complete' }, directives: 0, attempts: 1 })
    expect(certified?.environment).toEqual(roundTrip?.stamp)
    expect(certified?.provenance.components).toContain('environment:smoke:round-trip')
    expect(certified?.messages[0]).toMatchObject({ role: 'user', content: [{ type: 'text', text: 'Prove the CLI tool round trip.' }] })

    const failed = byEnvironment.get(unsatisfiable?.stamp.environmentId)
    expect(failed?.reward).toMatchObject({ outcome: 0, basis: 'certificate', goal: { phase: 'active' }, directives: 2, attempts: 2 })
    const followups = failed?.messages.filter(message => message.role === 'user').map(message => message.content[0]) ?? []
    expect(followups).toHaveLength(2)
    expect(followups[1]).toMatchObject({ type: 'text' })
    const text = followups[1]?.type === 'text' ? followups[1].text : ''
    expect(text.startsWith("<validation_failed>\n1 of the standard's checks failed\n1. exit 1")).toBe(true)
    expect(text.endsWith('Continue working on the task; the validator runs again when you stop.\n</validation_failed>')).toBe(true)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
