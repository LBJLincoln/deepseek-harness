/**
 * The enterprise's report over a time window
 * (`pnpm run enterprise:report -- [--since <ISO>] [--until <ISO>] [--write]`):
 * a one-sentence headline of the pilot's exact counts, the cycles that ran and
 * who started them, the shifts (recorded, shown by ledger lines only, or lost
 * as the loss register states), the tickets the shifts worked, reviewed and
 * shipped, each shipped commit's Branch CI verdict, the function runs, the
 * spend as labelled totals per source, and the seats occupied and active at
 * the window's end. Every figure comes from the checkout — the ledger, the
 * cycle, shift and intake records, `data/transcripts/LOSSES.md`, the recorded
 * sessions, HEAD's git history, the roster generator — and from GitHub's
 * answer about Branch CI runs, so the report is a deterministic function of
 * the repository state and those answers. A fact none of them shows is listed
 * in {@link EnterpriseWindowReport.unknowns}, never inferred.
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
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { cycleStartedAt, readCycleRecords, type CycleRecord } from './enterprise-cycle-record.ts'
import {
  CI_REPOSITORY,
  CI_WORKFLOW,
  DEFAULT_CI_BRANCH,
  githubReader,
  observedRecords,
  proxyHint,
  SHIFT_RECORDS,
  sessionFiguresIn,
  type GitHubReader,
  type SessionFigures,
  type TokenTotals,
} from './enterprise-functions.ts'
import {
  ACTIVE_WINDOW_MS,
  LEDGER_PATH,
  parseLedgerLine,
  readLedger,
  ticketStatus,
  type FunctionLine,
  type FunctionOutcome,
  type LedgerLine,
  type TicketLine,
  type TicketStatus,
  type WorkCounts,
} from './enterprise-ledger.ts'
import { buildRoster, divisionSeats, type Roster, type RosterWorkCounts } from './enterprise-roster.ts'
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
  /**
   * @param path - a repository path.
   * @param text - when given, only commits whose change to `path` adds or removes this text count.
   * @returns the committer time of the oldest commit in HEAD's history that changed `path` so, or `undefined` when none did.
   */
  firstChange: (path: string, text?: string) => string | undefined
}

/** The recorded sessions of a window, folded per record tree, as `sessionFiguresIn` in `scripts/enterprise-functions.ts` returns them. */
export interface WindowSessions {
  byTree: Record<string, SessionFigures>
  skipped: { session: string; reason: string }[]
}

