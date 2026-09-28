/**
 * Keyless REAL-composition coverage of one enterprise shift: one boot of
 * `fixtures/enterprise-shift/cordis.yml` per case over a clone of a seeded
 * repository whose bare remote stands in for the development branch. The
 * scripted route plays every department and the reviewer, so what this proves
 * is the shift's wiring — the tickets are selected from the clone's queue and
 * ledger, each department is certified over its own committed worktree on the
 * ticket's acceptance and the engine's checks, a review that never saw the
 * department decides, only approved departments are assembled and recertified,
 * the push is a fast-forward of the remote or a rebase onto its moved tip, and
 * the ledger lines and the record travel with the shipped work — and nothing
 * about what a model can build. The overlay under the fixture's `overlays/` is
 * the same shift on the operator's Claude Code route.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { parseLedger, ticketStatuses } from './fixtures/enterprise-shift/shift.ts'
import type { TicketLedgerLine } from './fixtures/enterprise-shift/shift.ts'

const fixtureDir = fileURLToPath(new URL('./fixtures/enterprise-shift/', import.meta.url))
const seedDir = join(fixtureDir, 'seed')
const binScript = join(fixtureDir, 'driver.ts')
const configPath = join(fixtureDir, 'cordis.yml')
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** Several departments, their reviews, an assembly and a push outrun the default window. */
const PHASE_TIMEOUT_MS = 300_000

/** The trailer lines every commit of the shift ends with on the scripted route. */
const TRAILERS = [
  'Co-Authored-By: cli-mock <noreply@anthropic.com>',
  'Claude-Session: https://claude.ai/code/session_01HEXjzxR7CyMizem5kFAB4C',
]

/** The result line the driver prints last. */
interface ShiftResult {
  type: string
  shift: string
  record: string
  base: string
  programId: string
  report: { outcome?: string; mergedRevision?: string; goals: { key: string; status: string; revision?: string }[] }
  halt: { kind: string; resetsAt: string | null; failure: { code: string } } | null
  tickets: (TicketLedgerLine & { rationale: string })[]
  shiftCommit: string
  pushed: { commit: string; rounds: number } | null
  pushReason: string
  repo: string
}

const roots: string[] = []

afterAll(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trimEnd()
}

/** A bare remote holding the seed as `main`, and the tip it holds. */
async function seedRemote(): Promise<{ remote: string; base: string }> {
  const work = await mkdtemp(join(tmpdir(), 'enterprise-seed-'))
  const remotes = await mkdtemp(join(tmpdir(), 'enterprise-remote-'))
  roots.push(work, remotes)
  cpSync(seedDir, work, { recursive: true })
  git(work, 'init', '-q', '-b', 'main', '.')
  git(work, 'config', 'user.email', 'seed@example.test')
  git(work, 'config', 'user.name', 'seed')
  git(work, 'add', '-A')
  git(work, 'commit', '-qm', 'the seed repository and its ticket queue')
  const remote = join(remotes, 'origin.git')
  git(remotes, 'clone', '-q', '--bare', work, remote)
  return { remote, base: git(work, 'rev-parse', 'HEAD') }
}

/** Run one shift over a remote and read the result line back. */
async function runShift(remote: string, env: Record<string, string>, expectedExitCode = 0): Promise<ShiftResult> {
  const scratchRoot = await mkdtemp(join(tmpdir(), 'enterprise-scratch-'))
  roots.push(scratchRoot)
  const { stdout, stderr } = await runLoaderSmoke({
    label: 'enterprise-shift',
    tempDirPrefix: 'enterprise-shift-e2e-',
    binScript,
    libBinScript: binScript,
    configPath,
    binArgs: [configPath],
    tsconfigPath: repoTsconfig,
    processTimeoutMs: PHASE_TIMEOUT_MS,
    expectedExitCode,
    env: {
      DSH_ENTERPRISE_REMOTE: remote,
      DSH_ENTERPRISE_BRANCH: 'main',
      DSH_ENTERPRISE_SCRATCH: join(scratchRoot, 'shift'),
      DSH_ENTERPRISE_PUSH: '1',
      DSH_ENTERPRISE_QUEUE_POLICY: 'open',
      // The clone holds the department branches the assertions compare against.
      DSH_ENTERPRISE_KEEP: '1',
      ...env,
    },
  })
  expect(stderr).toBe('')
  const observed = JSON.parse(stdout.trimEnd().split('\n').at(-1) ?? '') as ShiftResult
  expect(observed.type).toBe('result')
  return observed
}

