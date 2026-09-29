/**
 * The enterprise ledger and the occupancy rule read from it.
 *
 * `data/enterprise/ledger.jsonl` holds one JSON object per line, appended and
 * never rewritten. Two line types share it: a **ticket line**, which the engine
 * (`pnpm run enterprise -- shift`) appends when a Harness Core ticket has been
 * worked, reviewed and integrated or halted, and a **function line**, which
 * `scripts/enterprise-functions.ts` appends when a Verification, Judging,
 * Observatory or Curation seat performed its function on a commit. A line
 * without `type` is read as a ticket line.
 *
 * The ledger is a durable file, one of this repository's validation
 * boundaries: {@link readLedger} keeps every line that carries the fields a
 * reader relies on and reports the rest by line number, and never throws on a
 * torn or foreign line.
 *
 * **Append-only.** A commit may only add lines at the end, and every commit a
 * line names ({@link commitReferences}) must be an ancestor of the commit that
 * added it; `scripts/verify-enterprise-ledger.ts` checks both over a commit
 * range. A line written after the fact, for a run whose own writer never
 * recorded it, carries {@link RecordedAfter} fields.
 *
 * **Occupancy.** A seat is occupied only by a recorded deliverable: a ticket
 * line or a function line naming the seat's id exactly, or a recorded session
 * `scripts/roster-evidence.ts` attributes to it. A seat is active when its
 * newest deliverable is dated inside the {@link ACTIVE_WINDOW_MS} window that
 * ends at the moment the occupancy is computed. A route, a definition, a
 * skill, an edge, or a mention in a task is not a deliverable and counts for
 * nothing; {@link occupancyOf} is the one implementation of that rule, used by
 * the roster generator, the functions runner and the deck's published data.
 *
 * **Work.** {@link workOf} classifies each deliverable as model work, an
 * automated check, or a ticket halted before any model ran, and
 * {@link seatWork} gives a seat the strongest kind among its deliverables, so
 * every published seat count splits by what the seats actually did.
 *
 * @module enterprise-ledger
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** The ledger file, relative to the repository root. */
export const LEDGER_PATH = 'data/enterprise/ledger.jsonl'

/** How long a deliverable keeps its seat active: the enterprise's 24-hour day. */
export const ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000

/** One acceptance check the engine ran for a ticket. */
interface TicketCheck {
  id: string
  ok: boolean
}

/** The reviewer a ticket line names: its session, the route and model it ran on, and its verdict. */
export interface TicketReviewer {
  sessionId: string
  /** The provider route, such as `claude-code`. */
  route: string
  /** The model id on that route, such as `sonnet`. */
  model: string
  verdict: string
}

/**
 * The two fields of a line written after the fact, present together or not at
 * all. On such a line `at` is when the recorded event happened, or the
 * earliest moment the evidence establishes it, and `recordedAt`, never earlier
 * than `at`, is when the line was written.
 */
export interface RecordedAfter {
  /**
   * Who wrote the line, from a closed set. `supervisor`: the session that
   * operates the enterprise, recording a run whose writer was destroyed or
   * crashed before it wrote its own line, from evidence on the branch.
   */
  recordedBy?: 'supervisor'
  recordedAt?: string
}

/** A ticket line: one worked ticket, as the engine records it. */
export interface TicketLine extends RecordedAfter {
  type: 'ticket'
  /** ISO time the line was recorded. */
  at: string
  shift: string
  /** The ticket id, `T-0001` onwards. */
  ticket: string
  /** The roster seat that owns the ticket. */
  seat: string
  division: string
  programId?: string
  implementer?: string
  model?: string
  /** How the implementing department ended, and its session. */
  department?: { outcome: string; sessionId?: string }
  checks: TicketCheck[]
  /** The independent review's verdict, and its session. */
  review?: { verdict: string; sessionId?: string }
  /** The reviewer that decided the ticket; lines written before the engine recorded it lack it. */
  reviewer?: TicketReviewer
  integration?: { outcome: string }
  /** The commit the ticket shipped as, or `null` when nothing merged. */
  shipped: { commit: string } | null
  reason?: string
  tokens?: number
  seconds?: number
}

