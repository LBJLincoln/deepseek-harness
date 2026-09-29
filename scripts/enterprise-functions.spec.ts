import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  CI_REPOSITORY,
  defaultShift,
  VERIFIER_COMMANDS,
  foldSessionStats,
  GATE_GROUPS,
  gateCommand,
  gateEnvironment,
  groupVerdict,
  observedRecords,
  parseCliArguments,
  parseJobLog,
  plainText,
  proxyHint,
  runFunctions,
  SCOREBOARD_PATH,
  seatOccupancy,
  TELEMETRY_PATH,
  verdictOf,
  verifierScript,
  type FunctionsOptions,
  type GateResult,
  type GitHubReader,
  type ScoreboardSnapshot,
  type TelemetrySnapshot,
} from './enterprise-functions.ts'
import { appendLedger, readLedger, type FunctionLine } from './enterprise-ledger.ts'
import { buildRoster, type Roster } from './enterprise-roster.ts'

const root = resolve(import.meta.dirname, '..')
const COMMIT = '6fb91bb110919ffd1652a497fe3c0b4074c1e6f6'
const OLDER = '58a4f364fa2f1f7a1b3c4d5e6f708192a3b4c5d6'
const NOW = new Date('2026-09-28T18:00:00.000Z')
/** A small committed record: one harness-loop session with model usage, enough to fold facts and stats over. */
const RECORD = 'data/proving-ground/2026-09-07-bench-smoke-harness-loop'

let roster: Roster
beforeAll(() => {
  roster = buildRoster(root, { generatedAt: NOW.toISOString(), recorded: [], ledger: [] })
})

const dirs: string[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'enterprise-functions-'))
  dirs.push(dir)
  return dir
}

/** A gate runner that passes every gate but the one named, printing each script it ran. */
function scriptedGates(failing: string, ran: string[] = []): FunctionsOptions['runGate'] {
  return (script) => {
    ran.push(script)
    const result: GateResult = script === failing
      ? { outcome: 'fail', output: `\u001B[31m${script}: 2 problems\u001B[0m  \n`, seconds: 3.25 }
      : { outcome: 'pass', output: `${script}: ok\n`, seconds: 1.5 }
    return Promise.resolve(result)
  }
}

/** One Branch CI job log as GitHub serves it: timestamped lines, the run-gates mode line, PASS lines and the failure summary. */
function jobLog(mode: string, passed: readonly string[], failed: readonly string[] = [], skipped: readonly string[] = []): string {
  const lines = [
    `2026-09-28T00:50:00.7596428Z $ tsx scripts/run-gates.ts ${mode}`,
    `2026-09-28T00:50:00.9858934Z run-gates: ${mode} running ${passed.length + failed.length + skipped.length} gate(s) with 2 worker(s) from $DSH_GATE_CONCURRENCY.`,
    ...passed.map(label => `2026-09-28T00:50:01.8651658Z run-gates: PASS ${label} (0.87s)`),
    `2026-09-28T01:03:43.0260930Z run-gates: ${passed.length} passed, ${failed.length} failed, ${skipped.length} skipped in 789.14s.`,
  ]
  if (failed.length + skipped.length > 0) {
    lines.push('2026-09-28T01:03:43.0261673Z run-gates: unsuccessful gates:')
    for (const label of failed) lines.push(`2026-09-28T01:03:43.0262255Z   - FAILED ${label} (58.58s, exit 1)`, `2026-09-28T01:03:43.0263111Z     pnpm run ${label}`)
    for (const label of skipped) lines.push(`2026-09-28T01:03:43.0262255Z   - SKIPPED ${label} (0.00s, no exit code or signal)`)
  }
  return `${lines.join('\n')}\n`
}

