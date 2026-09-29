/**
 * Keyless REAL-composition coverage for the Program Departments coordinators'
 * intake: `scripts/enterprise-intake.ts` run as a process over a temporary git
 * repository minted from `fixtures/enterprise-intake/seed/` — a two-coordinator
 * roster and a one-ticket queue — booting `fixtures/enterprise-intake/cordis.yml`
 * through the fixture's driver on the scripted route.
 *
 * The scripted departments commit the proposal files under the fixture's
 * `scripted/`, so what this proves is the intake's own behaviour: the count
 * that decides whether anything is needed, the owner's requests answered
 * whether or not it is, admission as each department's verifier and again
 * across departments, the tickets it writes, the function lines it appends,
 * the record it keeps and the request states read back from it, and the stop
 * at the first usage-limit refusal. The overlay under the fixture's
 * `overlays/` is the same program on the operator's Claude Code route.
 */

import { execFile, execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import type { RequestStatus } from '../../../scripts/enterprise-requests.ts'
import type { Roster } from '../../../scripts/enterprise-roster.ts'
import { loadTickets, validateTickets } from '../../../scripts/enterprise-tickets.ts'

const fixtureDir = fileURLToPath(new URL('./fixtures/enterprise-intake/', import.meta.url))
const seedDir = join(fixtureDir, 'seed')
const composition = join(fixtureDir, 'cordis.yml')
const intakeScript = fileURLToPath(new URL('../../../scripts/enterprise-intake.ts', import.meta.url))
const requestsScript = fileURLToPath(new URL('../../../scripts/enterprise-requests.ts', import.meta.url))
const tsx = fileURLToPath(new URL('../../../node_modules/.bin/tsx', import.meta.url))

/** Booting the composition, two departments, two admissions and the integration outrun the default window. */
const PHASE_TIMEOUT_MS = 300_000

const ALPHA = 'program-departments-alpha-coordinator'
const BETA = 'program-departments-beta-coordinator'

/** The owner's requests one run meets: two it answers, one without a title line, one past `--max-requests`. */
const DRAIN_REQUEST = 'data/enterprise/requests/a-drain-cap.md'
const RETRIES_REQUEST = 'data/enterprise/requests/b-retries.md'
const UNTITLED_REQUEST = 'data/enterprise/requests/c-untitled.md'
const LATER_REQUEST = 'data/enterprise/requests/d-later.md'

/** The department keys the intake derives from the answered requests' file names. */
const DRAIN_KEY = 'request-a-drain-cap'
const RETRIES_KEY = 'request-b-retries'

/** The product's notice for a spent session window, as the Claude Code route receives it. */
const LIMIT_NOTICE = 'You\'ve hit your session limit · resets 8:20pm (UTC)'

/** The exact field set of a function line, shared with the enterprise functions. */
const FUNCTION_LINE_FIELDS = ['type', 'at', 'shift', 'seat', 'division', 'function', 'target', 'outcome', 'evidence', 'seconds']

interface IntakeRun {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
  readonly repo: string
  readonly scratch: string
  readonly calls: string[]
}

interface FunctionLine {
  readonly type: string
  readonly seat: string
  readonly division: string
  readonly function: string
  readonly target: { readonly commit: string }
  readonly outcome: string
  readonly evidence: { readonly path: string }
  readonly seconds: number
}

interface IntakeResult {
  readonly outcome: string
  readonly open: number
  readonly minOpen: number
  readonly program?: { readonly outcome: string | null }
  readonly decisions?: readonly {
    readonly transition: string
    readonly principal: { readonly kind: string; readonly id: string; readonly decidedBy: string }
  }[]
  readonly routeLimit?: { readonly message: string; readonly resetsAtIso?: string }
  readonly requests?: readonly {
    readonly path: string
    readonly result: string
    readonly ticket?: string
    readonly reason?: string
    readonly department?: { readonly key: string; readonly seat: string; readonly status: string; readonly outcome: string }
  }[]
  readonly coordinators?: readonly {
    readonly seat: string
    readonly openInSubsystem: number
    readonly status: string
    readonly ran: boolean
    readonly outcome: string
    readonly admitted: readonly string[]
    readonly refused: readonly { readonly index: number; readonly code: string; readonly reason: string }[]
  }[]
  readonly sessions?: readonly string[]
}

interface SeatRecord {
  readonly admission: {
    readonly verdicts: readonly {
      readonly index: number
      readonly admitted: boolean
      readonly code?: string
      readonly checks: readonly { readonly run: string; readonly exitCode: number | null }[]
    }[]
  }
}

const roots: string[] = []

afterAll(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** A git repository holding the seed and any extra files, committed, as a clean checkout the intake counts and fills. */
function mintRepository(extra: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'enterprise-intake-e2e-'))
  roots.push(root)
  const repo = join(root, 'repo')
  cpSync(seedDir, repo, { recursive: true })
  for (const [path, text] of Object.entries(extra)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true })
    writeFileSync(join(repo, path), text)
  }
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
  git('init', '-q', '.')
  git('config', 'user.email', 'intake-seed@example.test')
  git('config', 'user.name', 'intake seed')
  git('add', '-A')
  git('commit', '-qm', 'the intake seed: a two-coordinator roster and one queued ticket')
  return repo
}

