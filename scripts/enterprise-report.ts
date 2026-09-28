/**
 * The enterprise's report over a time window
 * (`pnpm run enterprise:report -- [--since <ISO>] [--until <ISO>] [--write]`):
 * the cycles that ran, the tickets the shifts worked and shipped, each shipped
 * commit's Branch CI verdict, the seats occupied and active at the window's
 * end, the function runs, and the tokens and seconds spent. Every figure comes
 * from the checkout — the ledger, the cycle records under
 * `data/enterprise/cycles/`, HEAD's git history, the roster generator — and
 * from GitHub's answer about Branch CI runs, so the report is a deterministic
 * function of the repository state and those answers. A fact none of them
 * shows is listed in {@link EnterpriseWindowReport.unknowns}, never inferred.
 *
 * A cycle is counted from its record when it has one, and otherwise from the
 * commits whose subjects name it (`chore(enterprise): <cycle id> …`), which is
 * all the branch shows of a cycle before the record existed, of one whose
 * record was never written, and of one still running; such a cycle's outcome is
 * `unknown`.
 *
 * @module enterprise-report
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { cycleStartedAt, readCycleRecords, type CycleRecord } from './enterprise-cycle-record.ts'
import { CI_REPOSITORY, CI_WORKFLOW, DEFAULT_CI_BRANCH, githubReader, proxyHint, type GitHubReader } from './enterprise-functions.ts'
import {
  ACTIVE_WINDOW_MS,
  LEDGER_PATH,
  readLedger,
  ticketStatus,
  type FunctionLine,
  type FunctionOutcome,
  type TicketLine,
  type TicketStatus,
} from './enterprise-ledger.ts'
import { buildRoster, type Roster } from './enterprise-roster.ts'
import { committedRecords, readRecordedSessions } from './roster-evidence.ts'

/** The directory `--write` writes reports to, relative to the repository root. */
export const REPORTS_DIR = 'data/enterprise/reports'

/** The interval a report covers, both ends inclusive. */
export interface ReportWindow {
  since: string
  until: string
}

/** A commit in HEAD's history whose subject names a cycle. */
export interface CycleCommit {
  commit: string
  cycle: string
  /** What the subject says the commit carries after the cycle id, such as `intake`. */
  carries: string
}

/** What the report reads from git; {@link gitRepository} reads the checkout. */
export interface ReportRepository {
  /** @returns HEAD's commit. */
  head: () => string
  /** @returns the commits in HEAD's history whose subjects name a cycle, oldest first. */
  cycleCommits: () => CycleCommit[]
  /** @param commit - a commit id. @returns its committer time as an ISO time, or `undefined` when the checkout lacks it. */
  commitTime: (commit: string) => string | undefined
  /**
   * @param ancestor - the commit asked about.
   * @param descendant - the commit whose history is searched.
   * @returns whether `descendant`'s history contains `ancestor`, or `undefined` when the checkout lacks either.
   */
  contains: (ancestor: string, descendant: string) => boolean | undefined
}

/** Everything a report reads. */
export interface ReportSources {
  /** Repository root: where the ledger and the cycle records are read. */
  root: string
  repository: ReportRepository
  github: GitHubReader
  /** @param until - the window's end. @returns the roster as the generator builds it at that moment. */
  rosterAt: (until: string) => Roster
}

/** One Branch CI run as the report cites it. */
export interface CiRunRef {
  id: number
  headSha: string
  status: string
  conclusion: string | null
  url: string
  createdAt: string
}

/**
 * A shipped commit's Branch CI answer: the runs whose head is that exact
 * commit (`exact`), else the first completed run created after the commit
 * whose head contains it (`later`), else no run at all (`none`), or `unknown`
 * with the reason no answer could be read.
 */
export type CiAnswer =
  | { basis: 'exact'; runs: CiRunRef[] }
  | { basis: 'later'; run: CiRunRef }
  | { basis: 'none' }
  | { basis: 'unknown'; reason: string }

