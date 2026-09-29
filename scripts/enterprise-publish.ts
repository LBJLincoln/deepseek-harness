/**
 * Regenerates the Command Deck's static enterprise data from the generated
 * roster and the ledger (`pnpm run enterprise:publish`): the roster fixture the
 * deck's Enterprise view draws; `enterprise.json`, the view's lead and ledger
 * tab — what the enterprise delivered inside the window (tickets shipped,
 * model-driven runs, automated checks by outcome), seats occupied and active
 * per division split by what they did, the tickets of the enterprise's
 * current day by status, the function runs of that day, and the latest shipped
 * commits with the CI verdicts the judges recorded on them; and
 * `enterprise-day.json`, the view's 24 hours tab — the report
 * `scripts/enterprise-report.ts` builds over the roster's window. The first
 * two files are a pure function of `data/enterprise/roster.json`,
 * `data/enterprise/ledger.jsonl` and the ticket queue; the third adds the
 * cycle records, HEAD's git history and GitHub's Branch CI answers. A second
 * run over the same inputs writes the same bytes, and `deck-pages.yml`
 * republishes the Pages site when they change on the deck's branch.
 *
 * @module enterprise-publish
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { githubReader, type GitHubReader } from './enterprise-functions.ts'
import {
  LEDGER_PATH,
  readLedger,
  ticketStatus,
  workOf,
  type ActiveWindow,
  type DivisionOccupancy,
  type FunctionLine,
  type FunctionOutcome,
  type LedgerRead,
  type TicketLine,
  type TicketStatus,
  type WorkCounts,
} from './enterprise-ledger.ts'
import {
  enterpriseReport,
  gitRepository,
  recordedSessionsIn,
  type EnterpriseWindowReport,
  type ReportRepository,
  type ReportSources,
} from './enterprise-report.ts'
import { divisionSeats, ROSTER_PATH, workSummary, type Roster } from './enterprise-roster.ts'
import { loadTickets, type LoadedTicket } from './enterprise-tickets.ts'

/** The deck's fixture directory, relative to the repository root. */
export const DECK_FIXTURES = 'apps/command-deck/public/fixtures'

/** The roster fixture: a byte copy of the generated roster. */
export const ROSTER_FIXTURE = `${DECK_FIXTURES}/roster.json`

/** The enterprise fixture the deck's ledger tab reads. */
export const ENTERPRISE_FIXTURE = `${DECK_FIXTURES}/enterprise.json`

/** The fixture the deck's 24 hours tab reads: the enterprise report over the roster's window. */
export const DAY_FIXTURE = `${DECK_FIXTURES}/enterprise-day.json`

/** What {@link publishDeckData} reads beyond the checkout's files: the git history, Branch CI and the recorded sessions. */
export interface PublishSources {
  repository: ReportRepository
  github: GitHubReader
  sessions: ReportSources['sessions']
}

/** How many shipped commits the report lists, newest first. */
export const SHIPPED_LIMIT = 10

/** One ticket as the report lists it. */
export interface TicketSummary {
  ticket: string
  seat: string
  division: string
  /** `queued` for a ticket the ledger has no line for; else the status of its newest line. */
  status: 'queued' | TicketStatus
  /** The queue file's title, for a queued ticket. */
  title?: string
  /** The newest line's time, for a worked ticket. */
  at?: string
  shift?: string
  commit?: string
  reason?: string
}

/** One CI verdict a judge recorded on a commit. */
export interface CommitVerdict {
  seat: string
  /** The lane or gate group, such as `ci-static`. */
  function: string
  outcome: FunctionOutcome
  url: string
  at: string
}

/** One shipped commit with the tickets it shipped and the verdicts recorded on it. */
export interface ShippedCommit {
  commit: string
  /** The newest ticket line that shipped it. */
  at: string
  tickets: string[]
  seats: string[]
  verdicts: CommitVerdict[]
}