const RUN_ID = 36363609888
const JOBS = [
  { id: 1, name: 'node 24 / static', conclusion: 'success', started: '2026-09-28T00:49:14Z', completed: '2026-09-28T00:52:38Z' },
  { id: 2, name: 'node 24 / snapshots and artifacts', conclusion: 'failure', started: '2026-09-28T00:49:15Z', completed: '2026-09-28T01:03:47Z' },
  { id: 3, name: 'node 24 / coverage', conclusion: 'failure', started: '2026-09-28T00:49:14Z', completed: '2026-09-28T00:58:03Z' },
] as const
const CONSUMER_GATES = ['build', 'Node compatibility', 'publint', 'built package invariants', 'lint and duplication', 'web browser snapshot', 'doc-typecheck:contracts-ready', 'node-next types', 'built-bin smoke']

/**
 * A reader over one recorded Branch CI run: the commit's own run when `headSha`
 * matches, else the branch's newest; three jobs whose logs are the real lanes'.
 * `compared` is GitHub's comparison of the asked-for commit with the run's
 * head, `behind` (an older head) unless a test states another.
 */
function recordedGithub(headSha: string, requests: string[] = [], compared = 'behind'): GitHubReader {
  const run = { id: RUN_ID, head_sha: headSha, conclusion: 'failure', html_url: `https://github.com/${CI_REPOSITORY}/actions/runs/${RUN_ID}` }
  return {
    json: (path) => {
      requests.push(path)
      if (path.includes('/workflows/branch-ci.yml/runs?head_sha=')) {
        return Promise.resolve({ workflow_runs: path.includes(`head_sha=${headSha}`) ? [run] : [] })
      }
      if (path.includes('/workflows/branch-ci.yml/runs?branch=')) return Promise.resolve({ workflow_runs: [run] })
      if (path === `/repos/${CI_REPOSITORY}/compare/${COMMIT}...${headSha}`) return Promise.resolve({ status: compared })
      if (path === `/repos/${CI_REPOSITORY}/actions/runs/${RUN_ID}/jobs?per_page=100`) {
        return Promise.resolve({
          jobs: JOBS.map(job => ({
            id: job.id,
            name: job.name,
            status: 'completed',
            conclusion: job.conclusion,
            html_url: `https://github.com/${CI_REPOSITORY}/actions/runs/${RUN_ID}/job/${job.id}`,
            started_at: job.started,
            completed_at: job.completed,
          })),
        })
      }
      return Promise.reject(new Error(`unexpected GET ${path}`))
    },
    text: (path) => {
      requests.push(path)
      if (path.endsWith('/jobs/1/logs')) return Promise.resolve(jobLog('ci-static', ['runtime closure', 'constraints', 'knip']))
      if (path.endsWith('/jobs/2/logs')) return Promise.resolve(jobLog('ci-consumers', CONSUMER_GATES, ['test:snapshot']))
      if (path.endsWith('/jobs/3/logs')) return Promise.resolve(jobLog('ci-coverage', ['test:coverage-exempt-heavy'], ['test:coverage']))
      return Promise.reject(new Error(`unexpected GET ${path}`))
    },
  }
}

function options(overrides: Partial<FunctionsOptions> = {}): FunctionsOptions {
  const out = tempDir()
  return {
    root,
    roster,
    commit: COMMIT,
    shift: 'shift-test',
    branch: 'claude/coding-agent-harness-u9l4gt',
    now: () => NOW,
    runGate: scriptedGates('verify-md-links'),
    github: recordedGithub(COMMIT),
    divisions: new Set(['verification', 'judging', 'observatory', 'curation-data']),
    records: [RECORD],
    ledgerFile: join(out, 'ledger.jsonl'),
    outputRoot: out,
    ...overrides,
  }
}

describe('parseJobLog', () => {
  it('reads the mode line, the PASS lines and the failure summary through GitHub\'s timestamps', () => {
    const log = parseJobLog(jobLog('ci-consumers', ['build', 'lint and duplication'], ['test:snapshot'], ['built-bin smoke']))
    expect(log.mode).toBe('ci-consumers')
    expect([...log.gates]).toEqual([['build', 'pass'], ['lint and duplication', 'pass'], ['test:snapshot', 'fail'], ['built-bin smoke', 'skipped']])
  })

  it('reads no mode from a log run-gates never wrote', () => {
    expect(parseJobLog('2026-09-28T00:50:00.7596428Z Set up job\n')).toEqual({ mode: undefined, gates: new Map() })
  })
})