/** The commits of the remote's `main`, newest first, each with its full message. */
function remoteLog(remote: string): { sha: string; message: string }[] {
  const raw = git(remote, 'log', '--format=%H%x00%B%x01', 'main')
  return raw.split('\x01').map(entry => entry.trim()).filter(entry => entry !== '').map((entry) => {
    const [sha, message] = entry.split('\x00')
    return { sha: sha ?? '', message: (message ?? '').trimEnd() }
  })
}

/** The ledger the remote's `main` carries. */
function remoteLedger(remote: string): TicketLedgerLine[] {
  return parseLedger(git(remote, 'show', 'main:data/enterprise/ledger.jsonl'))
}

/** The line of one ticket in a result. */
function lineOf(observed: ShiftResult, ticket: string): TicketLedgerLine & { rationale: string } {
  const line = observed.tickets.find(candidate => candidate.ticket === ticket)
  expect(line, `no line for ${ticket}`).toBeDefined()
  return line as TicketLedgerLine & { rationale: string }
}

describe('an enterprise shift through a real cordis.yml over a seeded remote', () => {
  it('ships the approved ticket, records the failed and out-of-scope ones, and pushes the ledger with the work', async () => {
    const { remote, base } = await seedRemote()
    const observed = await runShift(remote, { DSH_ENTERPRISE_TICKETS: 'T-0001,T-0002,T-0004', DSH_ENTERPRISE_SHIFT: 'e2e-mixed' })

    // Not every department certified, so the program's own integration never
    // ran; the shift assembled the one approved department on its own.
    expect(observed.report.outcome).toBe('failed')
    expect(observed.report.goals.map(goal => [goal.key, goal.status])).toEqual([['t-0001', 'certified'], ['t-0002', 'failed'], ['t-0004', 'failed']])

    const shipped = lineOf(observed, 'T-0001')
    expect(shipped.department.outcome).toBe('certified')
    expect(shipped.checks).toEqual([
      { id: 'greets', ok: true },
      { id: 'engine-committed', ok: true },
      { id: 'engine-scope', ok: true },
      { id: 'engine-whitespace', ok: true },
    ])
    expect(shipped.review.verdict).toBe('approve')
    expect(shipped.review.sessionId).toMatch(/^review-t-0001-/)
    expect(shipped.integration.outcome).toBe('merged')
    expect(shipped.shipped?.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(shipped.seat).toBe('seed-tools-steward')
    expect(shipped.implementer).toBe('route')
    expect(shipped.model).toBe('cli-mock')
    expect(shipped.tokens).toBeGreaterThan(0)

    const failed = lineOf(observed, 'T-0002')
    expect(failed.department.outcome).toBe('failed')
    expect(failed.checks.find(check => check.id === 'answers')?.ok).toBe(false)
    expect(failed.review).toEqual({ verdict: 'none', sessionId: null })
    expect(failed.integration.outcome).toBe('skipped')
    expect(failed.shipped).toBeNull()

    const outside = lineOf(observed, 'T-0004')
    expect(outside.department.outcome).toBe('failed')
    expect(outside.checks.find(check => check.id === 'counts')?.ok).toBe(true)
    expect(outside.checks.find(check => check.id === 'engine-scope')?.ok).toBe(false)
    expect(outside.shipped).toBeNull()

    // The remote's main is the seed, the shipped ticket, then the shift's own
    // commit with the ledger and the record; the ticket commit names the
    // ticket, the seat, the program and both sessions, and ends with the trailers.
    expect(observed.pushed).toEqual({ commit: observed.shiftCommit, rounds: 1 })
    const log = remoteLog(remote)
    expect(log.map(entry => entry.sha)).toEqual([observed.shiftCommit, shipped.shipped?.commit, base])
    const ticketCommit = log[1]?.message ?? ''
    expect(ticketCommit.split('\n')[0]).toBe('T-0001: Add the greeting tool')
    expect(ticketCommit).toContain('Seat: seed-tools-steward (harness-core)')
    expect(ticketCommit).toContain(`Program: ${observed.programId}`)
    expect(ticketCommit).toContain(`Department session: ${shipped.department.sessionId ?? ''}`)
    expect(ticketCommit.split('\n').slice(-2)).toEqual(TRAILERS)
    expect(log[0]?.message.split('\n')[0]).toBe('chore(enterprise): shift e2e-mixed, shipped T-0001')
    expect(log[0]?.message.split('\n').slice(-2)).toEqual(TRAILERS)

    // The shipped commit carries exactly the department's tree, which stays on
    // the department branch of the clone and never reaches the remote itself.
    const department = observed.report.goals.find(goal => goal.key === 't-0001')
    expect(git(remote, 'rev-parse', `${shipped.shipped?.commit ?? ''}^{tree}`)).toBe(git(observed.repo, 'rev-parse', `${department?.revision ?? ''}^{tree}`))
    expect(spawnSync('git', ['cat-file', '-e', `${department?.revision ?? ''}^{commit}`], { cwd: remote, stdio: 'pipe' }).status).not.toBe(0)
    expect(git(remote, 'show', 'main:tools/greet.mjs')).toBe("console.log('hello')")

    // The ledger and the record travel with the work.
    const ledger = remoteLedger(remote)
    expect(ledger.map(line => [line.ticket, line.shift, line.shipped === null ? null : 'shipped'])).toEqual([
      ['T-0001', 'e2e-mixed', 'shipped'],
      ['T-0002', 'e2e-mixed', null],
      ['T-0004', 'e2e-mixed', null],
    ])
    expect([...ticketStatuses(ledger).entries()]).toEqual([['T-0001', 'shipped'], ['T-0002', 'open'], ['T-0004', 'open']])
    const files = git(remote, 'ls-tree', '-r', '--name-only', 'main', observed.record).split('\n')
    expect(files).toContain(`${observed.record}/result.json`)
    expect(files).toContain(`${observed.record}/manifest.json`)
    expect(files).toContain(`${observed.record}/sessions/${observed.programId}.jsonl`)
    expect(files).toContain(`${observed.record}/sessions/${shipped.review.sessionId ?? ''}.jsonl`)
    const manifest = JSON.parse(git(remote, 'show', `main:${observed.record}/manifest.json`)) as { files: { path: string }[]; base: string }
    expect(manifest.base).toBe(base)
    expect(manifest.files.map(file => file.path)).toEqual(expect.arrayContaining(['result.json', `sessions/${observed.programId}.jsonl`]))

    // The reviewer saw no tool, called none, and read the diff, the commit
    // messages and the checks from its own three messages; its session names
    // no parent and its working directory holds nothing.
    const reviewLog = git(remote, 'show', `main:${observed.record}/sessions/${shipped.review.sessionId ?? ''}.jsonl`)
      .split('\n').filter(line => line !== '').map(line => JSON.parse(line) as { type: string; data: Record<string, unknown> })
    const header = reviewLog.find(event => event.type === 'request/header')
    expect(header, 'the reviewer made no request').toBeDefined()
    expect(header?.data['tools']).toBeUndefined()
    const reviewMessages = reviewLog.filter(event => event.type === 'assistant/message')
    expect(reviewMessages).toHaveLength(1)
    const blocks = (reviewMessages[0]?.data['message'] as { content: { type: string }[] }).content
    expect(blocks.map(block => block.type)).toEqual(['text'])
    const userTexts = reviewLog.filter(event => event.type === 'user/message')
      .map(event => JSON.stringify(event.data))
    expect(userTexts.some(text => text.includes('<commits>') && text.includes('T-0001: the scripted department delivers'))).toBe(true)
    const session = reviewLog.find(event => event.type === 'session')?.data as { parentSessionId?: string; cwd?: string } | undefined
    expect(session?.parentSessionId).toBeUndefined()
  }, PHASE_TIMEOUT_MS + LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('does not ship a certified ticket the reviewer rejects, and closes it in the ledger', async () => {
    const { remote, base } = await seedRemote()
    const observed = await runShift(remote, { DSH_ENTERPRISE_TICKETS: 'T-0003', DSH_ENTERPRISE_SHIFT: 'e2e-reject' })
    const line = lineOf(observed, 'T-0003')
    expect(observed.report.outcome).toBe('released')
    expect(line.department.outcome).toBe('certified')
    expect(line.review.verdict).toBe('reject')
    expect(line.rationale).toContain('rejects T-0003')
    expect(line.integration.outcome).toBe('not-shipped')
    expect(line.shipped).toBeNull()
    expect(remoteLog(remote).map(entry => entry.sha)).toEqual([observed.shiftCommit, base])
    expect(git(remote, 'ls-tree', '--name-only', 'main', 'tools/bye.mjs')).toBe('')
    expect([...ticketStatuses(remoteLedger(remote)).entries()]).toEqual([['T-0003', 'rejected']])
  }, PHASE_TIMEOUT_MS + LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('rebases onto a tip that moved during the shift, recertifies, and ships', async () => {
    const { remote, base } = await seedRemote()
    const observed = await runShift(remote, { DSH_ENTERPRISE_TICKETS: 'T-0005', DSH_ENTERPRISE_SHIFT: 'e2e-moved' })
    const line = lineOf(observed, 'T-0005')
    // The one department certified, so the program integrated and the
    // assembled tree was checked against its merged tree before the tip moved.
    expect(observed.report.outcome).toBe('released')
    expect(observed.report.mergedRevision).toMatch(/^[0-9a-f]{40}$/)
    expect(line.integration.outcome).toBe('merged')
    expect(line.shipped?.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(observed.pushed).toEqual({ commit: observed.shiftCommit, rounds: 1 })
    const log = remoteLog(remote)
    expect(log.map(entry => entry.message.split('\n')[0])).toEqual([
      'chore(enterprise): shift e2e-moved, shipped T-0005',
      'T-0005: Add the echo tool',
      'the tip moved during the shift',
      'the seed repository and its ticket queue',
    ])
    expect(log[1]?.sha).toBe(line.shipped?.commit)
    expect(log[3]?.sha).toBe(base)
    expect(observed.base).toBe(log[2]?.sha)
    expect(git(remote, 'show', 'main:tools/echo.mjs')).toBe("console.log('echo')")
  }, PHASE_TIMEOUT_MS + LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('halts on the route limit, ships nothing, and records the reset with every ticket', async () => {
    const { remote, base } = await seedRemote()
    const observed = await runShift(remote, {
      DSH_ENTERPRISE_TICKETS: 'T-0001,T-0004',
      DSH_ENTERPRISE_SHIFT: 'e2e-limit',
      DSH_TEST_ENTERPRISE_LIMIT: '1',
    }, 3)
    expect(observed.halt?.kind).toBe('limit')
    expect(observed.halt?.failure.code).toBe('QUOTA')
    expect(observed.halt?.resetsAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    for (const ticket of ['T-0001', 'T-0004']) {
      const line = lineOf(observed, ticket)
      expect(line.department.outcome).toBe('halted')
      expect(line.reason.startsWith(`halted: limit (resets at ${observed.halt?.resetsAt ?? ''}`)).toBe(true)
      expect(line.checks).toEqual([])
      expect(line.review).toEqual({ verdict: 'none', sessionId: null })
      expect(line.shipped).toBeNull()
    }
    // The departments blocked on their refused turn rather than spending rounds
    // against the wall, and the ledger still reached the remote.
    expect(observed.report.goals.map(goal => goal.status)).toEqual(['blocked', 'blocked'])
    expect(remoteLog(remote).map(entry => entry.sha)).toEqual([observed.shiftCommit, base])
    expect(remoteLedger(remote).map(line => [line.ticket, line.department.outcome])).toEqual([['T-0001', 'halted'], ['T-0004', 'halted']])
  }, PHASE_TIMEOUT_MS + LOADER_SMOKE_TEST_TIMEOUT_MS)
})