/** Everything a report reads. */
export interface ReportSources {
  /** Repository root: where the ledger, the cycle, shift and intake records and the loss register are read. */
  root: string
  repository: ReportRepository
  github: GitHubReader
  /** @param until - the window's end. @returns the roster as the generator builds it at that moment. */
  rosterAt: (until: string) => Roster
  /** @param window - the report's window. @returns the recorded sessions whose newest event falls inside it, folded per tree. */
  sessions: (window: ReportWindow) => WindowSessions
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
 * commit (`exact`) when one of them rendered a verdict or is still queued or
 * running; else the first run created after the commit that rendered a verdict
 * (`success` or `failure`) and whose head contains it (`later`); else no such
 * run (`none`); or `unknown` with the reason no answer could be read. A run
 * cancelled while it waited behind a newer push rendered none, so `later` and
 * `none` list the commit's own runs that ended that way as `superseded`.
 */
export type CiAnswer =
  | { basis: 'exact'; runs: CiRunRef[] }
  | { basis: 'later'; run: CiRunRef; superseded: CiRunRef[] }
  | { basis: 'none'; superseded: CiRunRef[] }
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
  /** Who started the cycle, and what says so. */
  startedBy: { by: 'scheduler' | 'operator' | 'unknown'; basis: string }
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

/**
 * One shift of the window: from its record under `data/enterprise/shifts/`,
 * from ledger lines alone, or from the loss register when neither exists.
 */
export interface ShiftEntry {
  shift: string
  /** ISO time the shift began, or `null` when only ledger lines show it. */
  startedAt: string | null
  source: 'record' | 'ledger' | 'lost'
  /** The program's outcome and any halt, as the record states them; what the source says for the others. */
  outcome: string
  /** The shift's ticket lines by status. */
  tickets: Record<TicketStatus, number>
  /** The path that shows the shift. */
  evidence: string
}

/** One labelled total of spend: what it covers, where it is read, and its figures. */
export interface EffortTotal {
  covers: string
  source: string
  /** The items summed: lines, coordinators, sessions or cycles. */
  items: number
  /** Tokens, or `null` where the source records none. */
  tokens: number | null
  /** Seconds, or `null` where the source records none. */
  seconds: number | null
  /** The token kinds of recorded sessions. */
  breakdown?: TokenTotals
}

/** Seats of one division at the window's end. */
export interface DivisionSeats {
  id: string
  name: string
  defined: number
  occupied: number
  active: number
  /** The active seats by what their deliverables inside the window were. */
  work: WorkCounts
}

/** The report, as `--write` stores it and the deck's day view reads it. */
export interface EnterpriseWindowReport {
  window: ReportWindow
  /** The commit whose files and history the report read, and its committer time (`null` when git cannot say). */
  head: { commit: string; committedAt: string | null }
  /** The pilot's state over the window in one sentence of exact counts. */
  headline: string
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
  /** The shifts that began inside the window, or that only ledger lines inside it show, oldest first. */
  shifts: ShiftEntry[]
  tickets: {
    /** Ticket lines dated inside the window. */
    lines: number
    byStatus: Record<TicketStatus, number>
    byDivision: ({ division: string; lines: number } & Record<TicketStatus, number>)[]
    /** The independent review of those lines: approved, rejected, or not reached (no verdict recorded). */
    reviews: { approved: number; rejected: number; notReached: number }
    /** The distinct tickets shipped inside the window, by their shipping line's time. */
    shipped: ShippedTicket[]
  }
  /** Each commit a ticket shipped as inside the window, with its Branch CI answer. */
  commits: ShippedCommitReport[]
  /** Seats at the window's end, from the roster generator run at that moment. */
  seats: { at: string; defined: number; occupied: number; active: number; work: RosterWorkCounts; byDivision: DivisionSeats[] }
  functions: {
    /** Function lines dated inside the window. */
    lines: number
    byDivision: ({ division: string } & Record<FunctionOutcome, number>)[]
  }
  /**
   * Spend inside the window, one labelled total per source. The totals measure
   * different things and overlap (a ticket line's count includes sessions whose
   * logs are also folded), so they are never summed.
   */
  effort: EffortTotal[]
  /** Every fact the report could not establish, in plain words. */
  unknowns: string[]
}

const TICKET_STATUSES: readonly TicketStatus[] = ['shipped', 'rejected', 'halted']
const FUNCTION_OUTCOMES: readonly FunctionOutcome[] = ['pass', 'fail', 'error']
const CYCLE_SUBJECT = /^chore\(enterprise\): (cycle-\d{8}T\d{6}Z) (.+)$/

/** The register of work container resets erased, which names each lost shift. */
const LOSSES_PATH = 'data/transcripts/LOSSES.md'

/** The scheduler script; a cycle that began before its first commit was started by hand. */
const SCHEDULER_PATH = 'scripts/enterprise-scheduler.sh'

/** The intake records, one directory per intake run. */
const INTAKE_RECORDS = 'data/enterprise/intake'

/** A shift id as the engine mints it: the UTC time it began and four hex digits. */
const SHIFT_ID = /`(\d{2})(\d{2})(\d{2})-([0-9a-f]{4})`/g

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

/** A completed run whose lanes rendered a verdict; a cancelled run rendered none. */
function rendered(run: CiRunRef): boolean {
  return run.status === 'completed' && (run.conclusion === 'success' || run.conclusion === 'failure')
}

/**
 * The phrase a Branch CI answer reads as.
 * @param ci - the answer.
 * @returns the newest exact run's verdict (or `in progress`), the later run's conclusion, `no run`, or `unknown`.
 */
function verdictOf(ci: CiAnswer): string {
  switch (ci.basis) {
    case 'exact': return ci.runs.find(rendered)?.conclusion ?? 'in progress'
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
      const exact = readRuns(await sources.github.json(`${base}?head_sha=${commit}&per_page=100`)).filter(run => run.headSha === commit).sort(newestRunFirst)
      if (exact.some(run => run.status !== 'completed' || rendered(run))) {
        answers.set(commit, { basis: 'exact', runs: exact })
        continue
      }
      const time = times.get(commit)
      if (time === undefined) {
        answers.set(commit, { basis: 'unknown', reason: `no run on ${commit} rendered a verdict, and the checkout lacks the commit, so no later run can be matched to it` })
        continue
      }
      branchRuns ??= await listBranchRuns()
      const later = branchRuns
        .filter(run => rendered(run) && ms(run.createdAt) >= ms(time))
        .sort((left, right) => -newestRunFirst(left, right))
      let answer: CiAnswer = { basis: 'none', superseded: exact }
      for (const run of later) {
        const contained = sources.repository.contains(commit, run.headSha)
        if (contained === undefined) {
          answer = { basis: 'unknown', reason: `Branch CI run ${run.id}'s head ${run.headSha} is not in this checkout; fetch the branch and run the report again` }
          break
        }
        if (contained) {
          answer = { basis: 'later', run, superseded: exact }
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

/**
 * What became of a commit's own runs when none rendered a verdict.
 * @param superseded - the commit's runs that ended without one.
 * @param where - how the clause names the commit.
 * @returns the clause.
 */
function ownRuns(superseded: readonly CiRunRef[], where: string): string {
  if (superseded.length === 0) return `no run on ${where}`
  return `${superseded.length === 1 ? 'run' : 'runs'} ${superseded.map(run => `${run.id} (${run.conclusion ?? run.status})`).join(', ')} on ${where} rendered no verdict`
}

/**
 * Which run a Branch CI answer rests on, in words.
 * @param commit - the shipped commit.
 * @param ci - its answer.
 * @returns the clause the report's table cites.
 */
export function describeCi(commit: string, ci: CiAnswer): string {
  switch (ci.basis) {
    case 'exact': return `${ci.runs.length === 1 ? 'run' : 'runs'} ${ci.runs.map(run => `${run.id} (${run.conclusion ?? run.status})`).join(', ')} on this exact commit`
    case 'later': return `${ownRuns(ci.superseded, 'this exact commit')}; the first later completed run whose head contains it is ${ci.run.id} on ${ci.run.headSha.slice(0, 10)}`
    case 'none': return `${ownRuns(ci.superseded, commit.slice(0, 10))} and no later completed run whose head contains it`
    case 'unknown': return ci.reason
    default: return assertNever(ci)
  }
}

/**
 * Who started a cycle: its record's `startedBy`; else `operator` when the
 * cycle began before the scheduler script's first commit, since nothing else
 * could have started it; else unknown.
 * @returns the starter and what says so.
 */
function startedByOf(startedAt: string, record: CycleRecord | undefined, schedulerSince: string | undefined): CycleEntry['startedBy'] {
  if (record?.startedBy !== undefined) return { by: record.startedBy, basis: 'the cycle record' }
  if (schedulerSince !== undefined && ms(startedAt) < ms(schedulerSince)) {
    return { by: 'operator', basis: `it began before ${SCHEDULER_PATH} was first committed, at ${schedulerSince}` }
  }
  return { by: 'unknown', basis: record === undefined ? 'the cycle has no record' : 'its record predates the startedBy field' }
}

/** A shift record as the report reads it. */
interface ShiftRecord {
  shift: string
  startedAt: string
  outcome: string
  lines: TicketLine[]
  evidence: string
}

/**
 * Read every shift record's `result.json`, a durable file whose fields are each checked.
 * @param root - repository root.
 * @returns the readable records, and the paths of the others.
 */
function readShiftRecords(root: string): { shifts: ShiftRecord[]; unreadable: string[] } {
  const read: { shifts: ShiftRecord[]; unreadable: string[] } = { shifts: [], unreadable: [] }
  const dir = join(root, SHIFT_RECORDS)
  if (!existsSync(dir)) return read
  for (const name of readdirSync(dir).sort()) {
    const path = `${SHIFT_RECORDS}/${name}/result.json`
    if (!existsSync(join(root, path))) continue
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(join(root, path), 'utf8'))
    } catch {
      // A torn record is reported as unreadable; the shift's ledger lines still show it.
      read.unreadable.push(path)
      continue
    }
    if (!isRecord(raw) || typeof raw.shift !== 'string' || typeof raw.startedAt !== 'string' || !Number.isFinite(ms(raw.startedAt))) {
      read.unreadable.push(path)
      continue
    }
    const program = isRecord(raw.report) && typeof raw.report.outcome === 'string' ? `program ${raw.report.outcome}` : 'no program outcome recorded'
    const halt = raw.halt === null || raw.halt === undefined
      ? ''
      : `; halted: ${isRecord(raw.halt) && typeof raw.halt.reason === 'string' ? raw.halt.reason : JSON.stringify(raw.halt)}`
    const lines = (Array.isArray(raw.tickets) ? raw.tickets : [])
      .map(entry => parseLedgerLine(entry))
      .filter((line): line is TicketLine => typeof line !== 'string' && line.type === 'ticket')
    read.shifts.push({ shift: raw.shift, startedAt: new Date(raw.startedAt).toISOString(), outcome: `${program}${halt}`, lines, evidence: `${SHIFT_RECORDS}/${name}` })
  }
  return read
}

/**
 * The shifts the loss register names, dated by their id's time of day on
 * the day of the register's first mention of them.
 * @returns each named shift id with the moment it began, when the mention can be dated.
 */
function lostShifts(sources: ReportSources): { shift: string; startedAt: string }[] {
  const file = join(sources.root, LOSSES_PATH)
  if (!existsSync(file)) return []
  const lost: { shift: string; startedAt: string }[] = []
  for (const [, hours, minutes, seconds, suffix] of readFileSync(file, 'utf8').matchAll(SHIFT_ID)) {
    const shift = `${hours}${minutes}${seconds}-${suffix}`
    const mention = sources.repository.firstChange(LOSSES_PATH, shift)
    if (mention === undefined || lost.some(entry => entry.shift === shift)) continue
    const sameDay = ms(`${mention.slice(0, 10)}T${hours}:${minutes}:${seconds}Z`)
    const startedMs = sameDay <= ms(mention) ? sameDay : sameDay - ACTIVE_WINDOW_MS
    lost.push({ shift, startedAt: new Date(startedMs).toISOString() })
  }
  return lost
}

/**
 * The window's shifts: every recorded shift that began in it, every shift
 * only ledger lines in it show, and every lost shift that began in it and
 * left neither a record nor a ledger line.
 * @returns the shifts, oldest first.
 */
function shiftsOf(
  records: readonly ShiftRecord[],
  allLines: readonly LedgerLine[],
  windowLines: readonly TicketLine[],
  lost: readonly { shift: string; startedAt: string }[],
  window: ReportWindow,
): ShiftEntry[] {
  const tally = (lines: readonly TicketLine[]): Record<TicketStatus, number> => {
    const counts: Record<TicketStatus, number> = { shipped: 0, rejected: 0, halted: 0 }
    for (const line of lines) counts[ticketStatus(line)] += 1
    return counts
  }
  const recorded = new Set(records.map(record => record.shift))
  const entries: (ShiftEntry & { order: string })[] = records
    .filter(record => inWindow(record.startedAt, window))
    .map(record => ({ shift: record.shift, startedAt: record.startedAt, source: 'record', outcome: record.outcome, tickets: tally(record.lines), evidence: record.evidence, order: record.startedAt }))
  const ledgerOnly = new Map<string, TicketLine[]>()
  for (const line of windowLines) if (!recorded.has(line.shift)) ledgerOnly.set(line.shift, [...ledgerOnly.get(line.shift) ?? [], line])
  for (const [shift, lines] of ledgerOnly) {
    const order = lines.map(line => line.at).sort()[0] ?? window.since
    entries.push({ shift, startedAt: null, source: 'ledger', outcome: 'no shift record in the checkout', tickets: tally(lines), evidence: LEDGER_PATH, order })
  }
  const lined = new Set(allLines.map(line => line.shift))
  for (const entry of lost) {
    if (recorded.has(entry.shift) || lined.has(entry.shift) || !inWindow(entry.startedAt, window)) continue
    entries.push({
      shift: entry.shift,
      startedAt: entry.startedAt,
      source: 'lost',
      outcome: 'lost: no ledger line and no record',
      tickets: { shipped: 0, rejected: 0, halted: 0 },
      evidence: LOSSES_PATH,
      order: entry.startedAt,
    })
  }
  return entries
    .sort((left, right) => ms(left.order) - ms(right.order) || left.shift.localeCompare(right.shift))
    .map(({ order: _order, ...entry }) => entry)
}

/**
 * Read the intake records' coordinator figures inside the window.
 * @returns the coordinators that ran, with the tokens and seconds each record states.
 */
function intakeCoordinators(root: string, window: ReportWindow): { tokens?: number; seconds?: number }[] {
  const dir = join(root, INTAKE_RECORDS)
  if (!existsSync(dir)) return []
  const coordinators: { tokens?: number; seconds?: number }[] = []
  for (const name of readdirSync(dir).sort()) {
    const file = join(dir, name, 'result.json')
    if (!existsSync(file)) continue
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      // A torn intake record states no figures; the intake's function lines still show its coordinators.
      continue
    }
    if (!isRecord(raw) || typeof raw.at !== 'string' || !inWindow(raw.at, window) || !Array.isArray(raw.coordinators)) continue
    for (const entry of raw.coordinators) {
      if (!isRecord(entry) || entry.ran !== true) continue
      coordinators.push({
        ...typeof entry.tokens === 'number' ? { tokens: entry.tokens } : {},
        ...typeof entry.seconds === 'number' ? { seconds: entry.seconds } : {},
      })
    }
  }
  return coordinators
}

/**
 * The window's spend, one labelled total per source, noting each unknown.
 * @returns the totals, in source order.
 */
function effortOf(
  sources: ReportSources,
  window: ReportWindow,
  ticketLines: readonly TicketLine[],
  functionLines: readonly FunctionLine[],
  cycles: readonly CycleEntry[],
  unknowns: string[],
): EffortTotal[] {
  const effort: EffortTotal[] = []
  const withTokens = ticketLines.filter(line => line.tokens !== undefined)
  if (withTokens.length < ticketLines.length) {
    const missing = ticketLines.length - withTokens.length
    unknowns.push(`${missing} ticket ${missing === 1 ? 'line states' : 'lines state'} no token count; the ticket lines' token total leaves ${missing === 1 ? 'it' : 'them'} out`)
  }
  effort.push({
    covers: 'ticket lines: the engine\'s count for each ticket a shift worked, its department\'s and its review\'s sessions',
    source: LEDGER_PATH,
    items: ticketLines.length,
    tokens: withTokens.reduce((sum, line) => sum + (line.tokens ?? 0), 0),
    seconds: tenths(ticketLines.reduce((sum, line) => sum + (line.seconds ?? 0), 0)),
  })
  const coordinators = intakeCoordinators(sources.root, window)
  const withoutTokens = coordinators.filter(entry => entry.tokens === undefined).length
  if (withoutTokens > 0) unknowns.push(`${withoutTokens} intake ${withoutTokens === 1 ? 'coordinator states' : 'coordinators state'} no token count; the intake total leaves ${withoutTokens === 1 ? 'it' : 'them'} out`)
  effort.push({
    covers: 'intake coordinators: each coordinator department an intake ran, as its intake record counts it',
    source: `${INTAKE_RECORDS}/*/result.json`,
    items: coordinators.length,
    tokens: coordinators.reduce((sum, entry) => sum + (entry.tokens ?? 0), 0),
    seconds: tenths(coordinators.reduce((sum, entry) => sum + (entry.seconds ?? 0), 0)),
  })
  const sessions = sources.sessions(window)
  if (sessions.skipped.length > 0) {
    unknowns.push(`${sessions.skipped.length} recorded ${sessions.skipped.length === 1 ? 'session' : 'sessions'} could not be folded (${sessions.skipped.map(entry => entry.session).join(', ')}); ${sessions.skipped.length === 1 ? 'its' : 'their'} tokens are left out`)
  }
  for (const [tree, figures] of Object.entries(sessions.byTree)) {
    const { input, output, cacheRead, cacheWrite, reasoning } = figures.tokens
    effort.push({
      covers: `recorded sessions under ${tree} whose newest event falls in the window: the tokens their usage events state, and their model time`,
      source: tree,
      items: figures.sessions,
      tokens: input + output + cacheRead + cacheWrite + reasoning,
      seconds: tenths(figures.stats.llmMs / 1000),
      breakdown: figures.tokens,
    })
  }
  effort.push({
    covers: 'function lines: the seconds each seat\'s gate, verdict read or fold took; no model is called',
    source: LEDGER_PATH,
    items: functionLines.length,
    tokens: null,
    seconds: tenths(functionLines.reduce((sum, line) => sum + line.seconds, 0)),
  })
  const recordedCycles = cycles.flatMap(entry =>
    entry.record === undefined ? [] : [{ startedAt: entry.startedAt, endedAt: entry.record.endedAt }])
  effort.push({
    covers: 'recorded cycles: each one\'s wall time from its start to its record',
    source: 'data/enterprise/cycles/*.json',
    items: recordedCycles.length,
    tokens: null,
    seconds: recordedCycles.reduce((sum, cycle) => sum + Math.round((ms(cycle.endedAt) - ms(cycle.startedAt)) / 1000), 0),
  })
  return effort
}

/**
 * The pilot's state over the window in one sentence: cycles, shifts,
 * tickets, reviews, shipped commits with their Branch CI verdicts, and
 * function runs, each with its exact count.
 * @param report - the report without its headline.
 * @returns the sentence.
 */
function headlineOf(report: Omit<EnterpriseWindowReport, 'headline' | 'unknowns'>): string {
  const { cycles, shifts, tickets, commits, functions } = report
  const count = (values: readonly string[]): string => {
    const tally = new Map<string, number>()
    for (const value of values) tally.set(value, (tally.get(value) ?? 0) + 1)
    return [...tally].map(([value, n]) => `${n} ${value}`).join(', ') || 'none'
  }
  const later = commits.filter(entry => entry.ci.basis === 'later').length
  const passes = functions.byDivision.reduce((sum, row) => sum + row.pass, 0)
  const fails = functions.byDivision.reduce((sum, row) => sum + row.fail, 0)
  const errors = functions.byDivision.reduce((sum, row) => sum + row.error, 0)
  return [
    `Pilot, ${report.window.since} to ${report.window.until}:`,
    `${cycles.count} cycles started (${cycles.clean} clean, ${cycles.failed} failed, ${cycles.gitOnly} without a record);`,
    `${shifts.length} shifts (${count(shifts.map(shift => shift.source === 'record' ? 'recorded' : shift.source === 'ledger' ? 'shown by ledger lines only' : 'lost'))});`,
    `${tickets.lines} ticket lines (${tickets.byStatus.shipped} shipped, ${tickets.byStatus.rejected} rejected, ${tickets.byStatus.halted} halted);`,
    `reviews ${tickets.reviews.approved} approved, ${tickets.reviews.rejected} rejected, ${tickets.reviews.notReached} not reached;`,
    `${tickets.shipped.length} tickets shipped in ${commits.length} commits, Branch CI ${count(commits.map(entry => entry.verdict))}${later === 0 ? '' : ` (${later} from a later run containing the commit)`};`,
    `${functions.lines} function runs (${passes} pass, ${fails} fail, ${errors} error).`,
  ].join(' ')
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
  const schedulerSince = sources.repository.firstChange(SCHEDULER_PATH)
  const list: CycleEntry[] = ids.map((id) => {
    const record = recorded.get(id)
    const startedAt = cycleStartedAt(id) ?? ''
    const entry: CycleEntry = {
      cycle: id,
      startedAt,
      source: record === undefined ? 'git' : 'record',
      outcome: record === undefined ? 'unknown' : record.firstFailure === null ? 'clean' : 'failed',
      startedBy: startedByOf(startedAt, record, schedulerSince),
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
    if (entry.startedBy.by === 'unknown') unknowns.push(`who started ${entry.cycle} is unknown: ${entry.startedBy.basis}`)
  }
  const failedByStep: Record<string, number> = {}
  for (const entry of list) for (const step of new Set(entry.record?.failedSteps ?? [])) failedByStep[step] = (failedByStep[step] ?? 0) + 1

  // Shifts.
  const shiftRead = readShiftRecords(sources.root)
  for (const path of shiftRead.unreadable) unknowns.push(`${path} could not be read; the shift it records is shown only by its ledger lines`)
  const shifts = shiftsOf(shiftRead.shifts, ledger.lines, ticketLines, lostShifts(sources), window)
  for (const shift of shifts) {
    if (shift.source === 'lost') unknowns.push(`the tickets, sessions and spend of shift ${shift.shift} are unknown: ${LOSSES_PATH} records it as lost, and it left no ledger line and no record`)
  }

  // Tickets and shipped commits.
  const byStatus: Record<TicketStatus, number> = { shipped: 0, rejected: 0, halted: 0 }
  const reviews = { approved: 0, rejected: 0, notReached: 0 }
  for (const line of ticketLines) {
    const verdict = line.review?.verdict.trim().toLowerCase()
    if (verdict === 'approve') reviews.approved += 1
    else if (verdict === 'reject') reviews.rejected += 1
    else reviews.notReached += 1
  }
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
  const byDivision: DivisionSeats[] = divisionSeats(roster)

  // Function runs.
  const functionDivisions = new Map<string, { division: string } & Record<FunctionOutcome, number>>()
  for (const line of functionLines) {
    const tally = functionDivisions.get(line.division) ?? { division: line.division, pass: 0, fail: 0, error: 0 }
    tally[line.outcome] += 1
    functionDivisions.set(line.division, tally)
  }

  // Spend.
  const effort = effortOf(sources, window, ticketLines, functionLines, list, unknowns)

  const report: Omit<EnterpriseWindowReport, 'headline' | 'unknowns'> = {
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
    shifts,
    tickets: {
      lines: ticketLines.length,
      byStatus,
      byDivision: [...divisions.values()].sort((left, right) => left.division.localeCompare(right.division)),
      reviews,
      shipped,
    },
    commits,
    seats: {
      at: window.until,
      defined: roster.counts.defined,
      occupied: roster.counts.occupied,
      active: roster.counts.active,
      work: roster.counts.work,
      byDivision,
    },
    functions: {
      lines: functionLines.length,
      byDivision: [...functionDivisions.values()].sort((left, right) => left.division.localeCompare(right.division)),
    },
    effort,
  }
  return { ...report, headline: headlineOf(report), unknowns }
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
  const { cycles, shifts, tickets, seats, functions, effort } = report
  const verdictLabel = (commit: string): string => {
    const entry = report.commits.find(candidate => candidate.commit === commit)
    if (entry === undefined) return 'unknown'
    return entry.ci.basis === 'later' ? `${entry.verdict} (from later run ${entry.ci.run.id}, which contains it)` : entry.verdict
  }
  const cycleRows = cycles.list.map((entry) => {
    const pushed = entry.commits.map(commit => `\`${commit.commit.slice(0, 10)}\` ${commit.carries}`).join('; ') || 'none'
    const startedBy = entry.startedBy.by === 'unknown' ? 'unknown' : `${entry.startedBy.by} (${entry.startedBy.basis})`
    if (entry.record === undefined) return [entry.cycle, startedBy, 'git history only', 'unknown', '—', '—', '—', pushed, '—']
    const { firstFailure } = entry.record
    const failure = firstFailure === null ? 'clean' : `failed: ${entry.record.failedSteps.join(', ')} (first ${firstFailure.step} exit ${firstFailure.exit})`
    const onRemote = entry.record.recordOnRemote === 'unknown' ? 'unknown' : entry.record.recordOnRemote ? 'yes' : 'no'
    return [
      entry.cycle,
      startedBy,
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
    `# Enterprise pilot report, ${report.window.since} to ${report.window.until}`,
    '',
    report.headline,
    '',
    `Read from commit \`${report.head.commit}\` (committed ${report.head.committedAt ?? 'at a time git could not state'}): the ledger, the cycle, shift and intake records, the loss register and the git history of that commit, the recorded sessions, the roster generator at the window's end, and GitHub's Branch CI runs as the API answered. What they do not show is listed under Unknown.`,
    '',
    '## Cycles',
    '',
    `${cycles.count} ${cycles.count === 1 ? 'cycle' : 'cycles'} started in the window: ${cycles.recorded} recorded (${cycles.clean} clean, ${cycles.failed} failed), ${cycles.gitOnly} seen only in git history.`,
    ...Object.keys(cycles.failedByStep).length === 0 ? [] : ['', `Failed steps: ${Object.entries(cycles.failedByStep).map(([step, count]) => `\`${step}\` in ${count}`).join(', ')}.`],
    ...cycleRows.length === 0
      ? []
      : ['', ...table(['Cycle', 'Started by', 'Source', 'Outcome', 'Shifts', 'Ticket lines', 'Function lines', 'Commits on the branch', 'Record on the remote'], cycleRows)],
    '',
    '## Shifts',
    '',
    `${shifts.length} ${shifts.length === 1 ? 'shift' : 'shifts'}.`,
    ...shifts.length === 0 ? [] : ['', ...table(['Shift', 'Began', 'Source', 'Outcome', 'Ticket lines', 'Evidence'], shifts.map(shift => [
      shift.shift,
      shift.startedAt ?? 'unknown',
      shift.source,
      shift.outcome,
      counts(TICKET_STATUSES, shift.tickets),
      `\`${shift.evidence}\``,
    ]))],
    '',
    '## Tickets',
    '',
    `${tickets.lines} ticket ${tickets.lines === 1 ? 'line' : 'lines'}: ${counts(TICKET_STATUSES, tickets.byStatus)}. Reviews: ${tickets.reviews.approved} approved, ${tickets.reviews.rejected} rejected, ${tickets.reviews.notReached} not reached.`,
    ...tickets.byDivision.length === 0 ? [] : ['', ...table(['Division', 'Lines', 'Shipped', 'Rejected', 'Halted'], tickets.byDivision.map(row => [row.division, row.lines, row.shipped, row.rejected, row.halted]))],
    '',
    `${tickets.shipped.length} distinct ${tickets.shipped.length === 1 ? 'ticket' : 'tickets'} shipped.`,
    ...tickets.shipped.length === 0 ? [] : ['', ...table(['Ticket', 'Division', 'Commit', 'Shipped at', 'Shift', 'Branch CI'], tickets.shipped.map(ticket => [
      ticket.ticket,
      ticket.division,
      `\`${ticket.commit.slice(0, 10)}\``,
      ticket.at,
      ticket.shift,
      verdictLabel(ticket.commit),
    ]))],
    '',
    '## Branch CI of the shipped commits',
    '',
    ...report.commits.length === 0 ? ['No commit shipped in the window.'] : table(['Commit', 'Tickets', 'Verdict', 'Which run'], report.commits.map(entry => [
      `\`${entry.commit.slice(0, 10)}\``,
      entry.tickets.join(', '),
      verdictLabel(entry.commit),
      describeCi(entry.commit, entry.ci),
    ])),
    '',
    '## Function runs',
    '',
    `${functions.lines} function ${functions.lines === 1 ? 'line' : 'lines'}.`,
    ...functions.byDivision.length === 0 ? [] : ['', ...table(['Division', 'Pass', 'Fail', 'Error'], functions.byDivision.map(row => [row.division, row.pass, row.fail, row.error]))],
    '',
    '## Tokens and seconds',
    '',
    'Each total covers only what its row names. The totals overlap (a ticket line\'s count includes sessions whose logs are also folded), so they are not summed.',
    '',
    ...table(['Covers', 'Source', 'Items', 'Tokens', 'Seconds'], effort.map(total => [
      total.covers,
      `\`${total.source}\``,
      total.items,
      total.tokens === null
        ? 'none recorded'
        : total.breakdown === undefined
          ? total.tokens
          : `${total.tokens} (input ${total.breakdown.input}, output ${total.breakdown.output}, cache read ${total.breakdown.cacheRead}, cache write ${total.breakdown.cacheWrite}, reasoning ${total.breakdown.reasoning})`,
      total.seconds ?? 'none recorded',
    ])),
    '',
    `## Seats at ${seats.at}`,
    '',
    `${seats.defined} defined, ${seats.occupied} occupied, ${seats.active} active in the 24 hours before ${seats.at}: ${seats.work.active.model} model-driven, ${seats.work.active.check} automated checks, ${seats.work.active.halted} halted before any model ran.`,
    '',
    ...table(
      ['Division', 'Defined', 'Occupied', 'Active', 'Model-driven', 'Automated checks', 'Halted before a model ran'],
      seats.byDivision.map(row => [row.name, row.defined, row.occupied, row.active, row.work.model, row.work.check, row.work.halted]),
    ),
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
    firstChange: (path, text) => {
      const pickaxe = text === undefined ? [] : [`-S${text}`]
      const first = git(['log', '--reverse', '--format=%cI', ...pickaxe, 'HEAD', '--', path]).split('\n').find(row => row !== '')
      return first === undefined ? undefined : new Date(first).toISOString()
    },
  }
}

/**
 * The recorded sessions the report folds: the committed records, every shift
 * record and every intake record.
 * @param root - repository root.
 * @returns the function the report calls with its window.
 */
export function recordedSessionsIn(root: string): (window: ReportWindow) => WindowSessions {
  return (window) => {
    const intake = existsSync(join(root, INTAKE_RECORDS))
      ? readdirSync(join(root, INTAKE_RECORDS)).sort().map(name => `${INTAKE_RECORDS}/${name}`)
      : []
    return sessionFiguresIn(root, [...observedRecords(root), ...intake], window)
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
    {
      root,
      repository: gitRepository(root),
      github: githubReader(),
      rosterAt: rosterGeneratorAt(root),
      sessions: recordedSessionsIn(root),
    },
    reportWindow(args, new Date()),
  )
  process.stdout.write(renderReport(report))
  if (args.write) for (const file of writeReport(root, report)) console.error(`enterprise-report: wrote ${file}`)
}