/**
 * Run the intake as `pnpm run enterprise:intake` does, over a freshly minted
 * repository, with the scripted departments the script names.
 * @param args - the intake's arguments after the ones every run shares.
 * @param script - department key to scripted part, as `intake-llm.ts` reads it.
 * @param extra - files committed beside the seed, by repository path.
 * @returns the exit code, the streams, the repository and the department keys the route served.
 */
function runIntake(args: readonly string[], script: Record<string, unknown>, extra: Record<string, string> = {}): Promise<IntakeRun> {
  const repo = mintRepository(extra)
  const root = join(repo, '..')
  const scratch = join(root, 'scratch')
  const scriptPath = join(root, 'script.json')
  const callsPath = join(root, 'calls.txt')
  writeFileSync(scriptPath, JSON.stringify(script))
  writeFileSync(callsPath, '')
  const argv = [intakeScript, '--root', repo, '--composition', composition, '--scratch', scratch, '--install', 'none', ...args]
  return new Promise((resolveRun) => {
    execFile(tsx, argv, {
      cwd: root,
      encoding: 'utf8',
      timeout: PHASE_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      env: {
        ...process.env,
        DSH_HOME: join(root, '.dsh'),
        DSH_AGENTS_HOME: join(root, '.agents'),
        DSH_TEST_INTAKE_SCRIPT: scriptPath,
        DSH_TEST_INTAKE_CALLS: callsPath,
      },
    }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1
      const calls = readFileSync(callsPath, 'utf8').split('\n').filter(line => line !== '')
      resolveRun({ code, stdout, stderr, repo, scratch, calls })
    })
  })
}

function summaryOf(run: IntakeRun): { outcome: string; record: string; admitted?: string[] } {
  const line = run.stdout.trimEnd().split('\n').at(-1) ?? ''
  return JSON.parse(line) as { outcome: string; record: string; admitted?: string[] }
}

function ledgerOf(repo: string): FunctionLine[] {
  const path = join(repo, 'data/enterprise/ledger.jsonl')
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').trimEnd().split('\n').map(line => JSON.parse(line) as FunctionLine)
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown
}

function queueIds(repo: string): string[] {
  return readdirSync(join(repo, 'data/enterprise/tickets')).filter(name => name.endsWith('.json')).sort()
}