/** How a function line's function ended: the gate or verdict itself, or a failure to obtain one. */
export type FunctionOutcome = 'pass' | 'fail' | 'error'

/** Where a function line's evidence is: a repository path it wrote, or a URL it read the verdict from. */
type FunctionEvidence = { path: string } | { url: string }

/** A function line: one seat performing its function on one commit. */
export interface FunctionLine extends RecordedAfter {
  type: 'function'
  /** ISO time of the deliverable: when the gate ran, or when the CI verdict was rendered. */
  at: string
  shift: string
  seat: string
  division: string
  /** What the seat did, such as `verify-md-links` or `ci-static`. */
  function: string
  /**
   * The commit the function covered. `via` names the later head the evidence
   * was read from when the commit's own CI run rendered no verdict and that
   * head's history contains the commit; `requested` names the commit asked for
   * when the evidence covers another commit, which the verdict does not cover.
   */
  target: { commit: string; requested?: string; via?: string }
  outcome: FunctionOutcome
  evidence: FunctionEvidence
  seconds: number
}

/** One line of the ledger. */
export type LedgerLine = TicketLine | FunctionLine

/** A line {@link readLedger} could not read as either line type. */
interface SkippedLedgerLine {
  /** One-based line number in the file. */
  line: number
  reason: string
}

/** What {@link readLedger} found. */
export interface LedgerRead {
  lines: LedgerLine[]
  skipped: SkippedLedgerLine[]
}