/** One shipped commit with the tickets it carries and its Branch CI answer. */
export interface ShippedCommitReport {
  commit: string
  tickets: string[]
  divisions: string[]
  ci: CiAnswer
  /** The answer in one phrase: a run's conclusion, `in progress`, `no run` or `unknown`. */
  verdict: string
}

/** One distinct ticket shipped inside the window. */
export interface ShippedTicket {
  ticket: string
  division: string
  seat: string
  commit: string
  /** The shipping line's time. */
  at: string
  shift: string
}

/** One cycle that started inside the window. */
export interface CycleEntry {
  cycle: string
  startedAt: string
  /** `record` when the cycle's record is in the checkout, `git` when only commits naming it are. */
  source: 'record' | 'git'
  /** `unknown` for a cycle without a record. */
  outcome: 'clean' | 'failed' | 'unknown'
  /** The commits in HEAD's history whose subjects name the cycle, oldest first. */
  commits: { commit: string; carries: string }[]
  /** The recorded cycle's fields; absent without a record. */
  record?: {
    endedAt: string
    firstFailure: CycleRecord['firstFailure']
    failedSteps: string[]
    shifts: string[]
    tickets: CycleRecord['tickets']
    functions: CycleRecord['functions']
    /** Whether the next cycle's record found this record on the remote branch; `unknown` until a later record says. */
    recordOnRemote: boolean | 'unknown'
  }
}

/** Seats of one division at the window's end. */
export interface DivisionSeats {
  id: string
  name: string
  defined: number
  occupied: number
  active: number
}

/** The report, as `--write` stores it and the deck's day view reads it. */
export interface EnterpriseWindowReport {
  window: ReportWindow
  /** The commit whose files and history the report read, and its committer time (`null` when git cannot say). */
  head: { commit: string; committedAt: string | null }
  cycles: {
    count: number
    recorded: number
    /** Cycles seen only as commits naming them. */
    gitOnly: number
    /** Recorded cycles whose every step exited 0. */
    clean: number
    /** Recorded cycles with a step that exited non-zero. */
    failed: number
    /** Recorded cycles per step that exited non-zero in them. */
    failedByStep: Record<string, number>
    list: CycleEntry[]
  }
  tickets: {
    /** Ticket lines dated inside the window. */
    lines: number
    byStatus: Record<TicketStatus, number>
    byDivision: ({ division: string; lines: number } & Record<TicketStatus, number>)[]
    /** The distinct tickets shipped inside the window, by their shipping line's time. */
    shipped: ShippedTicket[]
  }
  /** Each commit a ticket shipped as inside the window, with its Branch CI answer. */
  commits: ShippedCommitReport[]
  /** Seats at the window's end, from the roster generator run at that moment. */
  seats: { at: string; defined: number; occupied: number; active: number; byDivision: DivisionSeats[] }
  functions: {
    /** Function lines dated inside the window. */
    lines: number
    byDivision: ({ division: string } & Record<FunctionOutcome, number>)[]
  }
  effort: {
    /** Tokens the ticket lines inside the window state, and how many lines state none. */
    tokens: { total: number; lines: number; withoutCount: number }
    /** Seconds the ticket lines and function lines inside the window state, and the recorded cycles' wall time. */
    seconds: { tickets: number; functions: number; cycles: number }
  }
  /** Every fact the report could not establish, in plain words. */
  unknowns: string[]
}

const TICKET_STATUSES: readonly TicketStatus[] = ['shipped', 'rejected', 'halted']
const FUNCTION_OUTCOMES: readonly FunctionOutcome[] = ['pass', 'fail', 'error']
const CYCLE_SUBJECT = /^chore\(enterprise\): (cycle-\d{8}T\d{6}Z) (.+)$/

/** How many pages of a branch's runs the report reads before it stops. */
const RUN_PAGES = 10

function assertNever(value: never): never {
  throw new Error(`enterprise-report: unhandled Branch CI answer ${JSON.stringify(value)}`)
}

function ms(at: string): number {
  return Date.parse(at)
}

/** A sum of recorded seconds, rounded to a tenth so float addition leaves no noise in the report. */
function tenths(seconds: number): number {
  return Math.round(seconds * 10) / 10
}