describe('groupVerdict', () => {
  it('rules a group only when every gate of it is shown by name', () => {
    const gates = parseJobLog(jobLog('ci-consumers', CONSUMER_GATES, ['test:snapshot'])).gates
    expect(groupVerdict(GATE_GROUPS['ci-lint-contracts-ready'] ?? [], gates)).toBe('pass')
    expect(groupVerdict(GATE_GROUPS['ci-snapshot'] ?? [], gates)).toBe('fail')
    expect(groupVerdict(GATE_GROUPS['ci-artifacts'] ?? [], gates)).toBe('pass')
    expect(groupVerdict(['build', 'publint', 'a gate this log never ran'], gates)).toBeUndefined()
    const skipped = parseJobLog(jobLog('ci-consumers', ['build'], ['publint'], ['node-next types', 'built package invariants', 'built-bin smoke'])).gates
    expect(groupVerdict(GATE_GROUPS['ci-artifacts'] ?? [], skipped)).toBe('fail')
    expect(groupVerdict(['build', 'node-next types'], skipped)).toBe('error')
  })

  it('maps a job conclusion to a verdict', () => {
    expect(verdictOf('success')).toBe('pass')
    expect(verdictOf('failure')).toBe('fail')
    expect(verdictOf('cancelled')).toBe('error')
    expect(verdictOf(null)).toBe('error')
  })
})

describe('verifierScript', () => {
  it('maps a verifier seat to the root package script its source names, and refuses one that has none', () => {
    const seat = roster.agents.find(agent => agent.id === 'verification-verify-md-links')
    expect(seat).toBeDefined()
    if (seat === undefined) return
    expect(verifierScript(seat, { 'verify-md-links': 'tsx scripts/verify-md-links.ts' })).toEqual({ gate: 'verify-md-links', command: 'verify-md-links' })
    expect(() => verifierScript(seat, {})).toThrow(/package\.json has no "verify-md-links" script/)
  })

  it('runs a gate that needs a build through the script that builds and then verifies, and requires both', () => {
    const seat = roster.agents.find(agent => agent.id === 'verification-verify-doc-site-fragments')
    expect(seat).toBeDefined()
    if (seat === undefined) return
    expect(VERIFIER_COMMANDS['verify-doc-site-fragments']).toBe('docs:build:mpa')
    const scripts = { 'verify-doc-site-fragments': 'tsx scripts/verify-doc-site-fragments.ts', 'docs:build:mpa': 'vitepress build && pnpm run verify-doc-site-fragments' }
    expect(verifierScript(seat, scripts)).toEqual({ gate: 'verify-doc-site-fragments', command: 'docs:build:mpa' })
    expect(() => verifierScript(seat, { 'verify-doc-site-fragments': 'tsx scripts/verify-doc-site-fragments.ts' })).toThrow(/no "docs:build:mpa" script/)
  })
})

