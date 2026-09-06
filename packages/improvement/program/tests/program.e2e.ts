/**
 * Keyless REAL-composition coverage for the program ledger: three boots of one
 * `cordis.yml` over one persistence root and one temporary git repository. The
 * first runs a two-goal program with a dependency to its release; the second
 * starts a different program and dies the moment its first department is
 * recorded certified; the third reconciles that program from the department's
 * own log, starts only the goal that never ran, and releases.
 *
 * The mock implementer commits nothing, so each department branch head is the
 * base revision and the integration merges are already up to date. What the
 * fixture proves is the ledger, the department sessions and worktrees, the
 * per-session caps, and the reconciliation — not what a model can build.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import type { ProgramEnd, ProgramGoalRecord, ProgramIntegrationRecord, ProgramResume, ProgramStart } from '@deepseek-ai/dsh-program'

const binScript = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/program/driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/program/cordis.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

/** Three boots, each a full mock-model program, need more than the default window. */
const PHASE_TIMEOUT_MS = 180_000
const KILLED = 9
const RESTART_LABEL = 'restart'

interface LedgerLine {
  sessionId: string
  events: { type: string; data: unknown }[]
  signoffs: string[]
}

interface MemberLine {
  sessionId: string
  programId: string
  key: string
  certified: boolean
  caps: unknown
}

interface DriverResult {
  type: string
  report: { programId: string; sessionId: string; outcome?: string; mergedRevision?: string; goals: { key: string; status: string }[] }
  ledgers: LedgerLine[]
  members: MemberLine[]
}

const roots: string[] = []

afterAll(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/** Boot the driver once over the shared persistence root and repository. */
async function phase(
  sessions: string,
  repository: string,
  env: Record<string, string>,
  expectedExitCode = 0,
): Promise<string> {
  const { stdout, stderr } = await runLoaderSmoke({
    label: `program (${JSON.stringify(env)})`,
    tempDirPrefix: 'program-e2e-',
    binScript,
    libBinScript: binScript,
    configPath,
    binArgs: [configPath],
    tsconfigPath: repoTsconfig,
    processTimeoutMs: PHASE_TIMEOUT_MS,
    expectedExitCode,
    env: { DSH_TEST_SESSION_ROOT: sessions, DSH_TEST_PROGRAM_REPO: repository, ...env },
  })
  expect(stderr).toBe('')
  return stdout
}

/** The last JSON line the driver printed. */
function result(stdout: string): DriverResult {
  const parsed = JSON.parse(stdout.trimEnd().split('\n').at(-1) ?? '') as DriverResult
  expect(parsed.type).toBe('result')
  return parsed
}

/** The ledger of one program, by the session id its own start event carries. */
function ledgerOf(observed: DriverResult, programId: string): LedgerLine {
  const found = observed.ledgers.find(ledger => ledger.sessionId === programId)
  expect(found, `no ledger for ${programId}`).toBeDefined()
  return found as LedgerLine
}

/** The statuses one ledger recorded for one goal key, in log order. */
function statuses(ledger: LedgerLine, key: string): string[] {
  return ledger.events
    .filter(event => event.type === 'program/goal' && (event.data as ProgramGoalRecord).key === key)
    .map(event => (event.data as ProgramGoalRecord).status)
}

describe('the program ledger through a real cordis.yml, killed and restarted', () => {
  it('releases a two-goal program, then reconciles a killed one and releases it too', async () => {
    const sessions = await mkdtemp(join(tmpdir(), 'program-sessions-'))
    const repository = await mkdtemp(join(tmpdir(), 'program-repo-'))
    roots.push(sessions, repository)

    const first = result(await phase(sessions, repository, {}))
    expect(first.report.outcome).toBe('released')
    expect(first.report.goals.map(goal => [goal.key, goal.status])).toEqual([['api', 'merged'], ['docs', 'merged']])

    const ledger = ledgerOf(first, first.report.programId)
    const opened = ledger.events[0]?.data as ProgramStart
    expect(ledger.events[0]?.type).toBe('program/start')
    expect(opened.programId).toBe(first.report.programId)
    expect(opened.specSha256).toBe(first.report.programId.replace('program-', ''))
    expect(opened.baseRevision).toBe('base')
    expect(opened.signoff).toEqual({ artefactSha256: 'f'.repeat(64) })
    // Both signatures the deployment requires live in the program's own log.
    expect(ledger.signoffs).toEqual(['spec-freeze', 'release'])

    // The dependent goal only ever runs after the goal it depends on certified.
    expect(statuses(ledger, 'api')).toEqual(['pending', 'running', 'certified', 'merged'])
    expect(statuses(ledger, 'docs')).toEqual(['pending', 'running', 'certified', 'merged'])
    const integrations = ledger.events.filter(event => event.type === 'program/integration')
      .map(event => (event.data as ProgramIntegrationRecord).status)
    expect(integrations).toEqual(['running', 'certified'])
    const closing = ledger.events.at(-1)?.data as ProgramEnd
    expect(ledger.events.at(-1)?.type).toBe('program/end')
    expect(closing.outcome).toBe('released')
    expect(closing.mergedRevision).toMatch(/^[0-9a-f]{40}$/)

    // Every department and the integration is a member session of its program,
    // each carrying its own certificate and, for a department, its own caps.
    const members = first.members.filter(member => member.programId === first.report.programId)
    expect(members.map(member => member.key).sort()).toEqual(['@integration', 'api', 'docs'])
    expect(members.every(member => member.certified)).toBe(true)
    expect(members.filter(member => member.key !== '@integration').map(member => member.caps)).toEqual([
      { maxTotalTokens: 400_000, maxWallMs: 300_000 },
      { maxTotalTokens: 400_000, maxWallMs: 300_000 },
    ])

    // A second program over the same repository dies as its first department is
    // recorded certified, leaving a ledger with no closing record.
    await phase(sessions, repository, {
      DSH_TEST_PROGRAM_LABEL: RESTART_LABEL,
      DSH_TEST_PROGRAM_KILL_AFTER_CERTIFIED: '1',
    }, KILLED)

    const third = result(await phase(sessions, repository, { DSH_TEST_PROGRAM_LABEL: RESTART_LABEL }))
    expect(third.report.programId).not.toBe(first.report.programId)
    expect(third.report.outcome).toBe('released')

    const restarted = ledgerOf(third, third.report.programId)
    const resumed = restarted.events.filter(event => event.type === 'program/resume')
      .map(event => (event.data as ProgramResume).statuses)
    expect(resumed).toHaveLength(1)
    // The killed process left one certified department and one that never started.
    expect(resumed[0]).toMatchObject({ pending: 1, certified: 1, running: 0 })
    // `api` is recorded certified once, by whichever process observed it first;
    // it is never started again, and `docs` starts only in the third boot.
    expect(statuses(restarted, 'api').filter(status => status === 'running')).toHaveLength(1)
    expect(statuses(restarted, 'api').at(-1)).toBe('merged')
    expect(statuses(restarted, 'docs')).toEqual(['pending', 'running', 'certified', 'merged'])

    // One session per key, for every key of the restarted program.
    const restartedMembers = third.members.filter(member => member.programId === third.report.programId)
    expect(restartedMembers.map(member => member.key).sort()).toEqual(['@integration', 'api', 'docs'])
    expect(new Set(restartedMembers.map(member => member.sessionId)).size).toBe(3)
  }, PHASE_TIMEOUT_MS * 3 + LOADER_SMOKE_TEST_TIMEOUT_MS)
})
