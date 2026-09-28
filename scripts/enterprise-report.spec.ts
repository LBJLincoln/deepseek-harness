import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { buildCycleRecord, CYCLES_DIR, cycleStartedAt, type CycleRecord } from './enterprise-cycle-record.ts'
import type { GitHubReader } from './enterprise-functions.ts'
import { LEDGER_PATH, readLedger, type FunctionLine, type LedgerLine, type TicketLine } from './enterprise-ledger.ts'
import {
  enterpriseReport,
  parseReportArguments,
  renderReport,
  reportWindow,
  rosterGeneratorAt,
  writeReport,
  type CycleCommit,
  type EnterpriseWindowReport,
  type ReportRepository,
  type ReportSources,
} from './enterprise-report.ts'
import { buildRoster } from './enterprise-roster.ts'

const repoRoot = resolve(import.meta.dirname, '..')
const WINDOW = { since: '2026-09-28T20:00:00.000Z', until: '2026-09-29T00:00:00.000Z' }
const sha = (char: string): string => char.repeat(40)
const HEAD = sha('f')
/**
 * Shipped commits: one with runs of its own, one a later run contains, one no
 * run follows, and one whose later run's head the checkout lacks.
 */
const EXACT = sha('1')
const LATER = sha('2')
const NONE = sha('3')
const MISSING = sha('4')

/** A ticket line over a shipped default; an override of `undefined` removes the field. */
function ticket(overrides: { [K in keyof TicketLine]?: TicketLine[K] | undefined }): TicketLine {
  const line: Record<string, unknown> = {
    type: 'ticket',
    at: '2026-09-28T20:30:00.000Z',
    shift: '202000-aa11',
    ticket: 'T-0050',
    seat: 'harness-core-session-steward',
    division: 'harness-core',
    checks: [],
    review: { verdict: 'approve' },
    integration: { outcome: 'merged' },
    shipped: { commit: EXACT },
    tokens: 1000,
    seconds: 100,
    ...overrides,
  }
  return Object.fromEntries(Object.entries(line).filter(([, value]) => value !== undefined)) as unknown as TicketLine
}

function fn(overrides: Partial<FunctionLine>): FunctionLine {
  return {
    type: 'function',
    at: '2026-09-28T22:00:00.000Z',
    shift: 'cycle-20260928T221301Z',
    seat: 'verification-verify-md-links',
    division: 'verification',
    function: 'verify-md-links',
    target: { commit: HEAD },
    outcome: 'pass',
    evidence: { path: 'data/enterprise/functions/x/verification-verify-md-links.log' },
    seconds: 10,
    ...overrides,
  }
}

const LEDGER: LedgerLine[] = [
  ticket({}),
  ticket({ ticket: 'T-0051', at: '2026-09-28T22:40:00.000Z', shipped: { commit: LATER }, tokens: 2000, seconds: 200 }),
  ticket({ ticket: 'T-0052', at: '2026-09-28T22:41:00.000Z', division: 'knowledge', seat: 'knowledge-x', shipped: null, review: { verdict: 'reject' }, tokens: undefined, seconds: 50 }),
  ticket({ ticket: 'T-0053', at: '2026-09-28T19:00:00.000Z', shipped: null, review: { verdict: 'none' } }),
  ticket({ ticket: 'T-0054', at: '2026-09-28T23:56:00.000Z', shipped: { commit: NONE } }),
  ticket({ ticket: 'T-0055', at: '2026-09-28T23:40:00.000Z', shipped: { commit: MISSING } }),
  fn({ at: WINDOW.since }),
  fn({ seat: 'judging-ci-static', division: 'judging', function: 'ci-static', outcome: 'fail', evidence: { url: 'https://github.com/x/actions/runs/1/job/2' }, seconds: 300 }),
  fn({ at: '2026-09-29T00:00:00.001Z', outcome: 'error' }),
]

function record(cycle: string, overrides: Partial<CycleRecord>): CycleRecord {
  const built = buildCycleRecord({
    cycle,
    endedAt: new Date(Date.parse(cycleStartedAt(cycle) ?? '') + 50 * 60_000).toISOString(),
    commits: { start: sha('a'), pulled: sha('b'), end: sha('c') },
    steps: [{ name: 'pull', exit: 0, at: '2026-09-28T20:13:02.000Z' }],
    ledgerBefore: '',
    ledgerAfter: '',
    previous: null,
  })
  return { ...built, ...overrides }
}

