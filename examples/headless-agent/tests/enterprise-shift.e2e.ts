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
 * about what a model can build. Every clone carries a pre-push hook that
 * refuses every push, as the repository's own hook refuses a push from a clone
 * whose root is not installed, and every shift names a heavy lock its heavy
 * acceptance runs take. Every shift also carries a credential-named variable
 * the seeded heavy check fails on, so a ticket shipping through that check
 * shows the variable reached neither the department's check nor the engine's
 * recertification. The overlay under the fixture's `overlays/` is the same
 * shift on the operator's Claude Code route.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { SCRIPTED_REPORTER } from './fixtures/enterprise-shift/enterprise-llm.ts'
import { parseLedger, parseShiftStarts, ticketStatuses } from './fixtures/enterprise-shift/shift.ts'
import type { ShiftStartLine, TicketLedgerLine } from './fixtures/enterprise-shift/shift.ts'
import { repositoryGit, verifyLedgerHistory } from '../../../scripts/verify-enterprise-ledger.ts'

const fixtureDir = fileURLToPath(new URL('./fixtures/enterprise-shift/', import.meta.url))
const seedDir = join(fixtureDir, 'seed')
const binScript = join(fixtureDir, 'driver.ts')
const configPath = join(fixtureDir, 'cordis.yml')
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const installHook = fileURLToPath(new URL('../../../scripts/install-lefthook.mjs', import.meta.url))

/**
 * The lint check's command in the seeded repository: this repository's oxlint
 * wrapper, which lints the seed with oxlint's default rules, every warning
 * failing the run.
 */
const SEED_LINT_RUN = [
  fileURLToPath(new URL('../../../node_modules/.bin/tsx', import.meta.url)),
  fileURLToPath(new URL('../../../scripts/run-oxlint.ts', import.meta.url)),
].map(path => `'${path}'`).concat('--deny-warnings').join(' ')

/** The file the seed's postinstall writes once the repository's install hook accepted the checkout. */
const INSTALL_GUARD_PASSED = 'node_modules/.install-guard-passed'
/**
 * Every seeded install appends its directory here, so the installs of a
 * program's worktrees stay provable after the engine removes the worktrees
 * before it recertifies the assembled tree.
 */
const INSTALL_LOG = join(tmpdir(), `enterprise-shift-installs-${process.pid}.log`)
process.env['DSH_E2E_INSTALL_LOG'] = INSTALL_LOG

/** A credential-named variable in the engine's environment; `seed/checks/coverage.sh` fails wherever it arrives. */
const CANARY_CREDENTIAL = 'ENTERPRISE_E2E_API_TOKEN'

/** The reason the engine records for the seeded `T-0006`, whose acceptance chains a push. */
const REFUSED_PUSH = 'refused: acceptance sixes: `git push` is not an allowed acceptance command; only `git diff` is; the ticket must be rewritten before a shift works it'

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
  decisions: { transition: string; principal: { kind: string; id: string; decidedBy: string }; artefactSha256: string }[]
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

/**
 * A bare remote holding the seed as `main`, and the tip it holds. The seed is
 * a pnpm project without dependencies whose postinstall runs this
 * repository's install hook in its read-only `--check` mode, so every offline
 * install of a shift's worktree or checkout passes the same repository
 * configuration guard a real install of this repository does.
 */
