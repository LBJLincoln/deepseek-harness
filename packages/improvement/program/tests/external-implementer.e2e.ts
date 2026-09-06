/**
 * Keyless REAL-composition coverage for a program whose departments are staffed
 * through the subagent seam: one boot of one `cordis.yml` over one temporary git
 * repository, running a goal the mock route's child satisfies and one nothing
 * can. What the fixture proves is that the program delegates once per attempt,
 * records each run in the department's own log, works in the department
 * worktree, runs the checks itself, and certifies or spends the round cap — not
 * what an external agent can build.
 *
 * The in-process `spawn` provider stands in for an out-of-process coding agent:
 * its child joins the parent's composition, so the keyless mock route serves it
 * and the department's own workspace is what the child derives its cwd from.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const binScript = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/program-external-implementer/driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/program-external-implementer/cordis.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

/** Two full mock-model programs in one boot need more than the default window. */
const PHASE_TIMEOUT_MS = 180_000

/** The round cap the fixture's composition gives every department. */
const MAX_GOAL_ROUNDS = 2

interface DelegationLine {
  attempt: number
  provider: string
  runId: string
  stopReason: string
}

interface DepartmentLine {
  sessionId: string
  delegations: DelegationLine[]
  certified: boolean
  requests: number
}

interface ChildLine {
  sessionId: string
  parentSession: string | undefined
  cwd: string | undefined
}

interface GoalLine {
  key: string
  status: string
  sessionId?: string
  reason?: string
}

interface ProgramLine {
  report: { programId: string; sessionId: string; outcome?: string; goals: GoalLine[] }
  departments: DepartmentLine[]
  children: ChildLine[]
}

interface DriverResult {
  type: string
  providers: string[]
  certifying: ProgramLine
  failing: ProgramLine
}

const roots: string[] = []

afterAll(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('a program whose departments an external coding agent staffs', () => {
  it('certifies a delegated department and spends the round cap on one it cannot certify', async () => {
    const sessions = await mkdtemp(join(tmpdir(), 'program-delegated-sessions-'))
    const repository = await mkdtemp(join(tmpdir(), 'program-delegated-repo-'))
    roots.push(sessions, repository)

    const { stdout, stderr } = await runLoaderSmoke({
      label: 'program-external-implementer',
      tempDirPrefix: 'program-external-implementer-e2e-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath],
      tsconfigPath: repoTsconfig,
      processTimeoutMs: PHASE_TIMEOUT_MS,
      env: { DSH_TEST_SESSION_ROOT: sessions, DSH_TEST_PROGRAM_REPO: repository },
    })
    expect(stderr).toBe('')
    const observed = JSON.parse(stdout.trimEnd().split('\n').at(-1) ?? '') as DriverResult
    expect(observed.type).toBe('result')
    expect(observed.providers).toContain('spawn')

    // The goal the mock's child satisfies: one delegated run, the checks the
    // program ran itself, and a release.
    const { certifying } = observed
    expect(certifying.report.outcome).toBe('released')
    expect(certifying.report.goals.map(goal => goal.status)).toEqual(['merged'])
    const department = certifying.departments[0] as DepartmentLine
    expect(certifying.departments).toHaveLength(1)
    expect(department.delegations).toEqual([
      { attempt: 1, provider: 'spawn', runId: expect.any(String) as unknown as string, stopReason: 'completed' },
    ])
    expect(department.certified).toBe(true)
    // The department never asked a model anything: the child it delegated to did.
    expect(department.requests).toBe(0)

    // The child ran under the department, in the department's own worktree.
    expect(certifying.children).toHaveLength(1)
    const child = certifying.children[0] as ChildLine
    expect(child.parentSession).toBe(department.sessionId)
    expect(child.cwd).toBe(join(repository, certifying.report.programId, 'api'))
    expect(child.sessionId).toBe(department.delegations[0]?.runId)

    // The goal nothing can satisfy: one delegated run per attempt, up to the cap.
    const { failing } = observed
    expect(failing.report.outcome).toBe('failed')
    expect(failing.report.goals[0]?.status).toBe('failed')
    expect(failing.report.goals[0]?.reason).toBe(`no certificate after ${String(MAX_GOAL_ROUNDS)} rounds`)
    const unsatisfied = failing.departments[0] as DepartmentLine
    expect(unsatisfied.delegations.map(delegation => delegation.attempt)).toEqual([1, 2])
    expect(unsatisfied.certified).toBe(false)
    expect(failing.children).toHaveLength(MAX_GOAL_ROUNDS)
    // The two programs are two identities over one repository.
    expect(failing.report.programId).not.toBe(certifying.report.programId)
  }, PHASE_TIMEOUT_MS + LOADER_SMOKE_TEST_TIMEOUT_MS)
})