/** Two recorded cycles in the window, a third after it whose record says the second's did not reach the remote. */
const RECORDS: CycleRecord[] = [
  record('cycle-20260928T201301Z', { shifts: ['202000-aa11'], tickets: { shipped: 1, rejected: 0, halted: 0 }, functions: { pass: 1, fail: 0, error: 0 } }),
  record('cycle-20260928T221301Z', {
    steps: [{ name: 'pull', exit: 0, at: '2026-09-28T22:13:02.000Z' }, { name: 'functions', exit: 1, at: '2026-09-28T22:50:00.000Z' }, { name: 'roster', exit: 2, at: '2026-09-28T22:51:00.000Z' }],
    firstFailure: { step: 'functions', exit: 1 },
    previous: { cycle: 'cycle-20260928T201301Z', recordOnRemote: true },
  }),
  record('cycle-20260929T001301Z', { previous: { cycle: 'cycle-20260928T221301Z', recordOnRemote: false } }),
]

const CYCLE_COMMITS: CycleCommit[] = [
  { commit: sha('5'), cycle: 'cycle-20260928T181148Z', carries: 'intake' },
  { commit: sha('6'), cycle: 'cycle-20260928T201148Z', carries: 'intake' },
  { commit: sha('7'), cycle: 'cycle-20260928T201301Z', carries: 'intake' },
  { commit: sha('8'), cycle: 'cycle-20260928T201301Z', carries: 'functions, roster and deck' },
]

const COMMIT_TIMES: Record<string, string> = {
  [HEAD]: '2026-09-29T00:30:00.000Z',
  [EXACT]: '2026-09-28T20:29:00.000Z',
  [LATER]: '2026-09-28T22:39:00.000Z',
  [NONE]: '2026-09-28T23:55:00.000Z',
  [MISSING]: '2026-09-28T23:39:00.000Z',
}

/** Which run heads contain which shipped commit; a pair not listed is not contained, and a head named `absent` is not in the checkout. */
const CONTAINS = new Set([`${LATER} ${sha('d')}`])

const repository: ReportRepository = {
  head: () => HEAD,
  cycleCommits: () => CYCLE_COMMITS,
  commitTime: commit => COMMIT_TIMES[commit],
  contains: (ancestor, descendant) => (descendant === sha('e') ? undefined : CONTAINS.has(`${ancestor} ${descendant}`)),
}

function run(id: number, head: string, createdAt: string, conclusion: string | null, status = 'completed'): Record<string, unknown> {
  return { id, head_sha: head, status, conclusion, html_url: `https://github.com/LBJLincoln/deepseek-harness/actions/runs/${id}`, created_at: createdAt }
}

/** A recorded Branch CI API: two runs on the exact commit, then the branch's completed runs. */
function github(calls: string[]): GitHubReader {
  return {
    json: async (path) => {
      calls.push(path)
      if (path.includes(`head_sha=${EXACT}`)) {
        return { workflow_runs: [run(11, EXACT, '2026-09-28T20:31:00Z', 'success'), run(12, EXACT, '2026-09-28T20:40:00Z', null, 'in_progress')] }
      }
      if (path.includes('head_sha=')) return { workflow_runs: [] }
      return {
        workflow_runs: [
          run(24, sha('e'), '2026-09-28T23:50:00Z', 'success'),
          run(23, sha('9'), '2026-09-28T23:45:00Z', 'success'),
          run(22, sha('d'), '2026-09-28T22:50:00Z', 'failure'),
          run(21, sha('c'), '2026-09-28T22:45:00Z', 'success'),
          run(20, sha('0'), '2026-09-28T19:00:00Z', 'success'),
        ],
      }
    },
    text: async () => '',
  }
}

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A root holding the ledger (plus one torn row) and the cycle records. */
function root(): string {
  const dir = mkdtempSync(join(tmpdir(), 'enterprise-report-'))
  tempDirs.push(dir)
  mkdirSync(join(dir, CYCLES_DIR), { recursive: true })
  writeFileSync(join(dir, LEDGER_PATH), `${LEDGER.map(line => JSON.stringify(line)).join('\n')}\n{"torn": \n`)
  for (const entry of RECORDS) writeFileSync(join(dir, CYCLES_DIR, `${entry.cycle}.json`), JSON.stringify(entry))
  return dir
}