async function seedRemote(): Promise<{ remote: string; base: string }> {
  const work = await mkdtemp(join(tmpdir(), 'enterprise-seed-'))
  const remotes = await mkdtemp(join(tmpdir(), 'enterprise-remote-'))
  roots.push(work, remotes)
  cpSync(seedDir, work, { recursive: true })
  writeFileSync(join(work, 'package.json'), `${JSON.stringify({
    name: 'enterprise-seed',
    private: true,
    scripts: { postinstall: `node '${installHook}' --check && mkdir -p node_modules && touch ${INSTALL_GUARD_PASSED} && pwd >> "$\{DSH_E2E_INSTALL_LOG:-/dev/null}"` },
  }, null, 2)}\n`)
  writeFileSync(join(work, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\n\nimporters:\n\n  .: {}\n")
  writeFileSync(join(work, '.gitignore'), 'node_modules/\n')
  git(work, 'init', '-q', '-b', 'main', '.')
  git(work, 'config', 'user.email', 'seed@example.test')
  git(work, 'config', 'user.name', 'seed')
  git(work, 'add', '-A')
  git(work, 'commit', '-qm', 'the seed repository and its ticket queue')
  const remote = join(remotes, 'origin.git')
  git(remotes, 'clone', '-q', '--bare', work, remote)
  return { remote, base: git(work, 'rev-parse', 'HEAD') }
}

/** What a pushing clone's pre-push hook prints before it refuses the push. */
const HOOK_REFUSAL = 'the seeded pre-push hook refuses every push'

/**
 * A git template directory whose `pre-push` hook refuses every push. The
 * shift's clone is created from it, so the hook sits in the clone's shared
 * hooks directory the way the offline install puts the repository's own there.
 */
async function refusingHooks(): Promise<string> {
  const template = await mkdtemp(join(tmpdir(), 'enterprise-template-'))
  roots.push(template)
  mkdirSync(join(template, 'hooks'))
  writeFileSync(join(template, 'hooks', 'pre-push'), `#!/bin/sh\necho '${HOOK_REFUSAL}' >&2\nexit 1\n`)
  chmodSync(join(template, 'hooks', 'pre-push'), 0o755)
  return template
}

/** Commit one file's appended text to the remote's `main` from a scratch clone, as another writer of the branch would. */
async function appendOnRemote(remote: string, path: string, text: string, subject: string): Promise<void> {
  const work = await mkdtemp(join(tmpdir(), 'enterprise-writer-'))
  roots.push(work)
  git(work, 'clone', '-q', remote, '.')
  mkdirSync(join(work, path, '..'), { recursive: true })
  writeFileSync(join(work, path), text, { flag: 'a' })
  git(work, 'add', '--', path)
  git(work, '-c', 'user.name=writer', '-c', 'user.email=writer@example.test', 'commit', '-qm', subject)
  git(work, 'push', '-q', 'origin', 'HEAD:main')
}

/** The start lines the remote's `main` carries. */
function remoteStarts(remote: string): ShiftStartLine[] {
  return parseShiftStarts(git(remote, 'show', 'main:data/enterprise/shift-starts.jsonl'))
}

/** Run one shift over a remote and read the result line back, with the refusing hook and a heavy lock of its own. */
async function runShift(remote: string, env: Record<string, string>, expectedExitCode = 0): Promise<ShiftResult & { heavyLock: string }> {
  const scratchRoot = await mkdtemp(join(tmpdir(), 'enterprise-scratch-'))
  roots.push(scratchRoot)
  const heavyLock = join(scratchRoot, 'heavy.lock')
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
      GIT_TEMPLATE_DIR: await refusingHooks(),
      ENTERPRISE_HEAVY_LOCK: heavyLock,
      ENTERPRISE_PUSH_LOCK: join(scratchRoot, 'push.lock'),
      DSH_ENTERPRISE_LINT_RUN: SEED_LINT_RUN,
      [CANARY_CREDENTIAL]: 'e2e-canary-credential',
      ...env,
    },
  })
  expect(stderr).toBe('')
  const observed = JSON.parse(stdout.trimEnd().split('\n').at(-1) ?? '') as ShiftResult
  expect(observed.type).toBe('result')
  return { ...observed, heavyLock }
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

/**
 * The append-only gate's violations over every push the remote's `main` took
 * since `base`, one per string, after checking that some of those pushes
 * changed the ledger.
 */
function ledgerViolations(remote: string, base: string): string[] {
  const verified = verifyLedgerHistory(repositoryGit(remote), base, 'main')
  expect(verified.commits.length).toBeGreaterThan(0)
  return verified.violations.map(violation => `${violation.commit} ${violation.kind}: ${violation.detail}`)
}

/** The line of one ticket in a result. */
function lineOf(observed: ShiftResult, ticket: string): TicketLedgerLine & { rationale: string } {
  const line = observed.tickets.find(candidate => candidate.ticket === ticket)
  expect(line, `no line for ${ticket}`).toBeDefined()
  return line as TicketLedgerLine & { rationale: string }
}