/** Runs of one model-driven function inside the window, such as the code-safety `review` or the `intake`. */
export interface ProgramOutcome {
  function: string
  runs: number
  pass: number
}

/**
 * What the enterprise delivered inside the window, read from the ledger's
 * lines dated inside it: the figures the deck's Enterprise view leads with,
 * before any seat count.
 */
export interface EnterpriseOutcomes {
  /** Tickets with a line inside the window that shipped a commit. */
  shipped: number
  /** Tickets worked by a model inside the window that shipped no commit there: halted, blocked or rejected. */
  notShipped: number
  /** Tickets whose every line inside the window halted before any model ran, such as a shift that could not prepare its worktrees. */
  haltedBeforeModel: number
  /** Model-driven function lines inside the window, per function, in order of first appearance, newest first. */
  programs: ProgramOutcome[]
  /** Automated checks inside the window: function lines of the check divisions, by outcome. */
  checks: { runs: number } & Record<FunctionOutcome, number>
}

/** `enterprise.json`: what the deck's ledger tab shows. */
export interface EnterpriseReport {
  /** The newer of the roster's stamp and the last ledger line: the moment the report describes. */
  asOf: string
  /** The roster's active window: the enterprise's current day. */
  window: ActiveWindow
  counts: Roster['counts']
  /** What the enterprise delivered inside the window. */
  outcomes: EnterpriseOutcomes
  /** Each division's seats, with its active seats split by what their deliverables inside the window were. */
  divisions: (DivisionOccupancy & { name: string; work: WorkCounts })[]
  /** Tickets by status: queued ones from the queue, the rest from their newest line inside the window. */
  tickets: Record<'queued' | TicketStatus, TicketSummary[]>
  /** Function lines inside the window, newest first. */
  functions: FunctionLine[]
  /** The latest shipped commits, newest first, with their CI verdicts. */
  shipped: ShippedCommit[]
  /** What the ledger held: lines read by type, and lines no reader could use. */
  ledger: { lines: number; tickets: number; functions: number; skipped: number }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function ms(at: string): number {
  return Date.parse(at)
}

function newestFirst<T extends { at: string }>(lines: readonly T[]): T[] {
  return [...lines].sort((left, right) => ms(right.at) - ms(left.at))
}

function inWindow(at: string, window: ActiveWindow): boolean {
  const value = ms(at)
  return value >= ms(window.since) && value <= ms(window.until)
}

/**
 * Whether one commit names the other: the ledger may carry a full sha where a ticket line carries a short one.
 * @param left - one commit.
 * @param right - the other.
 * @returns whether one is a prefix of the other.
 */
function sameCommit(left: string, right: string): boolean {
  return left.length >= 7 && right.length >= 7 && (left.startsWith(right) || right.startsWith(left))
}

function summarize(line: TicketLine): TicketSummary {
  const summary: TicketSummary = {
    ticket: line.ticket,
    seat: line.seat,
    division: line.division,
    status: ticketStatus(line),
    at: line.at,
    shift: line.shift,
  }
  if (line.shipped !== null) summary.commit = line.shipped.commit
  if (line.reason !== undefined) summary.reason = line.reason
  return summary
}

/**
 * The queued tickets: every readable queue file whose ticket the ledger has no line for.
 * @param tickets - the queue as `loadTickets` read it.
 * @param worked - the ticket ids with at least one line.
 * @returns the summaries, in queue order.
 */
function queued(tickets: readonly LoadedTicket[], worked: ReadonlySet<string>): TicketSummary[] {
  const summaries: TicketSummary[] = []
  for (const { value } of tickets) {
    if (!isRecord(value)) continue
    const { id, seat, division, title } = value
    if (typeof id !== 'string' || typeof seat !== 'string' || typeof division !== 'string' || worked.has(id)) continue
    summaries.push({ ticket: id, seat, division, status: 'queued', ...typeof title === 'string' ? { title } : {} })
  }
  return summaries
}

/**
 * Tally what the enterprise delivered from the lines dated inside the window.
 * A ticket counts as shipped when any of its lines inside the window shipped a
 * commit, even if a later line worked it again; a ticket that did not ship
 * counts as not shipped when a model worked it in the window, and as halted
 * before any model ran otherwise.
 * @param tickets - the ticket lines inside the window.
 * @param functions - the function lines inside the window.
 * @returns the outcomes.
 */
function outcomesOf(tickets: readonly TicketLine[], functions: readonly FunctionLine[]): EnterpriseOutcomes {
  const programs = new Map<string, ProgramOutcome>()
  const checks: EnterpriseOutcomes['checks'] = { runs: 0, pass: 0, fail: 0, error: 0 }
  for (const line of newestFirst(functions)) {
    if (workOf(line) === 'check') {
      checks.runs += 1
      checks[line.outcome] += 1
      continue
    }
    const entry = programs.get(line.function) ?? { function: line.function, runs: 0, pass: 0 }
    entry.runs += 1
    if (line.outcome === 'pass') entry.pass += 1
    programs.set(line.function, entry)
  }
  const shipped = new Set(tickets.filter(line => line.shipped !== null).map(line => line.ticket))
  const worked = new Set(tickets.filter(line => !shipped.has(line.ticket) && workOf(line) === 'model').map(line => line.ticket))
  const halted = new Set(tickets.filter(line => !shipped.has(line.ticket) && !worked.has(line.ticket)).map(line => line.ticket))
  return { shipped: shipped.size, notShipped: worked.size, haltedBeforeModel: halted.size, programs: [...programs.values()], checks }
}

/**
 * Build the report.
 * @param roster - the generated roster.
 * @param ledger - the ledger as `readLedger` read it.
 * @param tickets - the ticket queue as `loadTickets` read it.
 * @returns the report.
 */
export function buildEnterpriseReport(roster: Roster, ledger: LedgerRead, tickets: readonly LoadedTicket[]): EnterpriseReport {
  const window = roster.activeWindow
  const ticketLines = ledger.lines.filter((line): line is TicketLine => line.type === 'ticket')
  const functionLines = ledger.lines.filter((line): line is FunctionLine => line.type === 'function')
  const lastAt = ledger.lines.reduce<string | undefined>(
    (newest, line) => (newest === undefined || ms(line.at) > ms(newest) ? line.at : newest),
    undefined,
  )
  const asOf = lastAt !== undefined && ms(lastAt) > ms(roster.generatedAt) ? lastAt : roster.generatedAt

  const newestByTicket = new Map<string, TicketLine>()
  for (const line of newestFirst(ticketLines)) if (!newestByTicket.has(line.ticket)) newestByTicket.set(line.ticket, line)
  const byStatus: EnterpriseReport['tickets'] = { queued: queued(tickets, new Set(newestByTicket.keys())), shipped: [], rejected: [], halted: [] }
  for (const line of newestByTicket.values()) {
    if (!inWindow(line.at, window)) continue
    const summary = summarize(line)
    if (summary.status !== 'queued') byStatus[summary.status].push(summary)
  }

  const verdicts = functionLines.filter((line): line is FunctionLine & { evidence: { url: string } } => 'url' in line.evidence)
  const shippedByCommit = new Map<string, ShippedCommit>()
  for (const line of newestFirst(ticketLines)) {
    if (line.shipped === null) continue
    const entry = shippedByCommit.get(line.shipped.commit)
      ?? { commit: line.shipped.commit, at: line.at, tickets: [], seats: [], verdicts: [] }
    if (!entry.tickets.includes(line.ticket)) entry.tickets.push(line.ticket)
    if (!entry.seats.includes(line.seat)) entry.seats.push(line.seat)
    shippedByCommit.set(line.shipped.commit, entry)
  }
  const shipped = [...shippedByCommit.values()].slice(0, SHIPPED_LIMIT).map(entry => ({
    ...entry,
    verdicts: newestFirst(verdicts.filter(line => sameCommit(line.target.commit, entry.commit)))
      .map(line => ({ seat: line.seat, function: line.function, outcome: line.outcome, url: line.evidence.url, at: line.at })),
  }))

  const divisions = divisionSeats(roster)

  return {
    asOf,
    window,
    counts: roster.counts,
    outcomes: outcomesOf(ticketLines.filter(line => inWindow(line.at, window)), functionLines.filter(line => inWindow(line.at, window))),
    divisions,
    tickets: byStatus,
    functions: newestFirst(functionLines.filter(line => inWindow(line.at, window))),
    shipped,
    ledger: { lines: ledger.lines.length, tickets: ticketLines.length, functions: functionLines.length, skipped: ledger.skipped.length },
  }
}

/**
 * Write a file only when its bytes change.
 * @param file - absolute path.
 * @param content - the bytes.
 * @returns whether the file changed.
 */
function writeIfChanged(file: string, content: string): boolean {
  if (existsSync(file) && readFileSync(file, 'utf8') === content) return false
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content)
  return true
}