function sources(dir: string, reader: GitHubReader): ReportSources {
  return {
    root: dir,
    repository,
    github: reader,
    rosterAt: (until) => {
      const ledger = readLedger(join(dir, LEDGER_PATH)).lines.filter(line => Date.parse(line.at) <= Date.parse(until))
      return buildRoster(repoRoot, { generatedAt: until, recorded: [], ledger })
    },
  }
}

describe('enterpriseReport', () => {
  let calls: string[] = []
  async function report(): Promise<EnterpriseWindowReport> {
    calls = []
    return enterpriseReport(sources(root(), github(calls)), WINDOW)
  }

  it('counts the window\'s cycles from their records, and the rest from the commits naming them, labelled', async () => {
    const { cycles } = await report()
    expect(cycles).toMatchObject({ count: 3, recorded: 2, gitOnly: 1, clean: 1, failed: 1, failedByStep: { functions: 1, roster: 1 } })
    expect(cycles.list.map(entry => [entry.cycle, entry.source, entry.outcome])).toEqual([
      ['cycle-20260928T201148Z', 'git', 'unknown'],
      ['cycle-20260928T201301Z', 'record', 'clean'],
      ['cycle-20260928T221301Z', 'record', 'failed'],
    ])
    expect(cycles.list[0]?.commits).toEqual([{ commit: sha('6'), carries: 'intake' }])
    expect(cycles.list[1]?.commits.map(commit => commit.carries)).toEqual(['intake', 'functions, roster and deck'])
    expect(cycles.list.map(entry => entry.record?.recordOnRemote)).toEqual([undefined, true, false])
    expect(cycles.list[2]?.record).toMatchObject({ firstFailure: { step: 'functions', exit: 1 }, failedSteps: ['functions', 'roster'] })
  })

  it('tallies the ticket lines dated in the window by status and division, and lists the distinct tickets shipped', async () => {
    const { tickets } = await report()
    expect(tickets.lines).toBe(5)
    expect(tickets.byStatus).toEqual({ shipped: 4, rejected: 1, halted: 0 })
    expect(tickets.byDivision).toEqual([
      { division: 'harness-core', lines: 4, shipped: 4, rejected: 0, halted: 0 },
      { division: 'knowledge', lines: 1, shipped: 0, rejected: 1, halted: 0 },
    ])
    expect(tickets.shipped.map(entry => [entry.ticket, entry.commit])).toEqual([['T-0050', EXACT], ['T-0051', LATER], ['T-0055', MISSING], ['T-0054', NONE]])
  })

  it('answers each shipped commit\'s Branch CI from its own runs, else the first later completed run containing it, and says which', async () => {
    const byCommit = new Map((await report()).commits.map(entry => [entry.commit, entry]))
    expect(byCommit.get(EXACT)).toMatchObject({ tickets: ['T-0050'], verdict: 'success', ci: { basis: 'exact' } })
    expect(byCommit.get(EXACT)?.ci).toMatchObject({ runs: [{ id: 12, status: 'in_progress' }, { id: 11, conclusion: 'success' }] })
    expect(byCommit.get(LATER)).toMatchObject({ verdict: 'failure', ci: { basis: 'later', run: { id: 22, headSha: sha('d') } } })
    expect(byCommit.get(NONE)).toMatchObject({ verdict: 'no run', ci: { basis: 'none' } })
    expect(byCommit.get(MISSING)).toMatchObject({ verdict: 'unknown', ci: { basis: 'unknown' } })
    expect(calls.filter(path => path.includes('branch=')).length).toBe(1)
  })

  it('leaves every verdict unknown with the reason when the API cannot be read, and reports the rest', async () => {
    const failing: GitHubReader = { json: async () => { throw new Error('GET answered 403') }, text: async () => '' }
    const unreadable = await enterpriseReport(sources(root(), failing), WINDOW)
    expect(unreadable.commits.map(entry => entry.verdict)).toEqual(['unknown', 'unknown', 'unknown', 'unknown'])
    expect(unreadable.unknowns.filter(unknown => unknown.includes('Branch CI could not be read: GET answered 403'))).toHaveLength(4)
    expect(unreadable.tickets.lines).toBe(5)
  })

  it('takes seats from the roster generator at the window\'s end, and function runs and effort from the window\'s lines', async () => {
    const built = await report()
    expect(built.seats.at).toBe(WINDOW.until)
    expect(built.seats.byDivision.find(division => division.id === 'judging')).toMatchObject({ occupied: 1, active: 1 })
    expect(built.seats.byDivision.find(division => division.id === 'verification')?.active).toBe(1)
    expect(built.functions).toEqual({
      lines: 2,
      byDivision: [{ division: 'judging', pass: 0, fail: 1, error: 0 }, { division: 'verification', pass: 1, fail: 0, error: 0 }],
    })
    expect(built.effort).toEqual({
      tokens: { total: 5000, lines: 4, withoutCount: 1 },
      seconds: { tickets: 550, functions: 310, cycles: 6000 },
    })
    expect(built.head).toEqual({ commit: HEAD, committedAt: '2026-09-29T00:30:00.000Z' })
  })

  it('lists every unknown in plain words', async () => {
    expect((await report()).unknowns).toEqual([
      '1 ledger row (line 10) could not be read; its time and content are unknown',
      '1 cycle is seen only in git history (cycle-20260928T201148Z): its steps, outcome and ledger lines are unknown',
      `the Branch CI verdict of ${MISSING.slice(0, 10)} is unknown: Branch CI run 24's head ${sha('e')} is not in this checkout; fetch the branch and run the report again`,
      '1 ticket line states no token count; the token total leaves it out',
    ])
  })

  it('renders the same Markdown for the same inputs, naming each cycle\'s source and each unknown', async () => {
    const markdown = renderReport(await report())
    expect(renderReport(await report())).toBe(markdown)
    expect(markdown).toContain('3 cycles started in the window: 2 recorded (1 clean, 1 failed), 1 seen only in git history.')
    expect(markdown).toContain(`| cycle-20260928T201148Z | git history only | unknown | — | — | — | \`${sha('6').slice(0, 10)}\` intake | — |`)
    expect(markdown).toContain(`| \`${LATER.slice(0, 10)}\` | T-0051 | failure | no run on this exact commit; the first later completed run whose head contains it is 22 on ${sha('d').slice(0, 10)} |`)
    expect(markdown).toContain('- 1 ticket line states no token count; the token total leaves it out')
    expect(markdown.endsWith('\n') && !markdown.endsWith('\n\n')).toBe(true)
  })
})