describe('an enterprise shift through a real cordis.yml over a seeded remote', () => {
  it('ships the approved ticket, records the failed, out-of-scope and refused ones, and pushes the ledger with the work', async () => {
    const { remote, base } = await seedRemote()
    const observed = await runShift(remote, { DSH_ENTERPRISE_TICKETS: 'T-0001,T-0002,T-0004,T-0006', DSH_ENTERPRISE_SHIFT: 'e2e-mixed' })

    // Not every department certified, so the program's own integration never
    // ran; the shift assembled the one approved department on its own.
    expect(observed.report.outcome).toBe('failed')
    expect(observed.report.goals.map(goal => [goal.key, goal.status])).toEqual([['t-0001', 'certified'], ['t-0002', 'failed'], ['t-0004', 'failed']])

    // T-0001's heavy check fails wherever the credential-named variable
    // arrives: it passed in the department's standard, through the composed
    // shell, and again in the engine's recertification, which shipped it.
    const shipped = lineOf(observed, 'T-0001')
    expect(shipped.department.outcome).toBe('certified')
    expect(shipped.checks).toEqual([
      { id: 'greets', ok: true },
      { id: 'coverage', ok: true },
      { id: 'engine-committed', ok: true },
      { id: 'engine-scope', ok: true },
      { id: 'engine-whitespace', ok: true },
      { id: 'engine-lint', ok: true },
    ])
    expect(shipped.review.verdict).toBe('approve')
    expect(shipped.review.sessionId).toMatch(/^review-t-0001-/)
    // The line names the reviewer: its own session, and the route and model the
    // composition's reviewer entry resolved, which are not the departments'.
    expect(shipped.reviewer).toEqual({ sessionId: shipped.review.sessionId, route: 'cli-mock', model: 'cli-mock-reviewer', verdict: 'approve' })
    expect(shipped.integration.outcome).toBe('merged')
    expect(shipped.shipped?.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(shipped.seat).toBe('seed-tools-steward')
    expect(shipped.implementer).toBe('route')
    expect(shipped.model).toBe('cli-mock')
    expect(shipped.tokens).toBeGreaterThan(0)

    const failed = lineOf(observed, 'T-0002')
    expect(failed.department.outcome).toBe('failed')
    expect(failed.checks.find(check => check.id === 'answers')?.ok).toBe(false)
    // The department also left a `debugger` statement, which the repository's
    // oxlint refused over the one file it changed.
    expect(failed.checks.find(check => check.id === 'engine-lint')?.ok).toBe(false)
    expect(git(remote, 'show', `main:${observed.record}/sessions/${failed.department.sessionId ?? ''}.jsonl`)).toContain('no-debugger')
    expect(failed.review).toEqual({ verdict: 'none', sessionId: null })
    expect(failed.reviewer).toBeUndefined()
    expect(failed.integration.outcome).toBe('skipped')
    expect(failed.shipped).toBeNull()

    // Every worktree of the program and the clone's checkout installed through
    // the repository's install hook, which refuses a format-0 repository that
    // carries the worktree-config extension the departments' push block needs.
    expect(git(observed.repo, 'config', 'core.repositoryFormatVersion')).toBe('1')
    expect(git(observed.repo, 'config', 'extensions.worktreeConfig')).toBe('true')
    const installed = readFileSync(INSTALL_LOG, 'utf8')
    for (const key of ['t-0001', 't-0002', 't-0004', '@integration']) {
      expect(installed, key).toContain(join(observed.programId, key))
    }
    // T-0006 chains a push into its acceptance: the engine refused it before
    // any department ran, so it has no worktree, no session and no check.
    expect(installed).not.toContain(join(observed.programId, 't-0006'))
    const refused = lineOf(observed, 'T-0006')
    expect(refused.department).toEqual({ outcome: 'blocked', sessionId: null })
    expect(refused.reason).toBe(REFUSED_PUSH)
    expect([refused.checks, refused.review, refused.integration, refused.shipped]).toEqual([[], { verdict: 'none', sessionId: null }, { outcome: 'skipped' }, null])
    // The worktrees were removed before the assembled tree was recertified at
    // the clone's root, so a gate that walks the filesystem sees only that tree.
    expect(existsSync(join(observed.repo, observed.programId))).toBe(false)
    expect(existsSync(join(observed.repo, INSTALL_GUARD_PASSED))).toBe(true)

    const outside = lineOf(observed, 'T-0004')
    // The T-0004 department also tried to push its branch, through `origin` and
    // by the remote's URL; its worktree sends every push to a URL nothing serves,
    // so the remote holds the one branch the engine pushed.
    expect(git(remote, 'for-each-ref', '--format=%(refname)')).toBe('refs/heads/main')
    const pushAttempts = git(remote, 'show', `main:${observed.record}/sessions/${outside.department.sessionId ?? ''}.jsonl`)
    expect(pushAttempts).toContain('push-attempts')
    expect(pushAttempts.match(/remote-no-push/g)?.length).toBeGreaterThanOrEqual(2)
    expect(outside.department.outcome).toBe('failed')
    expect(outside.checks.find(check => check.id === 'counts')?.ok).toBe(true)
    expect(outside.checks.find(check => check.id === 'engine-scope')?.ok).toBe(false)
    expect(outside.shipped).toBeNull()

    // The clone's pre-push hook refuses a push that runs it; the shift's own
    // push skipped it and reached the remote in its first round.
    const probe = spawnSync('git', ['push', remote, 'HEAD:refs/heads/hook-probe'], { cwd: observed.repo, encoding: 'utf8' })
    expect(probe.status).not.toBe(0)
    expect(probe.stderr).toContain(HOOK_REFUSAL)

    // The remote's main is the seed, the shift's start line, pushed before any
    // department ran and the base of every worktree, the shipped ticket, then
    // the shift's own commit with the ledger and the record; the ticket commit
    // names the ticket, the seat, the program and both sessions, and ends with the trailers.
    expect(observed.pushed).toEqual({ commit: observed.shiftCommit, rounds: 1 })
    const log = remoteLog(remote)
    expect(log.map(entry => entry.sha)).toEqual([observed.shiftCommit, shipped.shipped?.commit, observed.base, base])
    expect(log[2]?.message.split('\n')[0]).toBe('chore(enterprise): shift e2e-mixed starts over T-0001, T-0002, T-0004, T-0006')
    expect(log[2]?.message.split('\n').slice(-2)).toEqual(['Co-Authored-By: Daliesk enterprise shift <noreply@anthropic.com>', TRAILERS[1]])
    expect(git(remote, 'diff', '--name-only', base, observed.base)).toBe('data/enterprise/shift-starts.jsonl')
    expect(remoteStarts(remote)).toEqual([expect.objectContaining({
      type: 'shift-start', shift: 'e2e-mixed', tickets: ['T-0001', 'T-0002', 'T-0004', 'T-0006'], base, host: hostname(), implementer: 'route',
    })])
    const ticketCommit = log[1]?.message ?? ''
    expect(ticketCommit.split('\n')[0]).toBe('T-0001: Add the greeting tool')
    expect(ticketCommit).toContain('Shift: Daliesk shift e2e-mixed')
    expect(ticketCommit).toContain('Seat: seed-tools-steward (harness-core)')
    // Every commit the shift made, and the department's own, is authored and
    // committed by the repository's rule; the enterprise is named in the body.
    for (const sha of [observed.shiftCommit, shipped.shipped?.commit ?? '']) {
      expect(git(remote, 'log', '-1', '--format=%an <%ae> %cn <%ce>', sha)).toBe('Claude <noreply@anthropic.com> Claude <noreply@anthropic.com>')
    }
    expect(log[0]?.message).toContain('Daliesk shift e2e-mixed')
    expect(ticketCommit).toContain(`Program: ${observed.programId}`)
    expect(ticketCommit).toContain(`Department session: ${shipped.department.sessionId ?? ''}`)
    expect(ticketCommit).toContain(`Review session: ${shipped.review.sessionId ?? ''}\nReviewer: cli-mock-reviewer on cli-mock`)
    expect(ticketCommit.split('\n').slice(-2)).toEqual(TRAILERS)
    expect(log[0]?.message.split('\n')[0]).toBe('chore(enterprise): shift e2e-mixed, shipped T-0001')
    expect(log[0]?.message.split('\n').slice(-2)).toEqual(TRAILERS)

    // The shipped commit carries exactly the department's tree, which stays on
    // the department branch of the clone and never reaches the remote itself.
    const department = observed.report.goals.find(goal => goal.key === 't-0001')
    expect(git(remote, 'rev-parse', `${shipped.shipped?.commit ?? ''}^{tree}`)).toBe(git(observed.repo, 'rev-parse', `${department?.revision ?? ''}^{tree}`))
    expect(git(observed.repo, 'log', '-1', '--format=%an <%ae>', department?.revision ?? '')).toBe('Claude <noreply@anthropic.com>')
    expect(spawnSync('git', ['cat-file', '-e', `${department?.revision ?? ''}^{commit}`], { cwd: remote, stdio: 'pipe' }).status).not.toBe(0)
    expect(git(remote, 'show', 'main:tools/greet.mjs')).toBe("console.log('hello')")

    // The ledger and the record travel with the work.
    const ledger = remoteLedger(remote)
    expect(ledger.map(line => [line.ticket, line.shift, line.shipped === null ? null : 'shipped'])).toEqual([
      ['T-0001', 'e2e-mixed', 'shipped'],
      ['T-0002', 'e2e-mixed', null],
      ['T-0004', 'e2e-mixed', null],
      ['T-0006', 'e2e-mixed', null],
    ])
    expect([...ticketStatuses(ledger).entries()]).toEqual([['T-0001', 'shipped'], ['T-0002', 'open'], ['T-0004', 'open'], ['T-0006', 'open']])
    expect(ledgerViolations(remote, base)).toEqual([])
    const files = git(remote, 'ls-tree', '-r', '--name-only', 'main', observed.record).split('\n')
    expect(files).toContain(`${observed.record}/result.json`)
    expect(files).toContain(`${observed.record}/manifest.json`)
    expect(files).toContain(`${observed.record}/sessions/${observed.programId}.jsonl`)
    expect(files).toContain(`${observed.record}/sessions/${shipped.review.sessionId ?? ''}.jsonl`)
    // No person signed anything: the program session carries no signature, and
    // the record names the engine as the machine principal of both decisions.
    const programLog = git(remote, 'show', `main:${observed.record}/sessions/${observed.programId}.jsonl`)
    expect(programLog).not.toContain('signoff/recorded')
    const recorded = JSON.parse(git(remote, 'show', `main:${observed.record}/result.json`)) as { decisions: ShiftResult['decisions'] }
    expect(recorded.decisions).toEqual(observed.decisions)
    expect(observed.decisions.map(decision => [decision.transition, decision.principal])).toEqual(['spec-freeze', 'release'].map(transition => [
      transition,
      { kind: 'machine', id: 'daliesk-enterprise-shift', decidedBy: 'the enterprise-shift engine, shift e2e-mixed' },
    ]))
    expect(JSON.stringify(recorded)).not.toContain('"human"')
    // Every recorded byte went through the shared masking: the reporter's
    // address the departments' commits credit reached the reviewer's evidence
    // and the department's log, and the record holds only its marker.
    const recordText = files.filter(file => file !== '').map(file => git(remote, 'show', `main:${file}`)).join('\n')
    expect(recordText).not.toContain(SCRIPTED_REPORTER)
    expect(git(remote, 'show', `main:${observed.record}/sessions/${shipped.review.sessionId ?? ''}.jsonl`)).toContain('Reported-by: [REDACTED-EMAIL]')
    const manifest = JSON.parse(git(remote, 'show', `main:${observed.record}/manifest.json`)) as { files: { path: string }[]; base: string }
    expect(manifest.base).toBe(observed.base)
    expect(manifest.files.map(file => file.path)).toEqual(expect.arrayContaining(['result.json', `sessions/${observed.programId}.jsonl`]))

    // The heavy acceptance command ran under the shift's heavy lock — the
    // seeded check passes only while the lock is held — and the light one ran
    // as written; the objective named the lock and the heavy fragments.
    const departmentLog = git(remote, 'show', `main:${observed.record}/sessions/${shipped.department.sessionId ?? ''}.jsonl`)
      .split('\n').filter(entry => entry !== '').map(entry => JSON.parse(entry) as { type: string; data: Record<string, unknown> })
    const standard = departmentLog.find(event => event.type === 'verification/standard')?.data['standard'] as { checks: { id: string; run: string }[] } | undefined
    expect(standard?.checks.slice(0, 2)).toEqual([
      { id: 'greets', outcome: 'acceptance greets of T-0001 exits 0', run: 'node tools/greet.mjs | grep -qx hello' },
      { id: 'coverage', outcome: 'acceptance coverage of T-0001 exits 0', run: `flock '${observed.heavyLock}' bash -c 'sh checks/coverage.sh --coverage'` },
    ])
    expect(JSON.stringify(departmentLog.find(event => event.type === 'goal/change')?.data)).toContain(`flock ${observed.heavyLock} <command>`)

    // The reviewer saw no tool, called none, and read the diff, the commit
    // messages and the checks from its own three messages; its session names
    // no parent and its working directory holds nothing.
    const reviewLog = git(remote, 'show', `main:${observed.record}/sessions/${shipped.review.sessionId ?? ''}.jsonl`)
      .split('\n').filter(line => line !== '').map(line => JSON.parse(line) as { type: string; data: Record<string, unknown> })
    const header = reviewLog.find(event => event.type === 'request/header')
    expect(header, 'the reviewer made no request').toBeDefined()
    expect(header?.data['tools']).toBeUndefined()
    // The reviewer's request went out on the reviewer's model, the department's on its own.
    expect((header?.data['header'] as { config: unknown }).config).toEqual({ provider: 'cli-mock', model: 'cli-mock-reviewer' })
    const departmentHeader = departmentLog.find(event => event.type === 'request/header')?.data['header'] as { config: unknown } | undefined
    expect(departmentHeader?.config).toEqual({ provider: 'cli-mock', model: 'cli-mock' })
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

  it('does not ship a certified ticket the reviewer rejects, closes it in the ledger, and closes a shift a reset cut off', async () => {
    const { remote, base } = await seedRemote()
    // Two earlier shifts started and recorded no end: one on a host that is
    // gone, whose ticket counts an abandoned attempt, and one on this host whose
    // process is alive, which is still running and is left alone.
    const crashed: ShiftStartLine = { type: 'shift-start', at: '2026-09-28T20:00:00.000Z', shift: 'e2e-crashed', tickets: ['T-0002'], base, host: 'a-container-since-reset', pid: 1, implementer: 'route' }
    const running: ShiftStartLine = { ...crashed, shift: 'e2e-running', tickets: ['T-0004'], host: hostname(), pid: process.pid }
    await appendOnRemote(remote, 'data/enterprise/shift-starts.jsonl', `${JSON.stringify(crashed)}\n${JSON.stringify(running)}\n`, 'two shifts started')
    const seeded = git(remote, 'rev-parse', 'main')
    const observed = await runShift(remote, { DSH_ENTERPRISE_TICKETS: 'T-0003', DSH_ENTERPRISE_SHIFT: 'e2e-reject' })
    const line = lineOf(observed, 'T-0003')
    expect(observed.report.outcome).toBe('released')
    expect(line.department.outcome).toBe('certified')
    expect(line.review.verdict).toBe('reject')
    expect(line.reviewer).toEqual({ sessionId: line.review.sessionId, route: 'cli-mock', model: 'cli-mock-reviewer', verdict: 'reject' })
    expect(line.rationale).toContain('rejects T-0003')
    expect(line.integration.outcome).toBe('not-shipped')
    expect(line.shipped).toBeNull()
    const log = remoteLog(remote)
    expect(log.map(entry => entry.sha)).toEqual([observed.shiftCommit, observed.base, seeded, base])
    expect(log[1]?.message).toContain('It closes e2e-crashed, which started and recorded no end, as abandoned: container reset.')
    expect(git(remote, 'ls-tree', '--name-only', 'main', 'tools/bye.mjs')).toBe('')
    const ledger = remoteLedger(remote)
    expect(ledger.map(entry => [entry.ticket, entry.shift, entry.department.outcome])).toEqual([['T-0002', 'e2e-crashed', 'abandoned'], ['T-0003', 'e2e-reject', 'certified']])
    expect(ledger[0]?.reason.startsWith(`abandoned: container reset: shift e2e-crashed started at ${crashed.at} on a-container-since-reset over ${base}`)).toBe(true)
    expect([...ticketStatuses(ledger).entries()]).toEqual([['T-0002', 'open'], ['T-0003', 'rejected']])
    expect(ledgerViolations(remote, base)).toEqual([])
    expect(remoteStarts(remote).map(start => start.shift)).toEqual(['e2e-crashed', 'e2e-running', 'e2e-reject'])
  }, PHASE_TIMEOUT_MS + LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('refuses a reviewer model its route does not declare before any department runs, and records why on every ticket', async () => {
    const { remote } = await seedRemote()
    const observed = await runShift(remote, { DSH_ENTERPRISE_TICKETS: 'T-0001', DSH_ENTERPRISE_SHIFT: 'e2e-no-reviewer', DSH_ENTERPRISE_REVIEW_MODEL: 'cli-mock-absent' })
    const line = lineOf(observed, 'T-0001')
    // The program never started, so the shift has no report.
    expect(observed.report as unknown).toBeNull()
    expect(line.department).toEqual({ outcome: 'failed', sessionId: null })
    expect(line.reason).toBe('the shift\'s reviewer route does not resolve: enterprise-llm: provider route "cli-mock" has no configured model "cli-mock-absent"')
    expect(line.review).toEqual({ verdict: 'none', sessionId: null })
    expect(line.reviewer).toBeUndefined()
    expect(line.shipped).toBeNull()
    expect(remoteLedger(remote).map(entry => [entry.ticket, entry.shift, entry.department.outcome])).toEqual([['T-0001', 'e2e-no-reviewer', 'failed']])
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
      'chore(enterprise): shift e2e-moved starts over T-0005',
      'the seed repository and its ticket queue',
    ])
    expect(log[1]?.sha).toBe(line.shipped?.commit)
    expect(log[4]?.sha).toBe(base)
    expect(observed.base).toBe(log[2]?.sha)
    expect(git(remote, 'show', 'main:tools/echo.mjs')).toBe("console.log('echo')")
    // The shipped commit the ledger names is the rebased one, on the branch that carries the line.
    expect(ledgerViolations(remote, base)).toEqual([])
  }, PHASE_TIMEOUT_MS + LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('refuses a shift whose every ticket carries a disallowed acceptance command, runs no department, and pushes the reason', async () => {
    const { remote, base } = await seedRemote()
    const observed = await runShift(remote, { DSH_ENTERPRISE_TICKETS: 'T-0006', DSH_ENTERPRISE_SHIFT: 'e2e-refused' })
    expect(observed.report).toBeNull()
    expect(observed.programId).toBe('')
    const line = lineOf(observed, 'T-0006')
    expect(line.department).toEqual({ outcome: 'blocked', sessionId: null })
    expect(line.reason).toBe(REFUSED_PUSH)
    expect(observed.pushed).toEqual({ commit: observed.shiftCommit, rounds: 1 })
    expect(remoteLog(remote).map(entry => entry.sha)).toEqual([observed.shiftCommit, observed.base, base])
    expect(remoteLedger(remote).map(entry => [entry.ticket, entry.department.outcome, entry.reason])).toEqual([['T-0006', 'blocked', REFUSED_PUSH]])
    expect(ledgerViolations(remote, base)).toEqual([])
    expect(git(remote, 'for-each-ref', '--format=%(refname)')).toBe('refs/heads/main')
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
    expect(remoteLog(remote).map(entry => entry.sha)).toEqual([observed.shiftCommit, observed.base, base])
    expect(remoteLedger(remote).map(line => [line.ticket, line.department.outcome])).toEqual([['T-0001', 'halted'], ['T-0004', 'halted']])
  }, PHASE_TIMEOUT_MS + LOADER_SMOKE_TEST_TIMEOUT_MS)
})
