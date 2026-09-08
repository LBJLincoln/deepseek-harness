/**
 * With-key style coverage for a department delegated to a real external coding
 * agent: it drives the real Claude Code CLI on the host's own product
 * installation and authentication, so it is opt-in and run by hand. Set
 * `DSH_E2E_CLAUDE_CODE=1` after confirming that `claude -p "ok"` works in the
 * same shell; without it the suite self-skips.
 *
 * The program asks for one file, committed, and is certified on a check that
 * reads it from a clean worktree, so what passes is the commit the external
 * agent left on the department branch — nothing the agent says about itself.
 * The provider leaves the child under the host's native Claude settings and
 * authentication; the composition grants only what an unattended child cannot
 * ask for (file edits, `git add`, `git commit`, `git status`), and a host whose
 * settings deny more than that still records every attempt as `completed` and
 * the department as `failed`, because the file the check reads is not there.
 * Confirm that `claude -p` can create a file in a scratch directory before
 * reading a failure here as a harness defect.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const binScript = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/program-claude-implementer/driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/program-claude-implementer/cordis.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

/** A real external agent writing a file takes longer than a mock route ever does. */
const PHASE_TIMEOUT_MS = 600_000

interface DriverResult {
  type: string
  providers: string[]
  report: { programId: string; outcome?: string; mergedRevision?: string; goals: { key: string; status: string; reason?: string }[] }
  departments: { sessionId: string; delegations: { attempt: number; provider: string; stopReason: string }[]; certified: boolean }[]
}

const roots: string[] = []

afterAll(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe.skipIf(process.env.DSH_E2E_CLAUDE_CODE !== '1')('a department delegated to the real external coding agent', () => {
  it('certifies the tree the external agent left and releases the program', async () => {
    const sessions = await mkdtemp(join(tmpdir(), 'program-claude-sessions-'))
    const repository = await mkdtemp(join(tmpdir(), 'program-claude-repo-'))
    roots.push(sessions, repository)

    const { stdout, stderr } = await runLoaderSmoke({
      label: 'program-claude-implementer',
      tempDirPrefix: 'program-claude-implementer-e2e-',
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
    expect(observed.providers).toContain('claude-code')

    expect(observed.report.outcome).toBe('released')
    expect(observed.report.goals.map(goal => goal.status)).toEqual(['merged'])
    expect(observed.report.mergedRevision).toMatch(/^[0-9a-f]{40}$/)

    const department = observed.departments[0]
    expect(observed.departments).toHaveLength(1)
    expect(department?.certified).toBe(true)
    // Whatever it took, every attempt is one recorded run of the named provider.
    expect(department?.delegations.length).toBeGreaterThanOrEqual(1)
    expect(department?.delegations.map(delegation => delegation.provider)).toEqual(
      department?.delegations.map(() => 'claude-code'),
    )
    expect(department?.delegations.map(delegation => delegation.attempt))
      .toEqual(department?.delegations.map((_, index) => index + 1))
  }, PHASE_TIMEOUT_MS + LOADER_SMOKE_TEST_TIMEOUT_MS)
})