function inWindow(at: string, window: ReportWindow): boolean {
  return ms(at) >= ms(window.since) && ms(at) <= ms(window.until)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read a workflow runs listing from the REST API.
 * @param body - the decoded body.
 * @returns the runs it lists that carry the fields the report cites.
 */
function readRuns(body: unknown): CiRunRef[] {
  if (!isRecord(body) || !Array.isArray(body.workflow_runs)) return []
  const runs: CiRunRef[] = []
  for (const entry of body.workflow_runs) {
    if (!isRecord(entry)) continue
    const { id, head_sha: headSha, status, conclusion, html_url: url, created_at: createdAt } = entry
    if (typeof id !== 'number' || typeof headSha !== 'string' || typeof url !== 'string' || typeof createdAt !== 'string' || !Number.isFinite(ms(createdAt))) continue
    runs.push({ id, headSha, status: typeof status === 'string' ? status : 'unknown', conclusion: typeof conclusion === 'string' ? conclusion : null, url, createdAt })
  }
  return runs
}

function newestRunFirst(left: CiRunRef, right: CiRunRef): number {
  return ms(right.createdAt) - ms(left.createdAt) || right.id - left.id
}

/**
 * The phrase a Branch CI answer reads as.
 * @param ci - the answer.
 * @returns the newest completed exact run's conclusion (or `in progress`), the later run's conclusion, `no run`, or `unknown`.
 */
function verdictOf(ci: CiAnswer): string {
  switch (ci.basis) {
    case 'exact': return ci.runs.find(run => run.status === 'completed')?.conclusion ?? 'in progress'
    case 'later': return ci.run.conclusion ?? 'unknown'
    case 'none': return 'no run'
    case 'unknown': return 'unknown'
    default: return assertNever(ci)
  }
}

/**
 * Answer, for each shipped commit, which Branch CI run judged it.
 * @param commits - the shipped commits.
 * @param sources - the GitHub reader and the repository.
 * @returns each commit's answer.
 */
async function ciAnswers(commits: readonly string[], sources: ReportSources): Promise<Map<string, CiAnswer>> {
  const base = `/repos/${CI_REPOSITORY}/actions/workflows/${CI_WORKFLOW}/runs`
  const answers = new Map<string, CiAnswer>()
  const times = new Map(commits.map(commit => [commit, sources.repository.commitTime(commit)]))
  const earliest = [...times.values()].filter((at): at is string => at !== undefined).sort()[0]
  let branchRuns: CiRunRef[] | undefined
  const listBranchRuns = async (): Promise<CiRunRef[]> => {
    const runs: CiRunRef[] = []
    for (let page = 1; page <= RUN_PAGES; page += 1) {
      const listed = readRuns(await sources.github.json(`${base}?branch=${encodeURIComponent(DEFAULT_CI_BRANCH)}&status=completed&per_page=100&page=${page}`))
      runs.push(...listed)
      if (listed.length < 100 || (earliest !== undefined && listed.some(run => ms(run.createdAt) < ms(earliest)))) break
    }
    return runs
  }
  for (const commit of commits) {
    try {
      const exact = readRuns(await sources.github.json(`${base}?head_sha=${commit}&per_page=100`)).filter(run => run.headSha === commit)
      if (exact.length > 0) {
        answers.set(commit, { basis: 'exact', runs: exact.sort(newestRunFirst) })
        continue
      }
      const time = times.get(commit)
      if (time === undefined) {
        answers.set(commit, { basis: 'unknown', reason: `no run names ${commit} as its head, and the checkout lacks the commit, so no later run can be matched to it` })
        continue
      }
      branchRuns ??= await listBranchRuns()
      const later = branchRuns.filter(run => ms(run.createdAt) >= ms(time)).sort((left, right) => -newestRunFirst(left, right))
      let answer: CiAnswer = { basis: 'none' }
      for (const run of later) {
        const contained = sources.repository.contains(commit, run.headSha)
        if (contained === undefined) {
          answer = { basis: 'unknown', reason: `Branch CI run ${run.id}'s head ${run.headSha} is not in this checkout; fetch the branch and run the report again` }
          break
        }
        if (contained) {
          answer = { basis: 'later', run }
          break
        }
      }
      answers.set(commit, answer)
    } catch (error) {
      // The API is a network the report cannot fix; the commit's answer is unknown with the reason, and the rest of the report stands.
      answers.set(commit, { basis: 'unknown', reason: `Branch CI could not be read: ${error instanceof Error ? error.message : String(error)}${proxyHint()}` })
    }
  }
  return answers
}

function describeCi(commit: string, ci: CiAnswer): string {
  switch (ci.basis) {
    case 'exact': return `${ci.runs.length === 1 ? 'run' : 'runs'} ${ci.runs.map(run => `${run.id} (${run.conclusion ?? run.status})`).join(', ')} on this exact commit`
    case 'later': return `no run on this exact commit; the first later completed run whose head contains it is ${ci.run.id} on ${ci.run.headSha.slice(0, 10)}`
    case 'none': return `no run on ${commit.slice(0, 10)} and no later completed run whose head contains it`
    case 'unknown': return ci.reason
    default: return assertNever(ci)
  }
}

/**
 * The report over a window.
 * @param sources - the checkout, the repository reader, the GitHub reader and the roster at a moment.
 * @param window - the interval, both ends inclusive.
 * @returns the report.
 */
export async function enterpriseReport(sources: ReportSources, window: ReportWindow): Promise<EnterpriseWindowReport> {
  const unknowns: string[] = []
  const head = sources.repository.head()

  const ledger = readLedger(join(sources.root, LEDGER_PATH))
  if (ledger.skipped.length > 0) {
    const one = ledger.skipped.length === 1
    unknowns.push(`${ledger.skipped.length} ledger ${one ? 'row' : 'rows'} (line ${ledger.skipped.map(row => row.line).join(', ')}) could not be read; ${one ? 'its' : 'their'} time and content are unknown`)
  }
  const ticketLines = ledger.lines.filter((line): line is TicketLine => line.type === 'ticket' && inWindow(line.at, window))
  const functionLines = ledger.lines.filter((line): line is FunctionLine => line.type === 'function' && inWindow(line.at, window))

  // Cycles.
  const { records, unreadable } = readCycleRecords(sources.root)
  for (const file of unreadable) unknowns.push(`${file.path} could not be read (${file.reason}); the cycle it records is counted from git history only`)
  const commitsByCycle = new Map<string, { commit: string; carries: string }[]>()
  for (const entry of sources.repository.cycleCommits()) {
    commitsByCycle.set(entry.cycle, [...commitsByCycle.get(entry.cycle) ?? [], { commit: entry.commit, carries: entry.carries }])
  }
  const recorded = new Map(records.map(record => [record.cycle, record]))
  const nextOf = new Map<string, CycleRecord>()
  for (const record of records) if (record.previous !== null) nextOf.set(record.previous.cycle, record)
  const ids = [...new Set([...recorded.keys(), ...commitsByCycle.keys()])]
    .filter(id => inWindow(cycleStartedAt(id) ?? '', window))
    .sort()
  const list: CycleEntry[] = ids.map((id) => {
    const record = recorded.get(id)
    const entry: CycleEntry = {
      cycle: id,
      startedAt: cycleStartedAt(id) ?? '',
      source: record === undefined ? 'git' : 'record',
      outcome: record === undefined ? 'unknown' : record.firstFailure === null ? 'clean' : 'failed',
      commits: commitsByCycle.get(id) ?? [],
    }
    if (record !== undefined) {
      const next = nextOf.get(id)
      entry.record = {
        endedAt: record.endedAt,
        firstFailure: record.firstFailure,
        failedSteps: record.steps.filter(step => step.exit !== 0).map(step => step.name),
        shifts: record.shifts,
        tickets: record.tickets,
        functions: record.functions,
        recordOnRemote: next?.previous?.recordOnRemote ?? 'unknown',
      }
    }
    return entry
  })
  const gitOnly = list.filter(entry => entry.source === 'git')
  if (gitOnly.length > 0) {
    unknowns.push(`${gitOnly.length} ${gitOnly.length === 1 ? 'cycle is' : 'cycles are'} seen only in git history (${gitOnly.map(entry => entry.cycle).join(', ')}): ${gitOnly.length === 1 ? 'its' : 'their'} steps, outcome and ledger lines are unknown`)
  }
  for (const entry of list) {
    if (entry.record?.recordOnRemote === 'unknown') unknowns.push(`whether ${entry.cycle}'s record reached the remote branch is unknown until a later cycle's record states it`)
  }
  const failedByStep: Record<string, number> = {}
  for (const entry of list) for (const step of new Set(entry.record?.failedSteps ?? [])) failedByStep[step] = (failedByStep[step] ?? 0) + 1

  // Tickets and shipped commits.
  const byStatus: Record<TicketStatus, number> = { shipped: 0, rejected: 0, halted: 0 }
  const divisions = new Map<string, { division: string; lines: number } & Record<TicketStatus, number>>()
  const shippedTickets = new Map<string, ShippedTicket>()
  for (const line of [...ticketLines].sort((left, right) => ms(left.at) - ms(right.at))) {
    const status = ticketStatus(line)
    byStatus[status] += 1
    const tally = divisions.get(line.division) ?? { division: line.division, lines: 0, shipped: 0, rejected: 0, halted: 0 }
    tally.lines += 1
    tally[status] += 1
    divisions.set(line.division, tally)
    if (line.shipped !== null) {
      shippedTickets.set(`${line.ticket} ${line.shipped.commit}`, { ticket: line.ticket, division: line.division, seat: line.seat, commit: line.shipped.commit, at: line.at, shift: line.shift })
    }
  }
  const shipped = [...shippedTickets.values()]
  const commitIds = [...new Set(shipped.map(ticket => ticket.commit))].sort()
  const answers = await ciAnswers(commitIds, sources)
  const commits: ShippedCommitReport[] = commitIds.map((commit) => {
    const carried = shipped.filter(ticket => ticket.commit === commit)
    const ci: CiAnswer = answers.get(commit) ?? { basis: 'unknown', reason: 'no answer was sought' }
    return {
      commit,
      tickets: [...new Set(carried.map(ticket => ticket.ticket))].sort(),
      divisions: [...new Set(carried.map(ticket => ticket.division))].sort(),
      ci,
      verdict: verdictOf(ci),
    }
  })
  for (const entry of commits) if (entry.ci.basis === 'unknown') unknowns.push(`the Branch CI verdict of ${entry.commit.slice(0, 10)} is unknown: ${entry.ci.reason}`)

  // Seats at the window's end.
  const roster = sources.rosterAt(window.until)
  const byDivision = roster.divisions.map((division) => {
    const members = roster.agents.filter(agent => agent.division === division.id)
    return {
      id: division.id,
      name: division.name,
      defined: members.length,
      occupied: members.filter(agent => agent.evidence.sessions > 0 || agent.ledger.lines > 0).length,
      active: members.filter(agent => agent.status === 'active').length,
    }
  })

  // Function runs.
  const functionDivisions = new Map<string, { division: string } & Record<FunctionOutcome, number>>()
  for (const line of functionLines) {
    const tally = functionDivisions.get(line.division) ?? { division: line.division, pass: 0, fail: 0, error: 0 }
    tally[line.outcome] += 1
    functionDivisions.set(line.division, tally)
  }

  // Tokens and seconds.
  const withTokens = ticketLines.filter(line => line.tokens !== undefined)
  if (withTokens.length < ticketLines.length) {
    unknowns.push(`${ticketLines.length - withTokens.length} ticket ${ticketLines.length - withTokens.length === 1 ? 'line states' : 'lines state'} no token count; the token total leaves ${ticketLines.length - withTokens.length === 1 ? 'it' : 'them'} out`)
  }
  const cycleSeconds = list.reduce((sum, entry) =>
    sum + (entry.record === undefined ? 0 : Math.round((ms(entry.record.endedAt) - ms(entry.startedAt)) / 1000)), 0)

  return {
    window,
    head: { commit: head, committedAt: sources.repository.commitTime(head) ?? null },
    cycles: {
      count: list.length,
      recorded: list.length - gitOnly.length,
      gitOnly: gitOnly.length,
      clean: list.filter(entry => entry.outcome === 'clean').length,
      failed: list.filter(entry => entry.outcome === 'failed').length,
      failedByStep: Object.fromEntries(Object.entries(failedByStep).sort(([left], [right]) => left.localeCompare(right))),
      list,
    },
    tickets: {
      lines: ticketLines.length,
      byStatus,
      byDivision: [...divisions.values()].sort((left, right) => left.division.localeCompare(right.division)),
      shipped,
    },
    commits,
    seats: {
      at: window.until,
      defined: roster.counts.defined,
      occupied: roster.counts.occupied,
      active: roster.counts.active,
      byDivision,
    },
    functions: {
      lines: functionLines.length,
      byDivision: [...functionDivisions.values()].sort((left, right) => left.division.localeCompare(right.division)),
    },
    effort: {
      tokens: {
        total: withTokens.reduce((sum, line) => sum + (line.tokens ?? 0), 0),
        lines: withTokens.length,
        withoutCount: ticketLines.length - withTokens.length,
      },
      seconds: {
        tickets: tenths(ticketLines.reduce((sum, line) => sum + (line.seconds ?? 0), 0)),
        functions: tenths(functionLines.reduce((sum, line) => sum + line.seconds, 0)),
        cycles: cycleSeconds,
      },
    },
    unknowns,
  }
}

function table(header: readonly string[], rows: readonly (readonly (string | number)[])[]): string[] {
  return [`| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`, ...rows.map(row => `| ${row.join(' | ')} |`)]
}

function counts<K extends string>(keys: readonly K[], values: Record<K, number>): string {
  return keys.map(key => `${values[key]} ${key}`).join(', ')
}

/**
 * Render the report as Markdown.
 * @param report - the report.
 * @returns the Markdown, ending in one newline.
 */
export function renderReport(report: EnterpriseWindowReport): string {
  const { cycles, tickets, seats, functions, effort } = report
  const cycleRows = cycles.list.map((entry) => {
    const pushed = entry.commits.map(commit => `\`${commit.commit.slice(0, 10)}\` ${commit.carries}`).join('; ') || 'none'
    if (entry.record === undefined) return [entry.cycle, 'git history only', 'unknown', '—', '—', '—', pushed, '—']
    const failure = entry.record.firstFailure === null ? 'clean' : `failed: ${entry.record.failedSteps.join(', ')} (first ${entry.record.firstFailure.step} exit ${entry.record.firstFailure.exit})`
    const onRemote = entry.record.recordOnRemote === 'unknown' ? 'unknown' : entry.record.recordOnRemote ? 'yes' : 'no'
    return [
      entry.cycle,
      'record',
      failure,
      entry.record.shifts.join(', ') || 'none',
      counts(TICKET_STATUSES, entry.record.tickets),
      counts(FUNCTION_OUTCOMES, entry.record.functions),
      pushed,
      onRemote,
    ]
  })
  const lines = [
    `# Enterprise report, ${report.window.since} to ${report.window.until}`,
    '',
    `Read from commit \`${report.head.commit}\` (committed ${report.head.committedAt ?? 'at a time git could not state'}): the ledger, the cycle records and the git history of that commit, the roster generator at the window's end, and GitHub's Branch CI runs as the API answered. What they do not show is listed under Unknown.`,
    '',
    '## Cycles',
    '',
    `${cycles.count} ${cycles.count === 1 ? 'cycle' : 'cycles'} started in the window: ${cycles.recorded} recorded (${cycles.clean} clean, ${cycles.failed} failed), ${cycles.gitOnly} seen only in git history.`,
    ...Object.keys(cycles.failedByStep).length === 0 ? [] : ['', `Failed steps: ${Object.entries(cycles.failedByStep).map(([step, count]) => `\`${step}\` in ${count}`).join(', ')}.`],
    ...cycleRows.length === 0 ? [] : ['', ...table(['Cycle', 'Source', 'Outcome', 'Shifts', 'Ticket lines', 'Function lines', 'Commits on the branch', 'Record on the remote'], cycleRows)],
    '',
    '## Tickets',
    '',
    `${tickets.lines} ticket ${tickets.lines === 1 ? 'line' : 'lines'}: ${counts(TICKET_STATUSES, tickets.byStatus)}.`,
    ...tickets.byDivision.length === 0 ? [] : ['', ...table(['Division', 'Lines', 'Shipped', 'Rejected', 'Halted'], tickets.byDivision.map(row => [row.division, row.lines, row.shipped, row.rejected, row.halted]))],
    '',
    `${tickets.shipped.length} distinct ${tickets.shipped.length === 1 ? 'ticket' : 'tickets'} shipped.`,
    ...tickets.shipped.length === 0 ? [] : ['', ...table(['Ticket', 'Division', 'Commit', 'Shipped at', 'Shift', 'Branch CI'], tickets.shipped.map(ticket => [
      ticket.ticket,
      ticket.division,
      `\`${ticket.commit.slice(0, 10)}\``,
      ticket.at,
      ticket.shift,
      report.commits.find(entry => entry.commit === ticket.commit)?.verdict ?? 'unknown',
    ]))],
    '',
    '## Branch CI of the shipped commits',
    '',
    ...report.commits.length === 0 ? ['No commit shipped in the window.'] : table(['Commit', 'Tickets', 'Verdict', 'Which run'], report.commits.map(entry => [
      `\`${entry.commit.slice(0, 10)}\``,
      entry.tickets.join(', '),
      entry.verdict,
      describeCi(entry.commit, entry.ci),
    ])),
    '',
    `## Seats at ${seats.at}`,
    '',
    `${seats.defined} defined, ${seats.occupied} occupied, ${seats.active} active in the 24 hours before ${seats.at}.`,
    '',
    ...table(['Division', 'Defined', 'Occupied', 'Active'], seats.byDivision.map(row => [row.name, row.defined, row.occupied, row.active])),
    '',
    '## Function runs',
    '',
    `${functions.lines} function ${functions.lines === 1 ? 'line' : 'lines'}.`,
    ...functions.byDivision.length === 0 ? [] : ['', ...table(['Division', 'Pass', 'Fail', 'Error'], functions.byDivision.map(row => [row.division, row.pass, row.fail, row.error]))],
    '',
    '## Tokens and seconds',
    '',
    `- Tokens: ${effort.tokens.total} over ${effort.tokens.lines} ticket ${effort.tokens.lines === 1 ? 'line' : 'lines'}${effort.tokens.withoutCount === 0 ? '' : `; ${effort.tokens.withoutCount} more state none`}.`,
    `- Seconds: ${effort.seconds.tickets} on ticket lines, ${effort.seconds.functions} on function lines, ${effort.seconds.cycles} of recorded cycles' wall time.`,
    '',
    '## Unknown',
    '',
    ...report.unknowns.length === 0 ? ['Nothing the report covers is unknown.'] : report.unknowns.map(unknown => `- ${unknown}`),
  ]
  return `${lines.join('\n')}\n`
}