describe('runFunctions', () => {
  it('runs every verifier\'s gate on the commit and records each real outcome with its log', async () => {
    const ran: string[] = []
    const opts = options({ runGate: scriptedGates('verify-md-links', ran), divisions: new Set(['verification']) })
    const report = await runFunctions(opts)
    const verifiers = roster.agents.filter(agent => agent.division === 'verification')
    const gates = verifiers.map(agent => agent.source.replace(/^scripts\//, '').replace(/\.ts$/, ''))
    expect(ran).toEqual(gates.map(gate => VERIFIER_COMMANDS[gate] ?? gate))
    expect(ran).toContain('docs:build:mpa')
    expect(report.lines.map(line => line.function)).toEqual(gates)
    expect(report.lines).toHaveLength(verifiers.length)
    expect(report.vacant).toEqual([])
    const failed = report.lines.find(line => line.seat === 'verification-verify-md-links')
    expect(failed).toMatchObject({ type: 'function', division: 'verification', function: 'verify-md-links', outcome: 'fail', seconds: 3.3, target: { commit: COMMIT }, shift: 'shift-test', at: NOW.toISOString() })
    expect(failed?.evidence).toEqual({ path: 'data/enterprise/functions/shift-test/verification-verify-md-links.log' })
    // The stored output is plain: the gate's styling and trailing spaces are gone.
    const log = readFileSync(join(opts.outputRoot, 'data/enterprise/functions/shift-test/verification-verify-md-links.log'), 'utf8')
    expect(log).toBe(`# pnpm run verify-md-links on ${COMMIT} at ${NOW.toISOString()}: fail (3.3s)\nverify-md-links: 2 problems\n`)
    expect(report.lines.filter(line => line.outcome === 'pass')).toHaveLength(verifiers.length - 1)
    expect(readLedger(opts.ledgerFile).lines).toEqual(report.lines)
  })

  it('reads the commit\'s Branch CI run: one verdict per lane and per gate group shown by name, none for lanes this fork lacks', async () => {
    const requests: string[] = []
    const opts = options({ github: recordedGithub(COMMIT, requests), divisions: new Set(['judging']) })
    const report = await runFunctions(opts)
    expect(report.ciRun).toEqual({ id: RUN_ID, commit: COMMIT, url: `https://github.com/${CI_REPOSITORY}/actions/runs/${RUN_ID}` })
    const verdicts = Object.fromEntries(report.lines.map(line => [line.seat, line.outcome]))
    expect(verdicts).toEqual({
      'judging-ci-static': 'pass',
      'judging-ci-consumers': 'fail',
      'judging-ci-lint-contracts-ready': 'pass',
      'judging-ci-snapshot': 'fail',
      'judging-ci-artifacts': 'pass',
      'judging-ci-coverage': 'fail',
    })
    const consumers = report.lines.find(line => line.seat === 'judging-ci-consumers')
    expect(consumers).toMatchObject({
      function: 'ci-consumers',
      at: '2026-09-28T01:03:47.000Z',
      seconds: 872,
      target: { commit: COMMIT },
      evidence: { url: `https://github.com/${CI_REPOSITORY}/actions/runs/${RUN_ID}/job/2` },
    })
    expect(report.lines.find(line => line.seat === 'judging-ci-snapshot')?.evidence).toEqual({ url: `https://github.com/${CI_REPOSITORY}/actions/runs/${RUN_ID}/job/2` })
    expect(report.vacant.map(seat => seat.seat).sort()).toEqual([
      'judging-ci-linux-primary',
      'judging-ci-primary',
      'judging-ci-windows-blocking',
      'judging-ci-windows-complete',
      'judging-ci-windows-observational',
    ])
    expect(report.vacant.every(seat => seat.reason.length > 0)).toBe(true)
    expect(requests.some(path => path.includes('runs?branch='))).toBe(false)
  })

  it('falls back to the branch\'s newest completed run, whose head is older, and names its commit and the asked-for one', async () => {
    const opts = options({ github: recordedGithub(OLDER), divisions: new Set(['judging']) })
    const report = await runFunctions(opts)
    expect(report.ciRun?.commit).toBe(OLDER)
    expect(report.lines.length).toBeGreaterThan(0)
    for (const line of report.lines) expect(line.target).toEqual({ commit: OLDER, requested: COMMIT })
  })

  it('reads the first later run whose head contains a commit its own superseded run left unjudged, and names that head', async () => {
    const later = 'a9e2968fe0000000000000000000000000000000'
    const newest = 'c132ccfcb0000000000000000000000000000000'
    const requests: string[] = []
    const recorded = recordedGithub(later, requests)
    const runOn = (id: number, head: string, conclusion: string): Record<string, unknown> =>
      ({ id, head_sha: head, conclusion, html_url: `https://github.com/${CI_REPOSITORY}/actions/runs/${id}` })
    // Newest first, as the API lists them: a cancelled run is never compared,
    // and the scan stops at the first head older than the commit.
    const branch = [runOn(RUN_ID + 3, newest, 'success'), runOn(RUN_ID + 2, 'cancelled-head', 'cancelled'), runOn(RUN_ID, later, 'failure'), runOn(RUN_ID - 1, OLDER, 'success'), runOn(RUN_ID - 2, 'never-compared', 'success')]
    const compared: Record<string, string> = { [newest]: 'ahead', [later]: 'ahead', [OLDER]: 'behind' }
    const github: GitHubReader = {
      json: async (path) => {
        if (path.includes('runs?head_sha=')) {
          requests.push(path)
          return { workflow_runs: [runOn(RUN_ID + 1, COMMIT, 'cancelled')] }
        }
        if (path.includes('runs?branch=')) {
          requests.push(path)
          return { workflow_runs: branch }
        }
        const head = path.split('...')[1]
        if (path.startsWith(`/repos/${CI_REPOSITORY}/compare/${COMMIT}...`) && head !== undefined && head in compared) {
          requests.push(path)
          return { status: compared[head] }
        }
        return recorded.json(path)
      },
      text: recorded.text,
    }
    const report = await runFunctions(options({ github, divisions: new Set(['judging']) }))
    expect(report.ciRun).toEqual({ id: RUN_ID, commit: later, url: `https://github.com/${CI_REPOSITORY}/actions/runs/${RUN_ID}` })
    expect(report.lines).toHaveLength(6)
    for (const line of report.lines) expect(line.target).toEqual({ commit: COMMIT, via: later })
    expect(requests.filter(path => path.includes('/compare/')).map(path => path.split('...')[1])).toEqual([newest, later, OLDER])
  })

  it('leaves every judge vacant, saying why, when the branch has no completed run', async () => {
    const github: GitHubReader = { json: () => Promise.resolve({ workflow_runs: [] }), text: () => Promise.reject(new Error('no log')) }
    const report = await runFunctions(options({ github, divisions: new Set(['judging']) }))
    expect(report.lines).toEqual([])
    expect(report.ciRun).toBeUndefined()
    expect(report.vacant).toHaveLength(11)
    expect(report.vacant.find(seat => seat.seat === 'judging-ci-static')?.reason).toBe('no Branch CI run on claude/coding-agent-harness-u9l4gt has rendered a verdict')
  })

  it('passes over a cancelled run, which rendered no verdict, for the newest that did', async () => {
    const requests: string[] = []
    const recorded = recordedGithub(COMMIT, requests)
    const cancelled = { id: RUN_ID + 1, head_sha: COMMIT, conclusion: 'cancelled', html_url: `https://github.com/${CI_REPOSITORY}/actions/runs/${RUN_ID + 1}` }
    const github: GitHubReader = {
      json: async (path) => {
        const body = await recorded.json(path)
        if (path.includes('runs?head_sha=') && typeof body === 'object' && body !== null && 'workflow_runs' in body && Array.isArray(body.workflow_runs)) {
          return { workflow_runs: [cancelled, ...body.workflow_runs as unknown[]] }
        }
        return body
      },
      text: recorded.text,
    }
    const report = await runFunctions(options({ github, divisions: new Set(['judging']) }))
    expect(report.ciRun?.id).toBe(RUN_ID)
    expect(report.lines).toHaveLength(6)
  })

  it('leaves the judges vacant with the failure when the API cannot be read, and still runs the other divisions', async () => {
    vi.stubEnv('HTTPS_PROXY', '')
    vi.stubEnv('https_proxy', '')
    const github: GitHubReader = { json: () => Promise.reject(new Error('GET /runs answered 503')), text: () => Promise.reject(new Error('unreachable')) }
    const opts = options({ github, divisions: new Set(['judging', 'observatory']) })
    const report = await runFunctions(opts)
    expect(report.lines.map(line => line.seat)).toEqual(['observatory-session-stats-observer'])
    expect(report.vacant.find(seat => seat.seat === 'judging-ci-coverage')?.reason).toBe('Branch CI could not be read: GET /runs answered 503')
    expect(report.vacant.find(seat => seat.seat === 'judging-ci-primary')?.reason).toMatch(/runner pools/)
  })

  it('names the proxy Node\'s fetch is not reading when one is configured and the API cannot be read', async () => {
    vi.stubEnv('HTTPS_PROXY', 'http://127.0.0.1:34863')
    vi.stubEnv('NODE_USE_ENV_PROXY', '')
    expect(proxyHint()).toBe(' (HTTPS_PROXY names http://127.0.0.1:34863, which Node\'s fetch reads only under NODE_USE_ENV_PROXY=1)')
    const github: GitHubReader = { json: () => Promise.reject(new Error('GET /runs answered 403')), text: () => Promise.reject(new Error('unreachable')) }
    const report = await runFunctions(options({ github, divisions: new Set(['judging']) }))
    expect(report.vacant.find(seat => seat.seat === 'judging-ci-static')?.reason)
      .toBe('Branch CI could not be read: GET /runs answered 403 (HTTPS_PROXY names http://127.0.0.1:34863, which Node\'s fetch reads only under NODE_USE_ENV_PROXY=1)')
    vi.stubEnv('NODE_USE_ENV_PROXY', '1')
    expect(proxyHint()).toBe('')
  })

  it('does not append a CI verdict the ledger already holds for the same seat and job', async () => {
    const opts = options({ divisions: new Set(['judging']) })
    const first = await runFunctions(opts)
    expect(first.lines).toHaveLength(6)
    const second = await runFunctions(opts)
    expect(second.lines).toEqual([])
    expect(second.vacant).toHaveLength(11)
    expect(readLedger(opts.ledgerFile).lines).toEqual(first.lines)
  })

  it('folds the session-stats unit and the scorekeeper over the records and publishes both snapshots', async () => {
    const opts = options({ divisions: new Set(['observatory', 'curation-data']) })
    const earlier: FunctionLine = {
      type: 'function',
      at: '2026-09-28T10:00:00.000Z',
      shift: 'shift-earlier',
      seat: 'verification-verify-md-wrap',
      division: 'verification',
      function: 'verify-md-wrap',
      target: { commit: COMMIT },
      outcome: 'pass',
      evidence: { path: 'data/enterprise/functions/shift-earlier/verification-verify-md-wrap.log' },
      seconds: 1,
    }
    appendLedger(opts.ledgerFile, [earlier])
    const report = await runFunctions(opts)
    expect(report.lines.map(line => [line.seat, line.function, line.outcome, line.evidence])).toEqual([
      ['observatory-session-stats-observer', 'session-stats', 'pass', { path: TELEMETRY_PATH }],
      ['curation-data-scorekeeper', 'scoreboard', 'pass', { path: SCOREBOARD_PATH }],
    ])
    const telemetry = JSON.parse(readFileSync(join(opts.outputRoot, TELEMETRY_PATH), 'utf8')) as TelemetrySnapshot
    expect(telemetry).toMatchObject({ publishedAt: NOW.toISOString(), shift: 'shift-test', commit: COMMIT, records: [RECORD], skipped: [] })
    expect(telemetry.window).toEqual({ since: '2026-09-27T18:00:00.000Z', until: NOW.toISOString() })
    expect(telemetry.total.sessions).toBe(1)
    expect(telemetry.sessionsByTree).toEqual({ 'data/proving-ground': 1 })
    // The record is from 2026-09-07: nothing in it falls inside the window.
    expect(telemetry.inWindow.sessions).toBe(0)
    expect(telemetry.total.tokens.output).toBeGreaterThan(0)
    expect(telemetry.total.stats.steps).toBeGreaterThan(0)
    // Occupancy from the ledger: the earlier gate line lights its verifier inside the window.
    expect(telemetry.seats).toMatchObject({ occupied: 1, active: 1 })
    expect(telemetry.seats.byDivision.find(division => division.id === 'verification')).toEqual({ id: 'verification', defined: 14, occupied: 1, active: 1 })
    expect(telemetry.seats.byDivision.map(division => division.id)).toEqual(roster.divisions.map(division => division.id))
    const scoreboard = JSON.parse(readFileSync(join(opts.outputRoot, SCOREBOARD_PATH), 'utf8')) as ScoreboardSnapshot
    expect(scoreboard).toMatchObject({ computedAt: NOW.toISOString(), shift: 'shift-test', commit: COMMIT, sessions: 1, skipped: [] })
    expect(scoreboard.rows.length + scoreboard.unstamped + scoreboard.excluded).toBeGreaterThan(0)
    expect(report.vacant.map(seat => seat.seat)).toEqual(roster.agents
      .filter(agent => (agent.division === 'observatory' || agent.division === 'curation-data') && !['observatory-session-stats-observer', 'curation-data-scorekeeper'].includes(agent.id))
      .map(agent => agent.id))
    expect(readLedger(opts.ledgerFile).lines).toEqual([earlier, ...report.lines])
  })

  it('writes nothing into the repository when the output root is elsewhere', async () => {
    const opts = options()
    await runFunctions(opts)
    expect(existsSync(join(opts.outputRoot, TELEMETRY_PATH))).toBe(true)
    expect(existsSync(join(root, 'data/enterprise/functions/shift-test'))).toBe(false)
  })
})

describe('plainText', () => {
  it('removes terminal styling and trailing whitespace, line by line', () => {
    expect(plainText('\u001B[32m✓\u001B[0m built  \n\u001B[1mbold\u001B[22m\t\nplain\n')).toBe('✓ built\nbold\nplain\n')
    expect(plainText('')).toBe('')
  })
})

describe('foldSessionStats', () => {
  it('folds nothing to zeros', () => {
    expect(foldSessionStats([])).toEqual({ turns: 0, steps: 0, llmMs: 0, toolMs: 0 })
  })
})

describe('seatOccupancy', () => {
  it('counts the roster\'s divisions in roster order', () => {
    const seats = seatOccupancy(roster, [], { since: '2026-09-27T18:00:00.000Z', until: NOW.toISOString() })
    expect(seats.occupied).toBe(0)
    expect(seats.byDivision.map(division => division.defined).reduce((sum, count) => sum + count, 0)).toBe(147)
  })
})

describe('the command line', () => {
  it('reads the flags and refuses what it cannot run', () => {
    expect(parseCliArguments(['--commit', 'abc', '--shift', 's', '--branch', 'b', '--only', 'judging,verification', '--gate-timeout-ms', '10', '--lock', '/tmp/x.lock'])).toEqual({
      commit: 'abc', shift: 's', branch: 'b', only: ['judging', 'verification'], gateTimeoutMs: 10, lock: '/tmp/x.lock',
    })
    expect(parseCliArguments(['--', '--shift', 's'])).toEqual({ shift: 's' })
    expect(() => parseCliArguments(['--only', 'knowledge'])).toThrow(/the function divisions are/)
    expect(() => parseCliArguments(['--commit'])).toThrow(/needs a value/)
    expect(() => parseCliArguments(['--wat', 'x'])).toThrow(/unknown flag/)
  })

  it('runs a gate through pnpm\'s own entrypoint when started by pnpm, else the pnpm on the path, and through flock under a lock', () => {
    expect(gateCommand('verify-md-links', undefined, { npm_execpath: '/x/pnpm.cjs' })).toEqual({ command: process.execPath, args: ['/x/pnpm.cjs', 'run', 'verify-md-links'] })
    expect(gateCommand('verify-md-links', undefined, {})).toEqual({ command: 'pnpm', args: ['run', 'verify-md-links'] })
    expect(gateCommand('verify-md-links', '/tmp/dsh-heavy.lock', {})).toEqual({ command: 'flock', args: ['/tmp/dsh-heavy.lock', 'pnpm', 'run', 'verify-md-links'] })
  })

  it('runs a gate without colour and without the proxy variable only the runner\'s own reads need', () => {
    expect(gateEnvironment({ PATH: '/bin', NODE_USE_ENV_PROXY: '1', FORCE_COLOR: '3' })).toEqual({ PATH: '/bin', FORCE_COLOR: '0', NO_COLOR: '1' })
  })

  it('names a shift after the minute it started', () => {
    expect(defaultShift(new Date('2026-09-28T17:20:33.123Z'))).toBe('2026-09-28T17-20Z')
  })

  it('observes the committed records and any shift record directories', () => {
    const records = observedRecords(root)
    expect(records).toContain(RECORD)
    expect(records.every(record => record.startsWith('data/'))).toBe(true)
  })
})