describe('rosterGeneratorAt', () => {
  it('builds the roster at a moment from the ledger lines and sessions dated at or before it', () => {
    const until = '2026-09-27T00:00:00.000Z'
    const roster = rosterGeneratorAt(repoRoot)(until)
    expect(roster.generatedAt).toBe(until)
    expect(roster.ledger.lines).toBe(0)
    const lastSeen = roster.agents.flatMap(agent => agent.evidence.lastSeen ?? [])
    expect(lastSeen.filter(at => Date.parse(at) > Date.parse(until))).toEqual([])
  })
})

describe('the command line', () => {
  it('reads --since, --until and --write, and defaults to the 24 hours before now', () => {
    expect(parseReportArguments(['--', '--since', '2026-09-28T17:03:33Z', '--write'])).toEqual({ since: '2026-09-28T17:03:33.000Z', write: true })
    expect(reportWindow({ write: false }, new Date('2026-09-29T15:00:00Z'))).toEqual({ since: '2026-09-28T15:00:00.000Z', until: '2026-09-29T15:00:00.000Z' })
    expect(() => parseReportArguments(['--until', 'noon'])).toThrow(/--until needs an ISO time/)
    expect(() => parseReportArguments(['--days', '1'])).toThrow(/unknown flag --days/)
    expect(() => reportWindow({ since: WINDOW.until, until: WINDOW.since, write: false }, new Date())).toThrow(/is after --until/)
  })

  it('writes the JSON and the Markdown under the window\'s end to the minute', async () => {
    const dir = root()
    const built = await enterpriseReport(sources(dir, github([])), WINDOW)
    expect(writeReport(dir, built)).toEqual(['data/enterprise/reports/2026-09-29T0000Z.json', 'data/enterprise/reports/2026-09-29T0000Z.md'])
    expect(JSON.parse(readFileSync(join(dir, 'data/enterprise/reports/2026-09-29T0000Z.json'), 'utf8'))).toEqual(built)
    expect(readFileSync(join(dir, 'data/enterprise/reports/2026-09-29T0000Z.md'), 'utf8')).toBe(renderReport(built))
  })
})