/**
 * The checkout's git history as the report reads it.
 * @param root - repository root.
 * @returns the repository reader.
 */
export function gitRepository(root: string): ReportRepository {
  const git = (args: readonly string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 }).trimEnd()
  const status = (args: readonly string[]): number | undefined => {
    try {
      git(args)
      return 0
    } catch (error) {
      // `git merge-base --is-ancestor` answers "no" with exit 1; any other failure means the checkout lacks a commit.
      return isRecord(error) && typeof error.status === 'number' ? error.status : undefined
    }
  }
  return {
    head: () => git(['rev-parse', 'HEAD']),
    cycleCommits: () => git(['log', '--reverse', '--format=%H%x09%s', 'HEAD']).split('\n').flatMap((row) => {
      const [commit, subject] = row.split('\t')
      const parts = CYCLE_SUBJECT.exec(subject ?? '')
      const [, cycle, carries] = parts ?? []
      return commit === undefined || cycle === undefined || carries === undefined ? [] : [{ commit, cycle, carries }]
    }),
    commitTime: (commit) => {
      if (status(['cat-file', '-e', `${commit}^{commit}`]) !== 0) return undefined
      return new Date(git(['show', '-s', '--format=%cI', commit])).toISOString()
    },
    contains: (ancestor, descendant) => {
      const code = status(['merge-base', '--is-ancestor', ancestor, descendant])
      return code === 0 ? true : code === 1 ? false : undefined
    },
  }
}