/**
 * Regenerate the three deck fixtures under `root`. The 24 hours report covers
 * the roster's own window, so the roster is the generator's output at that
 * window's end and supplies its seats.
 * @param root - repository root.
 * @param sources - the git history and the Branch CI reader the 24 hours report reads.
 * @returns the ledger report and the 24 hours report written, and the fixtures whose bytes changed, repository-relative.
 * @throws when the generated roster is missing, because the deck must never show a roster the ledger was not counted into.
 */
export async function publishDeckData(
  root: string,
  sources: PublishSources,
): Promise<{ report: EnterpriseReport; day: EnterpriseWindowReport; changed: string[] }> {
  const rosterFile = join(root, ROSTER_PATH)
  if (!existsSync(rosterFile)) throw new Error(`enterprise-publish: ${ROSTER_PATH} is missing; run pnpm run roster first`)
  const rosterContent = readFileSync(rosterFile, 'utf8')
  const roster = JSON.parse(rosterContent) as Roster
  const ledger = readLedger(join(root, LEDGER_PATH))
  const report = buildEnterpriseReport(roster, ledger, loadTickets(root))
  const day = await enterpriseReport({ root, ...sources, rosterAt: () => roster }, roster.activeWindow)
  const changed: string[] = []
  if (writeIfChanged(join(root, ROSTER_FIXTURE), rosterContent)) changed.push(ROSTER_FIXTURE)
  if (writeIfChanged(join(root, ENTERPRISE_FIXTURE), `${JSON.stringify(report, null, 2)}\n`)) changed.push(ENTERPRISE_FIXTURE)
  if (writeIfChanged(join(root, DAY_FIXTURE), `${JSON.stringify(day, null, 2)}\n`)) changed.push(DAY_FIXTURE)
  return { report, day, changed }
}

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${resolve(process.argv[1])}`
if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const sources: PublishSources = { repository: gitRepository(root), github: githubReader(), sessions: recordedSessionsIn(root) }
  const { report, day, changed } = await publishDeckData(root, sources)
  const tickets = Object.entries(report.tickets).map(([status, list]) => `${list.length} ${status}`).join(', ')
  console.log([
    `enterprise-publish: ${changed.length === 0 ? 'kept' : `wrote ${changed.join(', ')}`};`,
    `as of ${report.asOf}: ${report.outcomes.shipped} tickets shipped, ${report.outcomes.checks.pass} of ${report.outcomes.checks.runs} automated checks passed in the window;`,
    `${report.counts.occupied} of ${report.counts.defined} seats occupied, ${report.counts.active} active since ${report.window.since} (${workSummary(report.counts.work.active)});`,
    `tickets ${tickets}; ${report.functions.length} function runs in the window; ${report.shipped.length} shipped commits listed;`,
    `24 hours: ${day.cycles.count} cycles, ${day.tickets.shipped.length} tickets shipped, ${day.unknowns.length} unknowns`,
  ].join(' '))
}