const FUNCTION_OUTCOMES: ReadonlySet<string> = new Set<FunctionOutcome>(['pass', 'fail', 'error'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * Normalise a recorded time to a canonical ISO string.
 * @param value - the recorded value.
 * @returns the ISO time, or `undefined` when the value is not a parseable time.
 */
function isoTime(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined
}

const RECORDERS: ReadonlySet<string> = new Set<NonNullable<RecordedAfter['recordedBy']>>(['supervisor'])

/**
 * The after-the-fact fields of a line, both or neither.
 * @param raw - the decoded line.
 * @param at - the line's normalised `at`.
 * @returns the fields (empty for a line recorded by its own writer), or the reason they are invalid.
 */
function recordedAfter(raw: Record<string, unknown>, at: string): RecordedAfter | string {
  if (raw.recordedBy === undefined && raw.recordedAt === undefined) return {}
  const recordedBy = optionalString(raw.recordedBy)
  if (recordedBy === undefined || !RECORDERS.has(recordedBy)) return `"recordedBy" is not one of ${[...RECORDERS].join(', ')}`
  const recordedAt = isoTime(raw.recordedAt)
  if (recordedAt === undefined) return 'no parseable "recordedAt" beside "recordedBy"'
  if (Date.parse(recordedAt) < Date.parse(at)) return '"recordedAt" precedes "at"'
  return { recordedBy: recordedBy as NonNullable<RecordedAfter['recordedBy']>, recordedAt }
}

/** The fields both line types share. */
type CommonFields = { at: string; shift: string; seat: string; division: string } & RecordedAfter

/**
 * The common fields both line types require, and the after-the-fact pair both allow.
 * @returns the fields, or the reason the line lacks one.
 */
function commonFields(raw: Record<string, unknown>): CommonFields | string {
  const at = isoTime(raw.at)
  if (at === undefined) return 'no parseable "at"'
  const seat = optionalString(raw.seat)
  if (seat === undefined || seat === '') return 'no "seat"'
  const division = optionalString(raw.division)
  if (division === undefined || division === '') return 'no "division"'
  const recorded = recordedAfter(raw, at)
  if (typeof recorded === 'string') return recorded
  return { at, shift: optionalString(raw.shift) ?? '', seat, division, ...recorded }
}

function parseChecks(value: unknown): TicketCheck[] {
  if (!Array.isArray(value)) return []
  const checks: TicketCheck[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const id = optionalString(entry.id)
    if (id !== undefined && typeof entry.ok === 'boolean') checks.push({ id, ok: entry.ok })
  }
  return checks
}

function parseOutcomeRecord(value: unknown, key: 'outcome' | 'verdict'): { outcome: string; sessionId?: string } | undefined {
  if (!isRecord(value)) return undefined
  const outcome = optionalString(value[key])
  if (outcome === undefined) return undefined
  const sessionId = optionalString(value.sessionId)
  return sessionId === undefined ? { outcome } : { outcome, sessionId }
}

/**
 * Read a ticket line's `reviewer`.
 * @returns the reviewer, or `undefined` when the line carries none or one missing a field.
 */
function parseReviewer(value: unknown): TicketReviewer | undefined {
  if (!isRecord(value)) return undefined
  const [sessionId, route, model, verdict] = [value.sessionId, value.route, value.model, value.verdict].map(optionalString)
  if (sessionId === undefined || route === undefined || model === undefined || verdict === undefined) return undefined
  return { sessionId, route, model, verdict }
}

function parseTicketLine(raw: Record<string, unknown>): TicketLine | string {
  const common = commonFields(raw)
  if (typeof common === 'string') return common
  const ticket = optionalString(raw.ticket)
  if (ticket === undefined || ticket === '') return 'no "ticket"'
  const shipped = isRecord(raw.shipped) && typeof raw.shipped.commit === 'string' ? { commit: raw.shipped.commit } : null
  const department = parseOutcomeRecord(raw.department, 'outcome')
  const review = parseOutcomeRecord(raw.review, 'verdict')
  const integration = parseOutcomeRecord(raw.integration, 'outcome')
  const line: TicketLine = { type: 'ticket', ...common, ticket, checks: parseChecks(raw.checks), shipped }
  const programId = optionalString(raw.programId)
  if (programId !== undefined) line.programId = programId
  const implementer = optionalString(raw.implementer)
  if (implementer !== undefined) line.implementer = implementer
  const model = optionalString(raw.model)
  if (model !== undefined) line.model = model
  if (department !== undefined) line.department = department
  if (review !== undefined) {
    line.review = review.sessionId === undefined ? { verdict: review.outcome } : { verdict: review.outcome, sessionId: review.sessionId }
  }
  const reviewer = parseReviewer(raw.reviewer)
  if (reviewer !== undefined) line.reviewer = reviewer
  if (integration !== undefined) line.integration = { outcome: integration.outcome }
  const reason = optionalString(raw.reason)
  if (reason !== undefined) line.reason = reason
  const tokens = optionalNumber(raw.tokens)
  if (tokens !== undefined) line.tokens = tokens
  const seconds = optionalNumber(raw.seconds)
  if (seconds !== undefined) line.seconds = seconds
  return line
}

function parseFunctionLine(raw: Record<string, unknown>): FunctionLine | string {
  const common = commonFields(raw)
  if (typeof common === 'string') return common
  const fn = optionalString(raw.function)
  if (fn === undefined || fn === '') return 'no "function"'
  const commit = isRecord(raw.target) ? optionalString(raw.target.commit) : undefined
  if (commit === undefined) return 'no "target.commit"'
  const outcome = optionalString(raw.outcome)
  if (outcome === undefined || !FUNCTION_OUTCOMES.has(outcome)) return 'no "outcome" of pass, fail or error'
  const evidence = isRecord(raw.evidence)
    ? typeof raw.evidence.path === 'string'
      ? { path: raw.evidence.path }
      : typeof raw.evidence.url === 'string' ? { url: raw.evidence.url } : undefined
    : undefined
  if (evidence === undefined) return 'no "evidence.path" or "evidence.url"'
  const requested = isRecord(raw.target) ? optionalString(raw.target.requested) : undefined
  const via = isRecord(raw.target) ? optionalString(raw.target.via) : undefined
  return {
    type: 'function',
    ...common,
    function: fn,
    target: { commit, ...requested === undefined ? {} : { requested }, ...via === undefined ? {} : { via } },
    outcome: outcome as FunctionOutcome,
    evidence,
    seconds: optionalNumber(raw.seconds) ?? 0,
  }
}

/**
 * Read one decoded ledger object as a line of either type.
 * @param raw - the decoded JSON value.
 * @returns the line, or the reason it is neither line type.
 */
export function parseLedgerLine(raw: unknown): LedgerLine | string {
  if (!isRecord(raw)) return 'not a JSON object'
  if (raw.type === 'function') return parseFunctionLine(raw)
  if (raw.type === undefined || raw.type === 'ticket') return parseTicketLine(raw)
  return `unknown line type ${JSON.stringify(raw.type)}`
}

/** One commit a ledger line names, and the field that names it. */
export interface CommitReference {
  field: 'shipped.commit' | 'target.commit' | 'target.requested' | 'target.via'
  commit: string
}

/**
 * Every commit a line names: a ticket line's shipped commit, a function line's
 * covered commit and the commits its evidence was requested for or read
 * through. The append-only gate requires each to exist and be an ancestor of
 * the commit that added the line.
 * @param line - one parsed line.
 * @returns the references, in field order.
 */
export function commitReferences(line: LedgerLine): CommitReference[] {
  if (line.type === 'ticket') return line.shipped === null ? [] : [{ field: 'shipped.commit', commit: line.shipped.commit }]
  const references: CommitReference[] = [{ field: 'target.commit', commit: line.target.commit }]
  if (line.target.requested !== undefined) references.push({ field: 'target.requested', commit: line.target.requested })
  if (line.target.via !== undefined) references.push({ field: 'target.via', commit: line.target.via })
  return references
}

/**
 * Read the ledger file.
 * @param file - absolute path of the ledger; a missing file is an empty ledger.
 * @returns every readable line in file order, and the lines skipped with the reason.
 */
export function readLedger(file: string): LedgerRead {
  const read: LedgerRead = { lines: [], skipped: [] }
  if (!existsSync(file)) return read
  const rows = readFileSync(file, 'utf8').split('\n')
  for (const [index, row] of rows.entries()) {
    const trimmed = row.trim()
    if (trimmed.length === 0) continue
    let decoded: unknown
    try {
      decoded = JSON.parse(trimmed)
    } catch {
      // A torn or hand-edited row; the rest of the ledger still counts.
      read.skipped.push({ line: index + 1, reason: 'not JSON' })
      continue
    }
    const parsed = parseLedgerLine(decoded)
    if (typeof parsed === 'string') read.skipped.push({ line: index + 1, reason: parsed })
    else read.lines.push(parsed)
  }
  return read
}

/**
 * Append lines to the ledger, creating the file and its directory when absent.
 * @param file - absolute path of the ledger.
 * @param lines - the lines to append, in order.
 */
export function appendLedger(file: string, lines: readonly LedgerLine[]): void {
  if (lines.length === 0) return
  mkdirSync(dirname(file), { recursive: true })
  appendFileSync(file, lines.map(line => `${JSON.stringify(line)}\n`).join(''))
}

/** The status a ticket line gives its ticket; a ticket with no line is queued. */
export type TicketStatus = 'shipped' | 'rejected' | 'halted'

/**
 * Read a ticket line's status the way the engine closes tickets: `shipped` when
 * a commit on the branch carries the change, `rejected` when the independent
 * review's verdict is `reject`, and `halted` otherwise (a department that failed
 * its acceptance, a change the integration could not assemble, a shift the usage
 * limit stopped), which leaves the ticket open for a later shift.
 * @param line - the ticket line.
 * @returns the status.
 */
export function ticketStatus(line: TicketLine): TicketStatus {
  if (line.shipped !== null) return 'shipped'
  if (line.review !== undefined && line.review.verdict.trim().toLowerCase() === 'reject') return 'rejected'
  return 'halted'
}

/** What the ledger records for one seat, counted exactly by seat id. */
export interface SeatLedgerEvidence {
  /** Ticket and function lines naming the seat. */
  lines: number
  /** ISO time of the newest of those lines; absent for a seat with none. */
  lastAt?: string
}

/**
 * Count the ledger per seat id.
 * @param lines - the ledger lines.
 * @returns evidence for every seat id at least one line names.
 */
export function ledgerBySeat(lines: readonly LedgerLine[]): Map<string, SeatLedgerEvidence> {
  const bySeat = new Map<string, SeatLedgerEvidence>()
  for (const line of lines) {
    const current = bySeat.get(line.seat) ?? { lines: 0 }
    current.lines += 1
    if (current.lastAt === undefined || Date.parse(line.at) > Date.parse(current.lastAt)) current.lastAt = line.at
    bySeat.set(line.seat, current)
  }
  return bySeat
}

/** The interval a seat's newest deliverable must fall in to make it active; both ends inclusive. */
export interface ActiveWindow {
  since: string
  until: string
}

/**
 * @param until - ISO time the occupancy is computed at.
 * @returns the {@link ACTIVE_WINDOW_MS} window ending at `until`.
 */
export function activeWindow(until: string): ActiveWindow {
  const untilMs = Date.parse(until)
  return { since: new Date(untilMs - ACTIVE_WINDOW_MS).toISOString(), until: new Date(untilMs).toISOString() }
}

/** The fields of a seat the occupancy rule reads; a roster agent definition satisfies it. */
export interface OccupancySeat {
  id: string
  division: string
  /** Session evidence: ISO time of the newest line any attributed session logged. */
  lastSeen?: string
  /** Sessions attributed to the seat. */
  sessions: number
}

/** One seat's occupancy. */
export interface SeatOccupancy {
  /** At least one deliverable: an attributed session or a ledger line. */
  occupied: boolean
  /** The newest deliverable is inside the window. */
  active: boolean
  /** ISO time of the newest deliverable; absent for a seat with none. */
  lastDeliverable?: string
}

/**
 * Apply the occupancy rule to one seat.
 * @param seat - the seat's id, division and session evidence.
 * @param ledger - the seat's ledger evidence, or `undefined` when no line names it.
 * @param window - the active window.
 * @returns whether the seat is occupied and active, and by what date.
 */
export function occupancyOf(seat: OccupancySeat, ledger: SeatLedgerEvidence | undefined, window: ActiveWindow): SeatOccupancy {
  const candidates = [seat.lastSeen, ledger?.lastAt].filter((at): at is string => at !== undefined)
  const lastDeliverable = candidates.length === 0
    ? undefined
    : candidates.reduce((newest, at) => (Date.parse(at) > Date.parse(newest) ? at : newest))
  const occupied = seat.sessions > 0 || (ledger !== undefined && ledger.lines > 0)
  const lastMs = lastDeliverable === undefined ? undefined : Date.parse(lastDeliverable)
  const active = occupied && lastMs !== undefined && lastMs >= Date.parse(window.since) && lastMs <= Date.parse(window.until)
  return { occupied, active, ...lastDeliverable === undefined ? {} : { lastDeliverable } }
}

/**
 * What one deliverable was. `model`: a model did the work — an attributed
 * recorded session, a ticket line whose department or review ran a session,
 * that shipped, or that records model tokens, or a function line of a division
 * outside {@link CHECK_DIVISIONS} (the code-safety review and the intake run
 * model programs). `check`: a script or a read did it — a function line of
 * {@link CHECK_DIVISIONS}. `halted`: any other ticket line, a shift that
 * stopped before any model ran, such as one that could not prepare its worktrees.
 */
export type WorkKind = 'model' | 'check' | 'halted'

/**
 * The divisions whose function lines are automated checks: for each,
 * `scripts/enterprise-functions.ts` runs a `verify-*` package script, reads a
 * Branch CI verdict from GitHub, or folds recorded sessions, and calls no model.
 */
const CHECK_DIVISIONS: ReadonlySet<string> = new Set(['verification', 'judging', 'observatory', 'curation-data'])

/** Every kind, strongest first: a seat's work is the strongest kind among its deliverables. */
const WORK_KINDS: readonly WorkKind[] = ['model', 'check', 'halted']

/**
 * @param line - one ledger line.
 * @returns what the line's deliverable was.
 */
export function workOf(line: LedgerLine): WorkKind {
  if (line.type === 'ticket') {
    const ranSession = line.department?.sessionId !== undefined || line.review?.sessionId !== undefined
    return ranSession || line.shipped !== null || (line.tokens ?? 0) > 0 ? 'model' : 'halted'
  }
  return CHECK_DIVISIONS.has(line.division) ? 'check' : 'model'
}

/** The kind of one occupied seat's work. */
export interface SeatWork {
  /** The strongest kind among all its deliverables. */
  occupied: WorkKind
  /** The strongest kind among its deliverables inside the active window; absent when none is inside. */
  active?: WorkKind
}

/**
 * Classify one seat's work by its deliverables: its attributed sessions (model
 * work, dated by `lastSeen`) and the ledger lines naming its id.
 * @param seat - the seat's id and session evidence.
 * @param lines - ledger lines; lines naming another seat are ignored.
 * @param window - the active window.
 * @returns the seat's work, or `undefined` for a seat no deliverable occupies.
 */
export function seatWork(seat: OccupancySeat, lines: readonly LedgerLine[], window: ActiveWindow): SeatWork | undefined {
  const since = Date.parse(window.since)
  const until = Date.parse(window.until)
  const inside = (at: string): boolean => Date.parse(at) >= since && Date.parse(at) <= until
  const all = new Set<WorkKind>()
  const active = new Set<WorkKind>()
  if (seat.sessions > 0) {
    all.add('model')
    if (seat.lastSeen !== undefined && inside(seat.lastSeen)) active.add('model')
  }
  for (const line of lines) {
    if (line.seat !== seat.id) continue
    const kind = workOf(line)
    all.add(kind)
    if (inside(line.at)) active.add(kind)
  }
  const occupied = WORK_KINDS.find(kind => all.has(kind))
  if (occupied === undefined) return undefined
  const activeKind = WORK_KINDS.find(kind => active.has(kind))
  return activeKind === undefined ? { occupied } : { occupied, active: activeKind }
}

/** Seats per kind of work. */
export type WorkCounts = Record<WorkKind, number>

/**
 * @param kinds - one kind per seat counted; `undefined` for a seat that is not.
 * @returns the seats per kind, every kind present.
 */
export function countWork(kinds: readonly (WorkKind | undefined)[]): WorkCounts {
  const counts: WorkCounts = { model: 0, check: 0, halted: 0 }
  for (const kind of kinds) if (kind !== undefined) counts[kind] += 1
  return counts
}

/** Seats defined, occupied and active in one division. */
export interface DivisionOccupancy {
  id: string
  defined: number
  occupied: number
  active: number
}

/**
 * Tally occupancy per division, in the order divisions are given.
 * @param divisions - the division ids, in presentation order.
 * @param seats - every seat with its occupancy.
 * @returns one tally per division.
 */
export function occupancyByDivision(
  divisions: readonly string[],
  seats: readonly { division: string; occupancy: SeatOccupancy }[],
): DivisionOccupancy[] {
  return divisions.map((id) => {
    const members = seats.filter(seat => seat.division === id)
    return {
      id,
      defined: members.length,
      occupied: members.filter(seat => seat.occupancy.occupied).length,
      active: members.filter(seat => seat.occupancy.active).length,
    }
  })
}