/**
 * The roster generator run at a moment: the committed records' sessions and
 * the ledger lines dated at or before it, stamped with it.
 * @param root - repository root.
 * @returns the function the report calls with the window's end.
 */
export function rosterGeneratorAt(root: string): (until: string) => Roster {
  return (until) => {
    const untilMs = ms(until)
    const recorded = readRecordedSessions(root, committedRecords(root)).map(run => ({
      ...run,
      sessions: run.sessions.filter(session => session.lastSeenMs === undefined || session.lastSeenMs <= untilMs),
    }))
    const ledger = readLedger(join(root, LEDGER_PATH)).lines.filter(line => ms(line.at) <= untilMs)
    return buildRoster(root, { generatedAt: until, recorded, ledger })
  }
}

/** Parsed command line. */
export interface ReportArguments {
  since?: string
  until?: string
  write: boolean
}

/**
 * Read the CLI flags; a bare `--`, which `pnpm run` forwards, is skipped.
 * @param argv - the arguments after the script path.
 * @returns the flags.
 * @throws on an unknown flag, a missing value, or a value that is not an ISO time.
 */
export function parseReportArguments(argv: readonly string[]): ReportArguments {
  const parsed: ReportArguments = { write: false }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--') continue
    if (flag === '--write') {
      parsed.write = true
      continue
    }
    if (flag !== '--since' && flag !== '--until') throw new Error(`enterprise-report: unknown flag ${flag}`)
    const value = argv[index + 1]
    if (value === undefined || !Number.isFinite(ms(value))) throw new Error(`enterprise-report: ${flag} needs an ISO time`)
    parsed[flag === '--since' ? 'since' : 'until'] = new Date(value).toISOString()
    index += 1
  }
  return parsed
}