describe('the coordinators\' intake through a real cordis.yml', () => {
  it('records that nothing was needed while the queue holds --min-open open tickets', async () => {
    const run = await runIntake(['--min-open', '1'], {})
    expect(run.stderr).toBe('')
    expect(run.code).toBe(0)
    const summary = summaryOf(run)
    expect(summary.outcome).toBe('nothing-needed')
    const result = readJson(join(run.repo, summary.record, 'result.json')) as IntakeResult
    expect(result).toMatchObject({ outcome: 'nothing-needed', open: 1, minOpen: 1 })
    // Nothing ran: no department reached the route, no line, no ticket, no clone.
    expect(run.calls).toEqual([])
    expect(ledgerOf(run.repo)).toEqual([])
    expect(queueIds(run.repo)).toEqual(['T-0001.json'])
    expect(existsSync(run.scratch)).toBe(false)
  }, PHASE_TIMEOUT_MS)

  it('admits the proposals whose own checks fail, and refuses one that already passes and one that repeats a queued source', async () => {
    const run = await runIntake(
      ['--min-open', '5', '--coordinators', `${BETA},${ALPHA}`, '--max-tickets', '2'],
      { [ALPHA]: { proposals: 'alpha.json' }, [BETA]: { proposals: 'beta.json' } },
    )
    expect(run.stderr).toBe('')
    expect(run.code).toBe(0)
    const summary = summaryOf(run)
    expect(summary.outcome).toBe('ran')
    expect(summary.admitted).toEqual(['T-0002', 'T-0003'])

    // The admitted tickets continue the queue without a gap, in the program's
    // department order, and the whole queue still satisfies the validator.
    expect(queueIds(run.repo)).toEqual(['T-0001.json', 'T-0002.json', 'T-0003.json'])
    const roster = readJson(join(run.repo, 'data/enterprise/roster.json')) as Roster
    expect(validateTickets(loadTickets(run.repo), roster, run.repo)).toEqual([])
    const second = readJson(join(run.repo, 'data/enterprise/tickets/T-0002.json')) as { seat: string; source: { anchor: string } }
    const third = readJson(join(run.repo, 'data/enterprise/tickets/T-0003.json')) as { seat: string; source: { anchor: string } }
    expect([second.seat, second.source.anchor]).toEqual([ALPHA, 'The queue drains without a bound'])
    expect([third.seat, third.source.anchor]).toEqual([BETA, 'The cache never expires.'])

    // The coordinator with fewer open tickets is taken first whatever order
    // --coordinators names; both departments certified on their admission
    // check, and the integration released.
    expect(run.stdout).toContain(`${ALPHA} (0 open), ${BETA} (1 open)`)
    const result = readJson(join(run.repo, summary.record, 'result.json')) as IntakeResult
    expect(result.program?.outcome).toBe('released')
    // No person signed the unattended intake: its two decisions name the machine principal and the run.
    expect(result.decisions?.map(decision => [decision.transition, decision.principal.kind, decision.principal.id])).toEqual([
      ['spec-freeze', 'machine', 'daliesk-enterprise-intake'],
      ['release', 'machine', 'daliesk-enterprise-intake'],
    ])
    expect(result.decisions?.[0]?.principal.decidedBy).toMatch(/^the enterprise intake, run /)
    expect(result.coordinators?.map(entry => [entry.seat, entry.openInSubsystem, entry.status, entry.outcome, entry.admitted])).toEqual([
      [ALPHA, 0, 'merged', 'pass', ['T-0002']],
      [BETA, 1, 'merged', 'pass', ['T-0003']],
    ])
    expect(result.coordinators?.[0]?.refused.map(refusal => [refusal.index, refusal.code])).toEqual([[1, 'passes-before']])
    expect(result.coordinators?.[1]?.refused.map(refusal => [refusal.index, refusal.code])).toEqual([[0, 'duplicate']])
    expect(result.coordinators?.[1]?.refused[0]?.reason).toContain('T-0001')

    // The refusal keeps the check that already passed and its exit code.
    const alpha = readJson(join(run.repo, summary.record, `${ALPHA}.json`)) as SeatRecord
    expect(alpha.admission.verdicts[1]?.checks.map(check => [check.run, check.exitCode])).toEqual([
      ['grep -q timeoutSeconds packages/alpha/src/queue.json', 0],
    ])
    expect(alpha.admission.verdicts[0]?.checks.map(check => check.exitCode)).toEqual([1])

    // Each department's own session certified it on the admission check.
    const sessions = result.sessions ?? []
    expect(sessions).toHaveLength(4)
    for (const seat of [ALPHA, BETA]) {
      const id = sessions.find(candidate => candidate.endsWith(`-${seat}`))
      expect(id, seat).toBeDefined()
      const log = readFileSync(join(run.repo, summary.record, 'sessions', `${id ?? ''}.jsonl`), 'utf8')
      expect(log).toContain('"checkId":"admission","status":"pass"')
    }

    // One function line per coordinator, with exactly the shared field set.
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: run.repo, encoding: 'utf8' }).trim()
    const lines = ledgerOf(run.repo)
    expect(lines.map(line => Object.keys(line))).toEqual([FUNCTION_LINE_FIELDS, FUNCTION_LINE_FIELDS])
    expect(lines.map(line => [line.seat, line.division, line.function, line.outcome, line.target.commit])).toEqual([
      [ALPHA, 'program-departments', 'intake', 'pass', head],
      [BETA, 'program-departments', 'intake', 'pass', head],
    ])
    for (const line of lines) expect(existsSync(join(run.repo, line.evidence.path)), line.evidence.path).toBe(true)

    // The intake changed nothing committed and removed its clone.
    expect(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: run.repo, encoding: 'utf8' })).toBe('')
    expect(run.calls.filter(seat => seat === ALPHA).length).toBeGreaterThan(0)
    expect(existsSync(run.scratch) && readdirSync(run.scratch).length > 0).toBe(false)
  }, PHASE_TIMEOUT_MS)

  it('answers the owner\'s requests whether or not the queue needs a refill, and reads their states back', async () => {
    const run = await runIntake(
      ['--min-open', '1', '--max-requests', '2'],
      { [DRAIN_KEY]: { proposals: 'request-drain.json' }, [RETRIES_KEY]: { proposals: 'request-retries.json' } },
      {
        [DRAIN_REQUEST]: '# Cap the alpha drain\n\nOne drain should take at most a hundred jobs.\n',
        [RETRIES_REQUEST]: '# Bound the beta retries\n\nRetries should stop after a few attempts.\n',
        [UNTITLED_REQUEST]: 'Make the queue faster.\n',
        [LATER_REQUEST]: '# Answer me later\n\nThis one waits for the next intake.\n',
      },
    )
    expect(run.stderr).toBe('')
    expect(run.code).toBe(0)
    const summary = summaryOf(run)
    expect(summary.outcome).toBe('ran')
    expect(summary.admitted).toEqual(['T-0002'])

    // The one open ticket meets --min-open 1, so no coordinator refilled: only
    // the first two titled requests' departments reached the route, in
    // file-name order, staffed by the coordinators in turn, fewest open first.
    expect(run.stdout).toContain('1 open tickets, at least 1: no refill')
    expect(run.stdout).toContain(`${DRAIN_REQUEST} (${ALPHA}), ${RETRIES_REQUEST} (${BETA}); 1 left for a later intake`)
    expect([...new Set(run.calls)]).toEqual([DRAIN_KEY, RETRIES_KEY])

    // The admitted ticket answers its request at priority 0, and the queue still validates.
    const ticket = readJson(join(run.repo, 'data/enterprise/tickets/T-0002.json')) as { seat: string; source: unknown; priority: number }
    expect(ticket).toMatchObject({ seat: ALPHA, source: { path: DRAIN_REQUEST, anchor: '# Cap the alpha drain' }, priority: 0 })
    const roster = readJson(join(run.repo, 'data/enterprise/roster.json')) as Roster
    expect(validateTickets(loadTickets(run.repo), roster, run.repo)).toEqual([])

    // The record states what became of every request the run took up; the
    // request past --max-requests is not among them.
    const result = readJson(join(run.repo, summary.record, 'result.json')) as IntakeResult
    expect(result.coordinators).toEqual([])
    const requests = result.requests?.map(entry => [
      entry.path,
      entry.result,
      entry.ticket ?? entry.reason,
      entry.department?.key,
      entry.department?.seat,
    ])
    expect(requests).toEqual([
      [DRAIN_REQUEST, 'admitted', 'T-0002', DRAIN_KEY, ALPHA],
      [RETRIES_REQUEST, 'refused', 'a ticket answering a request takes priority 0', RETRIES_KEY, BETA],
      [UNTITLED_REQUEST, 'refused', expect.stringContaining('its first line is not `# <title>`'), undefined, undefined],
    ])

    // Each request's department that reached the route has its coordinator's function line.
    expect(ledgerOf(run.repo).map(line => [line.seat, line.function, line.outcome, line.evidence.path])).toEqual([
      [ALPHA, 'intake', 'pass', `${summary.record}/${DRAIN_KEY}.json`],
      [BETA, 'intake', 'fail', `${summary.record}/${RETRIES_KEY}.json`],
    ])

    // The owner reads the same back from the files the run left.
    const statuses = JSON.parse(execFileSync(tsx, [requestsScript, '--root', run.repo, '--json'], { encoding: 'utf8' })) as RequestStatus[]
    expect(statuses.map(status => [status.file, status.state, status.ticket ?? status.reason])).toEqual([
      [DRAIN_REQUEST, 'queued', 'T-0002'],
      [RETRIES_REQUEST, 'refused', 'a ticket answering a request takes priority 0'],
      [UNTITLED_REQUEST, 'refused', expect.stringContaining('its first line is not `# <title>`')],
      [LATER_REQUEST, 'waiting', undefined],
    ])
    expect(existsSync(run.scratch) && readdirSync(run.scratch).length > 0).toBe(false)
  }, PHASE_TIMEOUT_MS)

  it('stops at the first usage-limit refusal: no later request reaches the route, and nothing is admitted', async () => {
    const run = await runIntake(
      ['--min-open', '5', '--coordinators', `${ALPHA},${BETA}`, '--max-tickets', '2'],
      { [ALPHA]: { limit: LIMIT_NOTICE }, [BETA]: { proposals: 'beta.json' } },
    )
    expect(run.code).toBe(3)
    expect(run.stderr).toMatch(/stopped at its limit: .*You've hit your session limit.*/)
    expect(run.stderr).toMatch(/its limit lifts at \d{4}-\d{2}-\d{2}T20:20:00\.\d{3}Z/)
    const summary = summaryOf(run)
    expect(summary.outcome).toBe('route-limit')
    expect(summary.admitted).toEqual([])

    // The refused request is the only one the route saw: the beta department
    // was blocked on its first step without a request.
    expect(run.calls).toEqual([ALPHA])
    const result = readJson(join(run.repo, summary.record, 'result.json')) as IntakeResult
    expect(result.routeLimit?.message).toContain(LIMIT_NOTICE)
    expect(result.routeLimit?.resetsAtIso).toMatch(/T20:20:00\.\d{3}Z$/)
    expect(result.program?.outcome).toBe('failed')
    expect(result.coordinators?.map(entry => [entry.seat, entry.status, entry.ran, entry.outcome])).toEqual([
      [ALPHA, 'blocked', true, 'error'],
      [BETA, 'blocked', false, 'error'],
    ])

    // Only the coordinator whose department the refusal cut has a line; the
    // one that never reached the route did nothing a line could attest.
    expect(ledgerOf(run.repo).map(line => [line.seat, line.outcome])).toEqual([[ALPHA, 'error']])
    expect(queueIds(run.repo)).toEqual(['T-0001.json'])
  }, PHASE_TIMEOUT_MS)
})