/**
 * The window the flags name: `--until` or now, and `--since` or 24 hours before it.
 * @param args - the flags.
 * @param now - the current moment.
 * @returns the window.
 * @throws when `--since` is after `--until`.
 */
export function reportWindow(args: ReportArguments, now: Date): ReportWindow {
  const until = args.until ?? now.toISOString()
  const since = args.since ?? new Date(ms(until) - ACTIVE_WINDOW_MS).toISOString()
  if (ms(since) > ms(until)) throw new Error(`enterprise-report: --since ${since} is after --until ${until}`)
  return { since, until }
}

/**
 * Write a report beside the others, named by its window's end to the minute.
 * @param root - repository root.
 * @param report - the report.
 * @returns the repository-relative paths written, JSON first.
 */
export function writeReport(root: string, report: EnterpriseWindowReport): string[] {
  const stem = `${REPORTS_DIR}/${report.window.until.slice(0, 16).replace(':', '')}Z`
  mkdirSync(join(root, REPORTS_DIR), { recursive: true })
  writeFileSync(join(root, `${stem}.json`), `${JSON.stringify(report, null, 2)}\n`)
  writeFileSync(join(root, `${stem}.md`), renderReport(report))
  return [`${stem}.json`, `${stem}.md`]
}

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${resolve(process.argv[1])}`
if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const args = parseReportArguments(process.argv.slice(2))
  const report = await enterpriseReport(
    { root, repository: gitRepository(root), github: githubReader(), rosterAt: rosterGeneratorAt(root) },
    reportWindow(args, new Date()),
  )
  process.stdout.write(renderReport(report))
  if (args.write) for (const file of writeReport(root, report)) console.error(`enterprise-report: wrote ${file}`)
}
