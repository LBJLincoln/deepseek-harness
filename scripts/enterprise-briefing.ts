/**
 * Builds the data of the Command Deck's client briefing
 * (`pnpm run enterprise:briefing`): every figure the `/briefing` page shows,
 * each with the repository paths or URLs it was read from and the computation
 * that produced it, written to `apps/command-deck/public/fixtures/briefing.json`.
 *
 * The inputs are committed data — the roster, the ledger, the ticket queue, the
 * shift and intake records, the enterprise commits on the branch, the Proving
 * Ground records and folds, the code-safety records, ground truths and
 * comparison, and the session logs those records hold — plus the Branch CI runs
 * of the development branch read from GitHub's REST API. A figure whose input
 * is missing or unreadable is written as unknown with the reason, never
 * estimated; an unreadable API leaves every CI figure unknown and every other
 * figure unchanged. Over unchanged inputs and unchanged API answers the output
 * is byte-identical, and the file is rewritten only when its bytes change.
 *
 * It then renders the `/briefing` page from the new data, checks it, and writes its claims register beside the fixture
 * (see `enterprise-briefing-claims.ts`); a page that holds a forbidden phrase or a sentence stating a number with no
 * source note leaves the register unwritten and the command exiting 1.
 *
 * `--summary` also writes the one-page executive summary pair under
 * `docs/client/` from the same data (see `enterprise-briefing-summary.ts`);
 * `--check-summary` exits non-zero when the committed pair differs from that
 * rendering. Neither runs by default, so the enterprise cycle's publish step
 * writes nothing outside the deck's fixtures.
 *
 * @module enterprise-briefing
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

import { CYCLES_DIR, cycleStartedAt, readCycleRecords, type CycleRecord } from './enterprise-cycle-record.ts'
import { CI_REPOSITORY, CI_WORKFLOW, DEFAULT_CI_BRANCH, githubReader, parseJobLog, proxyHint, type GitHubReader } from './enterprise-functions.ts'
import { LEDGER_PATH, readLedger, ticketStandings, ticketStatus, type FunctionLine, type LedgerRead, type TicketLine, type TicketStanding } from './enterprise-ledger.ts'
import { DECK_FIXTURES } from './enterprise-publish.ts'
import { ROSTER_PATH, type Roster } from './enterprise-roster.ts'
import { loadTickets, TICKETS_DIR, type LoadedTicket } from './enterprise-tickets.ts'

/** The briefing fixture the deck's `/briefing` route reads, relative to the repository root. */
export const BRIEFING_FIXTURE = `${DECK_FIXTURES}/briefing.json`

/** The version of `briefing.json`'s fields; a reader refuses any other. */
export const BRIEFING_SCHEMA = 1

/** Where the shift records live, relative to the repository root. */
const SHIFTS_DIR = 'data/enterprise/shifts'
/** Where the intake records live, relative to the repository root. */
const INTAKE_DIR = 'data/enterprise/intake'
/** The Proving Ground records and folds. */
const PROVING_GROUND_DIR = 'data/proving-ground'
/** The bench's hand-authored environments, one directory with a `task.json` each. */
const BENCH_ENVIRONMENTS_DIR = 'examples/headless-agent/tests/fixtures/proving-ground-bench/environments'
/** The code-safety records, targets and comparisons. */
const CODE_SAFETY_DIR = 'data/code-safety'
/** The three-tier comparison the briefing reads. */
const COMPARISON_DIR = `${CODE_SAFETY_DIR}/comparisons/2026-09-22-nodegoat`
/** A finding lands on a known issue within this many lines of its range, the rule `compare.mjs` and `recall.mjs` apply. */
const RECALL_TOLERANCE = 3
/** Upper bound on Branch CI pages read (100 runs each). */
const CI_PAGE_LIMIT = 5
/** The live transcript capture's copies of the cycle logs and the scheduler's log. */
const CAPTURED_CYCLE_LOGS = 'data/transcripts/live/enterprise-cycles'
/** The start lines a shift pushes before any department runs; a shift a reset erased leaves only its line here. */
const SHIFT_STARTS_PATH = 'data/enterprise/shift-starts.jsonl'
/** The cycle script; a cycle id names one run of it. */
const CYCLE_SCRIPT = 'scripts/enterprise-cycle.sh'
/** The scheduler script; it can have started only the cycles that began after it reached the branch. */
const SCHEDULER_SCRIPT = 'scripts/enterprise-scheduler.sh'
/** The scheduler stamps a cycle's log at most this long before the cycle stamps its own id. */
const SCHEDULER_STAMP_SLACK_MS = 60_000

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------

/** Where a figure comes from. */
export interface Source {
  /** Repository paths read, relative to the root; a directory stands for the files under it that the computation names. */
  paths: string[]
  /** Pages read over the network, such as a GitHub Actions run. */
  urls?: string[]
  /** How the figure was computed from those inputs, in one sentence. */
  computation: string
}

/** A figure that was computed. */
export interface KnownFigure<T> {
  value: T
  source: Source
}

/** A figure that could not be computed, and why. */
export interface UnknownFigure {
  value: null
  unknown: string
  source: Source
}

/** One briefing figure: computed with its source, or unknown with the reason. */
export type Figure<T> = KnownFigure<T> | UnknownFigure

function known<T>(value: T, source: Source): KnownFigure<T> {
  return { value, source }
}

function unknownFigure(reason: string, source: Source): UnknownFigure {
  return { value: null, unknown: reason, source }
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** One commit of the enterprise on the branch: a cycle's or a shift's own commit. */
export interface EnterpriseCommit {
  sha: string
  /** Committer time, ISO. */
  at: string
  subject: string
}

/** Git as the briefing reads it. */
export interface GitReader {
  /**
   * @param ancestor - a commit.
   * @param descendant - another commit.
   * @returns whether `ancestor` is `descendant` or one of its ancestors; `false` when either is unknown here.
   */
  isAncestor: (ancestor: string, descendant: string) => boolean
}

/** One session log of a record, reduced to what the governance figures read. */
export interface SessionScan {
  /** Repository-relative path of the log. */
  file: string
  /** Whether the log carries a `dataUse/terms` event. */
  dataUseTerms: boolean
  /** Top-level `tool/call` events in the log. */
  toolCalls: number
  /** The log's `signoff/recorded` events, with the principal's id and the kind the event declares for it. */
  signoffs: { transition: string; principal: string; kind: string; time: number }[]
  /** The route and model the log's first model request was sent with, from its `request/header` event; absent when it made none. */
  request?: { route: string; model: string }
  /** For a review log (`review-*.jsonl`): the verdict line its last answer opens with; absent when it answered none. */
  verdict?: 'approve' | 'reject'
}

/** One later commit on the branch that names a shipped commit and changes a file in a directory the shipped commit changed. */
export interface FollowUpCommit {
  commit: string
  /** Committer time, ISO. */
  at: string
  subject: string
}

/** One shift record under `data/enterprise/shifts/`. */
export interface ShiftRecordInput {
  /** Repository-relative directory. */
  dir: string
  result: Record<string, unknown>
  manifest?: Record<string, unknown>
  sessions: SessionScan[]
}

/** One intake record under `data/enterprise/intake/`. */
export interface IntakeRecordInput {
  dir: string
  result: Record<string, unknown>
}

/** One log the live transcript capture holds, reassembled from its chunks in epoch and sequence order. */
export interface CapturedLog {
  /** The log's file name on the machine that wrote it, such as `scheduler.log`. */
  name: string
  /** The directory of its chunks, relative to the repository root. */
  dir: string
  text: string
}

/** One shift start line: the shift, when it started, and the tickets it selected. */
export interface ShiftStartInput {
  shift: string
  at: string
  tickets: string[]
}

/** When the cycle and scheduler scripts first reached the branch. */
export interface ScriptHistory {
  /** ISO committer time of the commit that added `scripts/enterprise-cycle.sh`; `null` when git cannot say. */
  cycle: string | null
  /** ISO committer time of the commit that added `scripts/enterprise-scheduler.sh`; `null` when git cannot say. */
  scheduler: string | null
}

/** One Proving Ground record's `result.json`, or one fold. */
export interface BenchResultInput {
  /** Repository-relative path of the file. */
  file: string
  value: Record<string, unknown>
}

/** One bench environment's `task.json` fields the briefing reads. */
export interface BenchEnvironmentInput {
  id: string
  tier: number
  domain: string
  heldOut: boolean
}

/** One finding as the recall rule reads it. */
export interface FindingInput {
  file: string
  line: number
}

/** One documented issue of a ground truth. */
export interface GroundTruthIssue {
  id: string
  category?: string
  file: string
  lines: [number, number]
  alsoAt?: { file: string; lines: [number, number] }[]
}

/** One code-safety record under `data/code-safety/`. */
export interface SafetyRecordInput {
  /** The record directory's name. */
  name: string
  manifest: Record<string, unknown>
  findings: FindingInput[]
  /** The record's seeded-recall reading, for a record of a seeded copy. */
  seeded?: Record<string, unknown>
}

/** Everything the briefing reads from the repository. */
export interface BriefingInputs {
  roster: Roster
  ledger: LedgerRead
  tickets: readonly LoadedTicket[]
  shifts: ShiftRecordInput[]
  intakes: IntakeRecordInput[]
  commits: EnterpriseCommit[]
  /** The cycle records under `data/enterprise/cycles/`. */
  cycleRecords: CycleRecord[]
  /** The shift start lines of `data/enterprise/shift-starts.jsonl`; empty when the file does not exist. */
  shiftStarts: ShiftStartInput[]
  /** The cycle logs and the scheduler's log the live transcript capture holds. */
  logs: CapturedLog[]
  scripts: ScriptHistory
  bench: {
    environments: BenchEnvironmentInput[]
    /** The `result.json` of every record directory under `data/proving-ground/`. */
    results: BenchResultInput[]
    folds: BenchResultInput[]
    /** Record directories under `data/proving-ground/` (those with a `manifest.json`). */
    records: number
  }
  safety: {
    records: SafetyRecordInput[]
    groundTruths: Record<string, { issues: GroundTruthIssue[]; revision?: string; target?: string }>
    comparison?: {
      value: Record<string, unknown>
      semgrep: FindingInput[]
      singleModel: FindingInput[]
      singleModelMeta: Record<string, unknown>
    }
  }
  /** Every session log of the committed records, by record family. */
  sessions: Record<SessionFamily, SessionScan[]>
  /** The input sets read, with their digests. */
  digests: InputDigest[]
  /** Per shipped commit the ledger names, the later commits that rework it (see {@link followUpCommits}); absent when git was not read. */
  followUps?: Record<string, FollowUpCommit[]>
}

/** The record families whose session logs the governance figures count. */
export type SessionFamily = 'bench' | 'codeSafety' | 'shifts' | 'intake'

/**
 * One input set the briefing read: a single file, or a directory standing for the files read under it. A directory's
 * `sha256` is the digest of the `sha256sum`-style listing (`<sha256>  <path>` per file, sorted by path) of those files.
 */
export interface InputDigest {
  path: string
  files: number
  bytes: number
  sha256: string
}

/** The input sets the digests group files under, longest prefix first. */
const INPUT_SETS = [
  ROSTER_PATH,
  LEDGER_PATH,
  TICKETS_DIR,
  'data/enterprise/shifts',
  'data/enterprise/intake',
  'data/enterprise/shift-starts.jsonl',
  CYCLES_DIR,
  CAPTURED_CYCLE_LOGS,
  BENCH_ENVIRONMENTS_DIR,
  'data/proving-ground/folds',
  'data/proving-ground',
  'data/code-safety/comparisons/2026-09-22-nodegoat',
  'data/code-safety/targets',
  'data/code-safety',
].sort((left, right) => right.length - left.length)

/** Collects the digest of every file read and groups them by input set. */
export class DigestBook {
  private readonly files = new Map<string, { sha256: string; bytes: number }>()

  /**
   * @param path - repository-relative path.
   * @param content - the bytes read.
   */
  add(path: string, content: Buffer | string): void {
    const bytes = typeof content === 'string' ? Buffer.from(content, 'utf8') : content
    this.files.set(path, { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length })
  }

  /** @returns one digest per input set that holds a file read, in path order. */
  summarize(): InputDigest[] {
    const groups = new Map<string, [string, { sha256: string; bytes: number }][]>()
    for (const [path, digest] of [...this.files.entries()].sort((left, right) => left[0].localeCompare(right[0]))) {
      const set = INPUT_SETS.find(prefix => path === prefix || path.startsWith(`${prefix}/`)) ?? path
      groups.set(set, [...groups.get(set) ?? [], [path, digest]])
    }
    return [...groups.entries()].sort((left, right) => left[0].localeCompare(right[0])).map(([path, entries]) => {
      const single = entries.length === 1 && entries[0]?.[0] === path ? entries[0][1] : undefined
      return {
        path,
        files: entries.length,
        bytes: entries.reduce((sum, [, digest]) => sum + digest.bytes, 0),
        sha256: single?.sha256 ?? createHash('sha256').update(entries.map(([file, digest]) => `${digest.sha256}  ${file}\n`).join('')).digest('hex'),
      }
    })
  }
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/** One division with its seats. */
export interface DivisionRow {
  id: string
  name: string
  purpose: string
  defined: number
  occupied: number
  active: number
}

/** A Branch CI job and the gates its log shows failing. */
export interface CiJob {
  name: string
  conclusion: string | null
  url: string
  /** The `run-gates` labels the job's log shows as failed; empty for a job that did not fail or whose log was not read. */
  failedGates: string[]
}

/** A Branch CI run of the development branch. */
export interface CiRun {
  id: number
  head: string
  status: string
  conclusion: string | null
  createdAt: string
  updatedAt: string
  url: string
}

/** A run with its jobs. */
export interface CiRunDetail extends CiRun {
  jobs: CiJob[]
}

/** The CI verdicts that bear on one shipped commit. */
export interface ShipmentCi {
  /** The newest completed run on exactly the shipped commit, else the newest run on it; `null` when no run tested it alone. */
  exact: CiRun | null
  /** The earliest run whose commit contains the shipped commit: the containing run of the push that carried it. */
  carrying: CiRunDetail | null
  /** The run on the shift's base commit, before the shift. */
  base: CiRunDetail | null
  /** The earliest successful run whose commit contains the shipped commit. */
  firstGreen: CiRun | null
  /** Gates failing on the carrying run that did not fail on the base run. */
  introduced: string[]
  /** Gates failing on the carrying run that already failed on the base run. */
  preExisting: string[]
}

/** One shipped ticket. */
export interface ShippedRow {
  ticket: string
  title: string | null
  seat: string
  seatName: string | null
  division: string
  shift: string
  at: string
  commit: string
  /** The shift's base commit, from its record. */
  base: string | null
  model: string | null
  checks: { passed: number; total: number; ids: string[] }
  review: string | null
  /** Tool calls in the review session's log; `null` when the record holds no such log. */
  reviewToolCalls: number | null
  tokens: number | null
  seconds: number | null
  ci: Figure<ShipmentCi>
}

/** One shift record. */
export interface ShiftRow {
  shift: string
  dir: string
  /** `result` for a shift the engine recorded, `partial` for one recorded after a crash. */
  type: string
  startedAt: string | null
  endedAt: string | null
  tickets: string[]
  shipped: string[]
  reason: string | null
  /** Credential-shaped strings the record cut. */
  redacted: number | null
  /** From the start to the end the record states: for a shift that pushed, from the clone to the push. */
  seconds: number | null
}

/** Who started a unit of the pilot's work. */
export type Starter = 'scheduler' | 'operator' | 'unknown'

/** One step of a cycle as its record or its captured log states it: the step's name, exit code and end. */
export interface PilotStep {
  name: string
  exit: number
  at: string
}

/** A ticket a unit worked that its ledger lines close as halted or rejected. */
export interface FailedTicket {
  ticket: string
  status: 'halted' | 'rejected'
  /** The ids of the acceptance and engine checks the line records as failed. */
  failedChecks: string[]
  reason: string | null
}

/** One unit of the pilot's work: a run of the cycle script, or a shift started outside every cycle. */
export interface PilotRow {
  /** The cycle id, or the id of a shift outside every cycle. */
  id: string
  kind: 'cycle' | 'shift'
  startedAt: string
  startedBy: Starter
  /** The evidence `startedBy` rests on, in one sentence. */
  basis: string
  /** The shift records on the branch that belong to it. */
  shifts: string[]
  /** Tickets its shift records name; `null` when it ran a shift that left no record on the branch, or its steps are unknown. */
  attempted: number | null
  /** Tickets its shifts' ledger lines ship. */
  shipped: string[]
  /**
   * Who wrote its shipping lines after the fact (`recordedBy`), such as the supervisor that completed a push the shift's
   * own push step could not make; empty when the shift wrote every shipping line itself.
   */
  completedBy: string[]
  failed: FailedTicket[]
  /** Tickets its shift records name that no ledger line of that shift records; `null` when `attempted` is. */
  lost: number | null
  /** Model tokens over its shifts' ticket lines; `null` when no line records them. */
  tokens: number | null
  /** Its steps, from its cycle record or its captured log; empty when neither holds them, and for a shift. */
  steps: PilotStep[]
  /** For a cycle: whether its record, its closing commit or a captured line reporting its end is on the branch; `null` for a shift. */
  finished: boolean | null
  /** The repository paths the row was read from. */
  paths: string[]
}

/** One frozen paired experiment of the Proving Ground. */
export interface ExperimentRow {
  record: string
  plan: string
  date: string
  /** `model`, `loop`, `attempts`, `hand-off` or `method`: which arm field differs. */
  group: string
  baseline: string
  candidate: string
  tiers: string
  environments: number
  pairs: number
  baselineCertified: number
  candidateCertified: number
  delta: number
  interval: { lower: number; upper: number }
  verdict: string
  statistic: string | null
  /** The same record re-read under the current statistic by a fold, when one did. */
  reread: { fold: string; delta: number; interval: { lower: number; upper: number }; verdict: string; statistic: string } | null
}

/** One pooled reading of several frozen pairs of one plan. */
export interface PooledRow {
  fold: string
  plan: string
  records: string[]
  pairs: number
  delta: number
  interval: { lower: number; upper: number }
  verdict: string
  statistic: string
}

/** One code-safety record read against its target's ground truth. */
export interface RecallRow {
  record: string
  date: string
  target: string
  knownIssues: number
  found: number
  missed: string[]
  findings: number
  elapsedSeconds: number | null
  certified: number | null
  departments: number | null
  examinerExit: number | null
  /** The comparison's authored side for this record, when it is one of its iterations. */
  iteration: { id: string; pair: string | null; arm: string | null; decision: string | null } | null
}

/** One tier of the three-tier comparison. */
export interface TierRow {
  id: string
  name: string
  found: number
  knownIssues: number
  findings: number
  /** How many of the findings land on a documented issue, by the same three-line rule as `found`. */
  onKnown: number
  verifiedAtLine: boolean
  /** The time as the comparison states it, for a tier without a measured duration. */
  wall: string | null
  wallSeconds: number | null
  /** The cost as the comparison states it, for a tier without a measured price. */
  cost: string | null
  costUsd: number | null
  record: string | null
}

/** One family of session logs and how many pin data-use terms. */
export interface TermsRow {
  family: SessionFamily
  sessions: number
  withTerms: number
}

/**
 * One approval a shift or intake record holds: a `signoff/recorded` event in its program log, or an entry of the
 * `decisions` its `result.json` states.
 */
export interface SignoffRow {
  /** The shift or intake id. */
  run: string
  record: 'shift' | 'intake'
  transition: string
  principal: string
  /** The kind the record declares for the principal (`human`, `machine`), as recorded; nothing authenticates it. */
  kind: string
  /** When the event was written; `null` for a decision, which the record states without a time. */
  at: string | null
  form: 'event' | 'decision'
}

/** One shift's reviews and the tool calls their logs record. */
export interface ReviewRow {
  shift: string
  reviews: number
  toolCalls: number
}

/** One review that decided a ticket, from its ledger line or, for a shift that never wrote its lines, from its shift record. */
export interface ReviewRecordRow {
  ticket: string
  shift: string
  /** The ledger line's time, or the shift record's end for a review only the record holds. */
  at: string | null
  verdict: 'approve' | 'reject'
  sessionId: string | null
  /** The reviewer's route and model as the ledger line names them; `null` for a line written before the engine recorded them. */
  reviewer: { route: string; model: string } | null
  /** The route and model the review session's request was sent with, from its log in the shift record; `null` without a log. */
  requested: { route: string; model: string } | null
  /** Tool calls in the review session's log; `null` when the record holds no log. */
  toolCalls: number | null
  /** `ledger` for a review a ledger line records, `shift record` for one only its shift record's session log holds. */
  recordedIn: 'ledger' | 'shift record'
  /** The commit this review's line shipped. */
  shipped: string | null
  /** For a rejection: the commit a later line of the same ticket shipped. */
  overturnedBy: string | null
  /** For a shipped approval: the later commits that reworked the shipped change. */
  followUps: FollowUpCommit[]
}

/** A record of a seeded copy: the planted defects caught, with the Wilson interval `seeded-recall.mjs` wrote. */
export interface SeededReading {
  record: string
  planted: number
  caught: number
  interval: { low: number; high: number }
  byClass: { cwe: string; category: string; n: number; caught: number }[]
}

/** `briefing.json`. */
export interface Briefing {
  schema: typeof BRIEFING_SCHEMA
  /** The newest moment any committed input records: the roster's stamp, a ledger line, a shift, an intake or an enterprise commit. */
  asOf: string
  repository: { name: string; branch: string; url: string }
  figures: Record<string, Figure<number | string>>
  divisions: Figure<DivisionRow[]>
  /** Recorded sessions per provider route, across every committed record. */
  routes: Figure<{ route: string; sessions: number }[]>
  shipped: Figure<ShippedRow[]>
  shifts: Figure<ShiftRow[]>
  /** Every cycle and every shift outside a cycle, oldest first. */
  pilot: Figure<PilotRow[]>
  ci: Figure<{ runs: CiRun[]; counts: Record<string, number> }>
  bench: {
    experiments: Figure<ExperimentRow[]>
    pooled: Figure<PooledRow[]>
  }
  safety: {
    recall: Figure<RecallRow[]>
    tiers: Figure<TierRow[]>
    seeded: Figure<SeededReading>
  }
  governance: {
    terms: Figure<TermsRow[]>
    signoffs: Figure<SignoffRow[]>
    reviews: Figure<ReviewRow[]>
    /** Every review that decided a ticket, oldest first. */
    reviewRecord: Figure<ReviewRecordRow[]>
  }
  economics: {
    tickets: Figure<{ ticket: string; tokens: number; seconds: number }[]>
  }
  inputs: InputDigest[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function ms(at: string): number {
  return Date.parse(at)
}

function newest(times: readonly (string | null | undefined)[]): string | undefined {
  let best: string | undefined
  for (const time of times) {
    if (typeof time !== 'string' || !Number.isFinite(ms(time))) continue
    if (best === undefined || ms(time) > ms(best)) best = time
  }
  return best
}

function sameCommit(left: string, right: string): boolean {
  return left.length >= 7 && right.length >= 7 && (left.startsWith(right) || right.startsWith(left))
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

// ---------------------------------------------------------------------------
// Enterprise
// ---------------------------------------------------------------------------

function ticketLines(ledger: LedgerRead): TicketLine[] {
  return ledger.lines.filter((line): line is TicketLine => line.type === 'ticket')
}

function functionLines(ledger: LedgerRead): FunctionLine[] {
  return ledger.lines.filter((line): line is FunctionLine => line.type === 'function')
}


function queueTickets(tickets: readonly LoadedTicket[]): { id: string; title: string | null }[] {
  const rows: { id: string; title: string | null }[] = []
  for (const { value } of tickets) {
    if (!isRecord(value) || typeof value.id !== 'string') continue
    rows.push({ id: value.id, title: str(value.title) })
  }
  return rows
}

/**
 * The divisions with their defined, occupied and active seats, by the roster's occupancy rule.
 * @param roster - the generated roster.
 * @returns one row per division in the roster's order.
 */
export function divisionRows(roster: Roster): DivisionRow[] {
  return roster.divisions.map((division) => {
    const members = roster.agents.filter(agent => agent.division === division.id)
    return {
      id: division.id,
      name: division.name,
      purpose: division.purpose,
      defined: members.length,
      occupied: members.filter(agent => agent.evidence.sessions > 0 || agent.ledger.lines > 0).length,
      active: members.filter(agent => agent.status === 'active').length,
    }
  })
}

/**
 * The queue's tickets by the ledger's status rule (`ticketStandings`): `shipped` and `rejected` close a ticket, `halted`
 * leaves it open, and a ticket with no line is `queued`.
 * @param tickets - the queue files.
 * @param ledger - the ledger.
 * @returns the ticket ids in each status.
 */
export function ticketsByStatus(tickets: readonly LoadedTicket[], ledger: LedgerRead): Record<'queued' | 'shipped' | 'rejected' | 'halted', string[]> {
  const standings = ticketStandings(ticketLines(ledger))
  const byStatus: Record<'queued' | 'shipped' | 'rejected' | 'halted', string[]> = { queued: [], shipped: [], rejected: [], halted: [] }
  const ids = new Set([...queueTickets(tickets).map(ticket => ticket.id), ...standings.keys()])
  for (const id of [...ids].sort()) byStatus[standings.get(id)?.status ?? 'queued'].push(id)
  return byStatus
}

/**
 * The shift records as rows, oldest first.
 * @param shifts - the records.
 * @returns the rows.
 */
export function shiftRows(shifts: readonly ShiftRecordInput[]): ShiftRow[] {
  return shifts.map((record) => {
    const result = record.result
    const lines = Array.isArray(result.tickets) ? result.tickets : []
    const ids = lines.map(entry => (isRecord(entry) ? str(entry.ticket) : str(entry))).filter((id): id is string => id !== null)
    const shipped = lines
      .filter((entry): entry is Record<string, unknown> => isRecord(entry) && isRecord(entry.shipped))
      .map(entry => str(entry.ticket))
      .filter((id): id is string => id !== null)
    const manifest = record.manifest ?? {}
    const startedAt = str(result.startedAt) ?? str(manifest.startedAt)
    const endedAt = str(result.endedAt) ?? str(manifest.endedAt)
    const seconds = startedAt === null || endedAt === null ? null : Math.round((ms(endedAt) - ms(startedAt)) / 1000)
    return {
      shift: str(result.shift) ?? record.dir,
      dir: record.dir,
      type: str(result.type) ?? 'unknown',
      startedAt,
      endedAt,
      tickets: ids,
      shipped,
      reason: str(result.reason) ?? (isRecord(result.halt) ? str(result.halt.reason) : null),
      redacted: num(result.redacted),
      seconds: seconds !== null && Number.isFinite(seconds) ? seconds : null,
    }
  }).sort((left, right) => ms(left.startedAt ?? '') - ms(right.startedAt ?? ''))
}

const CYCLE_SUBJECT = /^chore\(enterprise\): (cycle-\d{8}T\d{6}Z) (.+)$/
const CYCLE_ID = /^cycle-\d{8}T\d{6}Z$/
const CLOSING_SUBJECT = 'functions, roster and deck'
const SCHEDULER_NEXT = /^enterprise-scheduler: next cycle at (\S+)$/
const SCHEDULER_RAN = /^enterprise-scheduler: (cycle-\d{8}T\d{6}Z) exit=\d+ at /
const CYCLE_STEP = /^enterprise-cycle: (cycle-\d{8}T\d{6}Z) ([a-z][a-z0-9-]*) exit=(\d+) at (\S+)$/
const CYCLE_DONE = /^enterprise-cycle: (cycle-\d{8}T\d{6}Z) done, /

/** What the captured cycle logs and scheduler log state. */
interface LogReading {
  /** The slots the scheduler announced, as epoch milliseconds. */
  announced: number[]
  /** The stamps of the cycle logs the scheduler reported running, as epoch milliseconds. */
  ran: number[]
  /** Steps by cycle id. */
  steps: Map<string, PilotStep[]>
  /** Cycle ids whose log reports their end. */
  done: Set<string>
  /** The capture directory of each cycle's log, by cycle id. */
  dirs: Map<string, string>
  /** The capture directory of the scheduler's log. */
  schedulerDir: string | undefined
}

/**
 * A step's end as a cycle log states it: a full ISO time, or, from cycle scripts before 2026-09-28T22:27Z, a UTC time of
 * day, which is the first such moment at or after the previous step's end.
 * @param at - the time as logged.
 * @param after - the previous step's end, or the cycle's start, ISO.
 * @returns the ISO time, or `undefined` when neither form parses.
 */
function stepTime(at: string, after: string): string | undefined {
  if (/^\d{4}-/.test(at)) return Number.isFinite(ms(at)) ? new Date(ms(at)).toISOString() : undefined
  if (!/^\d{2}:\d{2}:\d{2}Z$/.test(at)) return undefined
  const sameDay = ms(`${after.slice(0, 10)}T${at}`)
  return new Date(sameDay >= ms(after) ? sameDay : sameDay + 86_400_000).toISOString()
}

function readLogs(logs: readonly CapturedLog[]): LogReading {
  const reading: LogReading = { announced: [], ran: [], steps: new Map(), done: new Set(), dirs: new Map(), schedulerDir: undefined }
  for (const log of logs) {
    if (log.name === 'scheduler.log') reading.schedulerDir = log.dir
    for (const line of log.text.split('\n')) {
      const next = SCHEDULER_NEXT.exec(line)
      const ran = SCHEDULER_RAN.exec(line)
      const step = CYCLE_STEP.exec(line)
      const done = CYCLE_DONE.exec(line)
      if (next?.[1] !== undefined && Number.isFinite(ms(next[1]))) reading.announced.push(ms(next[1]))
      const ranAt = ran?.[1] === undefined ? undefined : cycleStartedAt(ran[1])
      if (ranAt !== undefined) reading.ran.push(ms(ranAt))
      const cycle = step?.[1]
      const after = cycle === undefined ? undefined : reading.steps.get(cycle)?.at(-1)?.at ?? cycleStartedAt(cycle)
      const at = after === undefined || step?.[4] === undefined ? undefined : stepTime(step[4], after)
      if (cycle !== undefined && step?.[2] !== undefined && at !== undefined) {
        reading.steps.set(cycle, [...reading.steps.get(cycle) ?? [], { name: step[2], exit: Number(step[3]), at }])
        reading.dirs.set(cycle, log.dir)
      }
      if (done?.[1] !== undefined) reading.done.add(done[1])
    }
  }
  return reading
}

/**
 * Who started a cycle: the starter its cycle record states, or else what the captured scheduler log and the scheduler
 * script's history show.
 * @param start - the cycle's start, epoch milliseconds.
 * @param others - the other cycles' starts.
 * @param logs - the captured logs' reading.
 * @param scripts - when the scripts reached the branch.
 * @param recorded - the cycle record's `startedBy`, when the record states one.
 * @returns the starter and the evidence.
 */
function cycleStarter(
  start: number,
  others: readonly number[],
  logs: LogReading,
  scripts: ScriptHistory,
  record: CycleRecord | undefined,
): { startedBy: Starter; basis: string } {
  const recorded = record?.startedBy
  if (recorded !== undefined) {
    return { startedBy: recorded, basis: `Its cycle record states ${recorded}: the cycle script records scheduler when ${SCHEDULER_SCRIPT} is its parent process, and operator otherwise.` }
  }
  const ran = logs.ran.find(stamp => stamp <= start && start - stamp <= SCHEDULER_STAMP_SLACK_MS)
  if (ran !== undefined) {
    return { startedBy: 'scheduler', basis: `The captured scheduler log reports running the cycle whose log it stamped ${new Date(ran).toISOString()}.` }
  }
  // An announced slot suggests the scheduler but does not show it ran the cycle; a record that names no starter stays unknown.
  const slot = record === undefined ? logs.announced.filter(at => at <= start).sort((left, right) => right - left)[0] : undefined
  if (slot !== undefined && !others.some(other => other >= slot && other < start)) {
    return { startedBy: 'scheduler', basis: `The captured scheduler log announced the slot ${new Date(slot).toISOString()}, and this is the first cycle to start at or after it.` }
  }
  if (scripts.scheduler !== null && start < ms(scripts.scheduler)) {
    return { startedBy: 'operator', basis: `It started before ${SCHEDULER_SCRIPT} reached the branch (${scripts.scheduler}), so the scheduler cannot have started it.` }
  }
  return {
    startedBy: 'unknown',
    basis: record === undefined
      ? 'No captured scheduler log covers its start.'
      : 'Its cycle record names no starter, as records written before the field do not, and no captured scheduler log reports running it.',
  }
}

/**
 * The ledger's account of a set of shifts: shipped tickets, failed tickets, tokens, and the tickets their records name
 * that no line of theirs records.
 * @param lines - every ticket line.
 * @param shifts - the shifts' rows.
 * @returns the account.
 */
function shiftAccount(
  lines: readonly TicketLine[],
  shifts: readonly ShiftRow[],
): Pick<PilotRow, 'attempted' | 'shipped' | 'completedBy' | 'failed' | 'lost' | 'tokens'> {
  const ids = new Set(shifts.map(shift => shift.shift))
  const own = lines.filter(line => ids.has(line.shift))
  const tokens = own.filter(line => typeof line.tokens === 'number')
  const recorded = new Set(own.map(line => `${line.shift} ${line.ticket}`))
  return {
    attempted: shifts.reduce((sum, shift) => sum + shift.tickets.length, 0),
    shipped: own.filter(line => line.shipped !== null).map(line => line.ticket),
    completedBy: [...new Set(own.flatMap(line => (line.shipped === null || line.recordedBy === undefined ? [] : [line.recordedBy])))],
    failed: own.flatMap((line) => {
      const status = ticketStatus(line)
      if (status === 'shipped') return []
      const failedChecks = line.checks.filter(check => !check.ok).map(check => check.id)
      return [{ ticket: line.ticket, status, failedChecks, reason: line.reason ?? null }]
    }),
    lost: shifts.reduce((sum, shift) => sum + shift.tickets.filter(ticket => !recorded.has(`${shift.shift} ${ticket}`)).length, 0),
    tokens: tokens.length === 0 ? null : tokens.reduce((sum, line) => sum + (line.tokens ?? 0), 0),
  }
}

/**
 * The pilot's units of work, oldest first: every run of the cycle script the branch names (by a commit subject, a ledger
 * function line, a cycle record or a captured cycle log), and every shift record that falls outside all of them.
 *
 * A cycle's shifts are those its record lists; without a record, or with one that lists no shift although the cycle ran a
 * `shift` step, the shift records that start between the cycle's start and the next cycle's start, and before the end of
 * its `shift` step when its record or captured log states one. A shift start
 * line with no shift record stands for its shift, with the tickets the line names. A cycle that ran
 * a `shift` step with no shift record on the branch, whose steps nothing on the branch states, or that has no shift
 * record and nothing recording its end (it may still be running its shift), has an unknown number of tickets attempted
 * and lost. A shift outside every cycle's window was started by hand; one inside a window its cycle does not claim has an
 * unknown starter, as does a cycle whose record names no starter and whose start no captured scheduler log reports.
 * @param inputs - the briefing inputs.
 * @param shifts - the shift rows.
 * @returns the rows.
 */
export function pilotRows(
  inputs: Pick<BriefingInputs, 'commits' | 'ledger' | 'cycleRecords' | 'logs' | 'scripts'> & { shiftStarts?: readonly ShiftStartInput[] },
  recorded: readonly ShiftRow[],
): PilotRow[] {
  const logs = readLogs(inputs.logs)
  const known = new Set(recorded.map(shift => shift.shift))
  const started: ShiftRow[] = (inputs.shiftStarts ?? []).filter(start => !known.has(start.shift)).map(start => ({
    shift: start.shift,
    dir: SHIFT_STARTS_PATH,
    type: 'start',
    startedAt: start.at,
    endedAt: null,
    tickets: start.tickets,
    shipped: [],
    reason: null,
    redacted: null,
    seconds: null,
  }))
  const shifts = [...recorded, ...started]
  const records = new Map(inputs.cycleRecords.map(record => [record.cycle, record]))
  const closing = new Set<string>()
  const ids = new Set<string>([...records.keys(), ...logs.steps.keys()])
  for (const commit of inputs.commits) {
    const match = CYCLE_SUBJECT.exec(commit.subject)
    if (match?.[1] === undefined) continue
    ids.add(match[1])
    if (match[2] === CLOSING_SUBJECT) closing.add(match[1])
  }
  for (const line of functionLines(inputs.ledger)) if (CYCLE_ID.test(line.shift)) ids.add(line.shift)
  const cycles = [...ids]
    .flatMap((id) => {
      const startedAt = cycleStartedAt(id)
      return startedAt === undefined ? [] : [{ id, startedAt }]
    })
    .sort((left, right) => ms(left.startedAt) - ms(right.startedAt))
  const lines = ticketLines(inputs.ledger)
  const claimed = new Set<string>()
  const windows: { id: string; start: number; until: number }[] = []
  const rows: PilotRow[] = cycles.map(({ id, startedAt }, index) => {
    const start = ms(startedAt)
    const record = records.get(id)
    const steps = record?.steps ?? logs.steps.get(id) ?? []
    const shiftStep = steps.find(step => step.name === 'shift')
    const next = cycles[index + 1]
    const until = Math.min(
      next === undefined ? Number.POSITIVE_INFINITY : ms(next.startedAt),
      shiftStep === undefined ? Number.POSITIVE_INFINITY : ms(shiftStep.at),
    )
    // A record lists no shift when its cycle could not read the shift's lines back, as after a failed pull or push.
    const listed = record !== undefined && (record.shifts.length > 0 || shiftStep === undefined) ? record.shifts : undefined
    const own = listed !== undefined
      ? shifts.filter(shift => listed.includes(shift.shift))
      : shifts.filter(shift => shift.startedAt !== null && ms(shift.startedAt) >= start && ms(shift.startedAt) < until)
    for (const shift of own) claimed.add(shift.shift)
    windows.push({ id, start, until })
    const account = shiftAccount(lines, own)
    const finished = record !== undefined || closing.has(id) || logs.done.has(id)
    const unrecorded = own.length === 0 && (steps.length === 0 || shiftStep !== undefined || !finished)
    const logDir = logs.dirs.get(id)
    return {
      id,
      kind: 'cycle',
      startedAt,
      ...cycleStarter(
        start,
        cycles.filter(other => other.id !== id).map(other => ms(other.startedAt)),
        logs,
        inputs.scripts,
        record,
      ),
      shifts: own.map(shift => shift.shift),
      ...account,
      ...unrecorded ? { attempted: null, lost: null } : {},
      steps,
      finished,
      paths: [
        LEDGER_PATH,
        ...own.map(shift => shift.dir),
        ...record === undefined ? [] : [`${CYCLES_DIR}/${id}.json`],
        ...logDir === undefined ? [] : [logDir],
        ...logs.schedulerDir === undefined ? [] : [logs.schedulerDir],
      ],
    }
  })
  for (const shift of shifts) {
    if (claimed.has(shift.shift) || shift.startedAt === null) continue
    const startedMs = ms(shift.startedAt)
    const before = inputs.scripts.cycle !== null && startedMs < ms(inputs.scripts.cycle)
    // A shift that started while a cycle ran, which that cycle does not claim, is not known to be the operator's.
    const during = windows.find(window => startedMs >= window.start && startedMs < window.until)
    rows.push({
      id: shift.shift,
      kind: 'shift',
      startedAt: shift.startedAt,
      startedBy: during === undefined ? 'operator' : 'unknown',
      basis: during !== undefined
        ? `It started while ${during.id} was running, whose record names another shift; nothing on the branch states who started it.`
        : before
          ? `It started before ${CYCLE_SCRIPT} reached the branch (${inputs.scripts.cycle ?? ''}); a shift outside a cycle is started by hand with pnpm run enterprise -- shift.`
          : 'It started outside every cycle on the branch; a shift outside a cycle is started by hand with pnpm run enterprise -- shift.',
      shifts: [shift.shift],
      ...shiftAccount(lines, [shift]),
      steps: [],
      finished: null,
      paths: [LEDGER_PATH, shift.dir],
    })
  }
  return rows.sort((left, right) => ms(left.startedAt) - ms(right.startedAt))
}

// ---------------------------------------------------------------------------
// Proving Ground
// ---------------------------------------------------------------------------

interface Arm {
  model?: { model?: string }
  ladder?: { model?: { model?: string }; share?: number; selfReview?: boolean | string }[]
  implementer?: { kind?: string; label?: string }
  preset?: string
}

function modelOf(arm: Arm): string {
  return arm.model?.model ?? 'unknown model'
}

function rungModels(arm: Arm): string[] {
  const base = modelOf(arm)
  return (arm.ladder ?? [{}]).map(rung => rung.model?.model ?? base)
}

function loopOf(arm: Arm): string {
  const implementer = arm.implementer ?? {}
  if (implementer.kind === 'route') return 'harness loop'
  if (implementer.label === 'product-loop') return "the product's own loop"
  if (implementer.label === 'drop') return 'a fresh child per rung'
  return implementer.label ?? implementer.kind ?? 'unknown loop'
}

function reviewOf(arm: Arm): string | undefined {
  const flag = arm.ladder?.find(rung => rung.selfReview !== undefined)?.selfReview
  if (flag === true) return 'self-review turn'
  if (flag === 'probe') return 'probe-review turn'
  return undefined
}

function attempts(count: number): string {
  return `${count} ${count === 1 ? 'attempt' : 'attempts'}`
}

/**
 * Name the two arms of a pair by the one field that differs between them.
 * @param baseline - the baseline arm.
 * @param candidate - the candidate arm.
 * @returns the group of the question and both arms' labels.
 */
export function describeArms(baseline: Arm, candidate: Arm): { group: string; baseline: string; candidate: string } {
  const rungsB = rungModels(baseline)
  const rungsC = rungModels(candidate)
  const reviewB = reviewOf(baseline)
  const reviewC = reviewOf(candidate)
  if (reviewB !== reviewC) {
    return { group: 'method', baseline: [attempts(rungsB.length), reviewB].filter(Boolean).join(' + '), candidate: [attempts(rungsC.length), reviewC].filter(Boolean).join(' + ') }
  }
  if ((baseline.preset ?? '') !== (candidate.preset ?? '')) {
    return { group: 'method', baseline: `preset ${baseline.preset ?? 'default'}`, candidate: `preset ${candidate.preset ?? 'default'}` }
  }
  if (loopOf(baseline) !== loopOf(candidate) && rungsB.join() === rungsC.join()) {
    return { group: 'loop', baseline: loopOf(baseline), candidate: loopOf(candidate) }
  }
  const mixed = new Set([...rungsB, ...rungsC]).size > 1
  if (baseline.ladder === undefined && candidate.ladder === undefined && mixed) {
    return { group: 'model', baseline: modelOf(baseline), candidate: modelOf(candidate) }
  }
  if (!mixed) return { group: 'attempts', baseline: attempts(rungsB.length), candidate: attempts(rungsC.length) }
  const share = (arm: Arm): string[] => rungModels(arm).map((model, index) => {
    const value = arm.ladder?.[index]?.share
    return value === undefined ? model : `${model} (${Math.round(value * 100)}% of the caps)`
  })
  const loopC = loopOf(candidate) === loopOf(baseline) ? '' : `, ${loopOf(candidate)}`
  return { group: 'hand-off', baseline: share(baseline).join(', '), candidate: `${share(candidate).join(', ')}${loopC}` }
}

function tiersOf(plan: string): string {
  const match = /-t(\d)(?:t(\d))?(?:-|$)/.exec(plan)
  if (match?.[1] === undefined) return plan.startsWith('polyglot') ? 'public polyglot suite' : 'unknown tier'
  return match[2] === undefined ? `tier ${match[1]}` : `tiers ${match[1]}–${match[2]}`
}

function intervalOf(value: unknown): { lower: number; upper: number } | null {
  if (!isRecord(value)) return null
  const lower = num(value.lower)
  const upper = num(value.upper)
  return lower === null || upper === null ? null : { lower, upper }
}

/**
 * Every frozen paired experiment on record: a `result.json` whose `result` carries a verdict, an interval and at least one paired cell.
 * Certificates per arm are each cell's rate times its pairs, summed; a fold that re-read the record under the
 * current statistic is attached.
 * @param results - every record's `result.json`.
 * @param folds - every fold.
 * @returns the rows, oldest first.
 */
export function experimentRows(results: readonly BenchResultInput[], folds: readonly BenchResultInput[]): ExperimentRow[] {
  const rereads = new Map<string, ExperimentRow['reread']>()
  for (const fold of folds) {
    const value = fold.value
    if (value.reading !== 'reread' || !isRecord(value.result) || !Array.isArray(value.records)) continue
    const interval = intervalOf(value.result.interval)
    const delta = num(value.result.delta)
    const verdict = str(value.result.verdict)
    if (interval === null || delta === null || verdict === null) continue
    for (const entry of value.records) {
      const record = isRecord(entry) ? str(entry.record) : null
      if (record !== null) rereads.set(record, { fold: fold.file, delta, interval, verdict, statistic: str(value.result.statistic) ?? 'unknown' })
    }
  }
  const rows: ExperimentRow[] = []
  for (const { file, value } of results) {
    const result = value.result
    if (!isRecord(result) || typeof result.verdict !== 'string' || !Array.isArray(result.cells) || !isRecord(result.arms)) continue
    const interval = intervalOf(result.interval)
    const delta = num(result.delta)
    const cells = result.cells.filter(isRecord)
    const pairs = cells.reduce((sum, cell) => sum + (num(cell.pairs) ?? 0), 0)
    if (interval === null || delta === null || pairs === 0) continue
    const certified = (key: 'baselineRate' | 'candidateRate'): number => Math.round(cells.reduce((sum, cell) => sum + (num(cell[key]) ?? 0) * (num(cell.pairs) ?? 0), 0))
    const record = file.split('/').at(-2) ?? file
    const plan = str(value.plan) ?? record
    const arms = describeArms((result.arms.baseline ?? {}), (result.arms.candidate ?? {}))
    rows.push({
      record,
      plan,
      date: record.slice(0, 10),
      ...arms,
      tiers: tiersOf(plan),
      environments: cells.length,
      pairs,
      baselineCertified: certified('baselineRate'),
      candidateCertified: certified('candidateRate'),
      delta: round(delta, 4),
      interval: { lower: round(interval.lower, 4), upper: round(interval.upper, 4) },
      verdict: result.verdict,
      statistic: str(result.statistic),
      reread: rereads.get(record) ?? null,
    })
  }
  return rows.sort((left, right) => left.record.localeCompare(right.record))
}

/**
 * The pooled readings: folds whose `reading` is `pooled-reread`.
 * @param folds - every fold.
 * @returns one row per pooled fold.
 */
export function pooledRows(folds: readonly BenchResultInput[]): PooledRow[] {
  const rows: PooledRow[] = []
  for (const { file, value } of folds) {
    if (value.reading !== 'pooled-reread' || !isRecord(value.result) || !Array.isArray(value.records)) continue
    const interval = intervalOf(value.result.interval)
    const delta = num(value.result.delta)
    if (interval === null || delta === null) continue
    rows.push({
      fold: file,
      plan: str(value.plan) ?? file,
      records: value.records
        .map(entry => (isRecord(entry) ? str(entry.record) : null))
        .filter((record): record is string => record !== null),
      pairs: num(value.result.seedsPaired) ?? 0,
      delta: round(delta, 4),
      interval: { lower: round(interval.lower, 4), upper: round(interval.upper, 4) },
      verdict: str(value.result.verdict) ?? 'unknown',
      statistic: str(value.result.statistic) ?? 'unknown',
    })
  }
  return rows
}

// ---------------------------------------------------------------------------
// Code safety
// ---------------------------------------------------------------------------

function within(finding: FindingInput, file: string, lines: readonly [number, number]): boolean {
  return finding.file === file && finding.line >= lines[0] - RECALL_TOLERANCE && finding.line <= lines[1] + RECALL_TOLERANCE
}

/**
 * The documented issues a findings list catches: an issue counts as found when a finding cites its file within
 * three lines of its range or of one of its `alsoAt` locations, the rule `compare.mjs` and `recall.mjs` apply.
 * @param findings - the findings.
 * @param issues - the ground truth's issues.
 * @returns the ids found and missed, in the ground truth's order.
 */
export function recallAgainst(
  findings: readonly FindingInput[],
  issues: readonly GroundTruthIssue[],
): { found: string[]; missed: string[] } {
  const found: string[] = []
  const missed: string[] = []
  for (const issue of issues) {
    const hit = findings.some(finding => cites(finding, issue))
    ;(hit ? found : missed).push(issue.id)
  }
  return { found, missed }
}

/**
 * Whether a finding lands on a documented issue: it cites the issue's file, or another location the issue lists, within three lines.
 * @param finding - the finding.
 * @param issue - the documented issue.
 * @returns `true` when it does.
 */
function cites(finding: FindingInput, issue: GroundTruthIssue): boolean {
  const locations = [{ file: issue.file, lines: issue.lines }, ...(issue.alsoAt ?? [])]
  return locations.some(location => within(finding, location.file, location.lines))
}

function targetOf(record: string): string | null {
  if (record.includes('nodegoat')) return 'nodegoat'
  if (record.includes('dvja')) return 'dvja'
  return null
}

/**
 * Every code-safety record whose target has a documented ground truth, read against it.
 * @param inputs - the code-safety inputs.
 * @returns one row per record, oldest first.
 */
export function recallRows(inputs: BriefingInputs['safety']): RecallRow[] {
  const iterations = new Map<string, RecallRow['iteration']>()
  const authored = inputs.comparison?.value.iterations
  if (Array.isArray(authored)) {
    for (const entry of authored) {
      if (!isRecord(entry) || typeof entry.record !== 'string') continue
      iterations.set(entry.record.split('/').at(-1) ?? entry.record, { id: str(entry.id) ?? '', pair: str(entry.pair), arm: str(entry.arm), decision: str(entry.decision) })
    }
  }
  const rows: RecallRow[] = []
  for (const record of inputs.records) {
    const target = targetOf(record.name)
    const truth = target === null ? undefined : inputs.groundTruths[target]
    if (target === null || truth === undefined) continue
    const { found, missed } = recallAgainst(record.findings, truth.issues)
    const certified = Array.isArray(record.manifest.certified) ? record.manifest.certified.length : null
    const departments = Array.isArray(record.manifest.departments) ? record.manifest.departments.length + 1 : null
    const verifier = isRecord(record.manifest.verifier) ? num(record.manifest.verifier.exitCode) : null
    rows.push({
      record: record.name,
      date: record.name.slice(0, 10),
      target: str(truth.target) ?? target,
      knownIssues: truth.issues.length,
      found: found.length,
      missed,
      findings: record.findings.length,
      elapsedSeconds: num(record.manifest.elapsedSeconds),
      certified,
      departments,
      examinerExit: verifier,
      iteration: iterations.get(record.name) ?? null,
    })
  }
  return rows.sort((left, right) => left.record.localeCompare(right.record, 'en', { numeric: true }))
}

/**
 * The three-tier comparison, each tier's findings read against the ground truth by {@link recallAgainst}.
 * @param inputs - the code-safety inputs.
 * @returns the tiers, or `undefined` when the comparison or the NodeGoat ground truth is missing.
 */
export function tierRows(inputs: BriefingInputs['safety']): TierRow[] | undefined {
  const comparison = inputs.comparison
  const truth = inputs.groundTruths.nodegoat
  if (comparison === undefined || truth === undefined || !Array.isArray(comparison.value.tiers)) return undefined
  const authored = new Map(comparison.value.tiers.filter(isRecord).map(tier => [str(tier.id) ?? '', tier]))
  const enterpriseTier = authored.get('enterprise')
  const detail = str(enterpriseTier?.detail) ?? ''
  const recordName = /record (\S+)/.exec(detail)?.[1] ?? null
  const record = recordName === null ? undefined : inputs.records.find(entry => entry.name === recordName)
  const meta = comparison.singleModelMeta
  const cost = num(meta.cost_usd)
  const duration = num(meta.duration_ms)
  const rows: TierRow[] = [
    {
      id: 'semgrep',
      findings: comparison.semgrep,
      verified: false,
      wallSeconds: null,
      costUsd: null,
      record: null,
    },
    {
      id: 'single-model',
      findings: comparison.singleModel,
      verified: false,
      wallSeconds: duration === null ? null : Math.round(duration / 1000),
      costUsd: cost === null ? null : round(cost, 2),
      record: null,
    },
    ...record === undefined ? [] : [{
      id: 'enterprise',
      findings: record.findings,
      verified: isRecord(record.manifest.verifier) && record.manifest.verifier.exitCode === 0,
      wallSeconds: num(record.manifest.elapsedSeconds),
      costUsd: null,
      record: record.name,
    }],
  ].map(tier => ({
    id: tier.id,
    name: str(authored.get(tier.id)?.name) ?? tier.id,
    found: recallAgainst(tier.findings, truth.issues).found.length,
    knownIssues: truth.issues.length,
    findings: tier.findings.length,
    onKnown: tier.findings.filter(finding => truth.issues.some(issue => cites(finding, issue))).length,
    verifiedAtLine: tier.verified,
    wall: str(authored.get(tier.id)?.wall),
    wallSeconds: tier.wallSeconds,
    cost: str(authored.get(tier.id)?.cost),
    costUsd: tier.costUsd,
    record: tier.record,
  }))
  return rows
}

// ---------------------------------------------------------------------------
// Governance
// ---------------------------------------------------------------------------

/**
 * Sessions per record family, and how many of them pin `dataUse/terms`.
 * @param sessions - the scanned logs by family.
 * @returns one row per family.
 */
export function termsRows(sessions: BriefingInputs['sessions']): TermsRow[] {
  return (Object.keys(sessions) as SessionFamily[]).map(family => ({
    family,
    sessions: sessions[family].length,
    withTerms: sessions[family].filter(session => session.dataUseTerms).length,
  }))
}

/**
 * The entries of a record's `decisions`: each names a transition and a principal with its declared kind.
 * @param result - a shift's or intake's `result.json`.
 * @returns the transition, principal id and kind of each well-formed entry.
 */
function decisionsOf(result: Record<string, unknown>): { transition: string; principal: string; kind: string }[] {
  const decisions = Array.isArray(result.decisions) ? result.decisions : []
  return decisions.filter(isRecord).flatMap((decision) => {
    const principal = isRecord(decision.principal) ? decision.principal : undefined
    const transition = str(decision.transition)
    const id = principal === undefined ? null : str(principal.id)
    return transition === null || id === null ? [] : [{ transition, principal: id, kind: str(principal?.kind) ?? 'unknown' }]
  })
}

/**
 * Every approval the shift and intake records hold: the `signoff/recorded` events of their session logs, and the
 * `decisions` their `result.json` states. Events come first by time, then decisions by record.
 * @param shifts - the shift records.
 * @param intakes - the intake records.
 * @param intakeSessions - the scanned session logs under the intake records.
 * @returns one row per event or decision.
 */
export function signoffRows(
  shifts: readonly ShiftRecordInput[],
  intakes: readonly IntakeRecordInput[] = [],
  intakeSessions: readonly SessionScan[] = [],
): SignoffRow[] {
  const records = [
    ...shifts.map(shift => ({ run: str(shift.result.shift) ?? shift.dir, record: 'shift' as const, result: shift.result, sessions: shift.sessions })),
    ...intakes.map(intake => ({
      run: str(intake.result.id) ?? intake.dir,
      record: 'intake' as const,
      result: intake.result,
      sessions: intakeSessions.filter(session => session.file.startsWith(`${intake.dir}/`)),
    })),
  ]
  const events: SignoffRow[] = []
  const decisions: SignoffRow[] = []
  for (const { run, record, result, sessions } of records) {
    for (const session of sessions) {
      for (const { transition, principal, kind, time } of session.signoffs) {
        events.push({ run, record, transition, principal, kind, at: new Date(time).toISOString(), form: 'event' })
      }
    }
    for (const decision of decisionsOf(result)) decisions.push({ run, record, ...decision, at: null, form: 'decision' })
  }
  return [...events.sort((left, right) => ms(left.at ?? '') - ms(right.at ?? '')), ...decisions]
}

/**
 * Every shift's review sessions (`review-*.jsonl`) and the tool calls they record.
 * @param shifts - the shift records.
 * @returns one row per shift that holds a review.
 */
export function reviewRows(shifts: readonly ShiftRecordInput[]): ReviewRow[] {
  return shifts
    .map((shift) => {
      const reviews = shift.sessions.filter(session => /\/review-[^/]+\.jsonl$/.test(session.file))
      const toolCalls = reviews.reduce((sum, session) => sum + session.toolCalls, 0)
      return { shift: str(shift.result.shift) ?? shift.dir, reviews: reviews.length, toolCalls }
    })
    .filter(row => row.reviews > 0)
}

/** The session id a review log is named for, from its path. */
const REVIEW_LOG = /\/(review-(t-\d{4})-[^/]+)\.jsonl$/

/**
 * Every review that decided a ticket, oldest first: each ticket line whose review approved or rejected, with the
 * reviewer it names and what its session log in the shift record shows, then each review log of a shift record that
 * no ledger line names — a shift that crashed before it wrote its lines — with the verdict its last answer states. A
 * rejection is overturned when a later line of the same ticket shipped; a shipped approval lists the commits that
 * reworked it.
 * @param ledger - the ledger.
 * @param shifts - the shift records.
 * @param followUps - per shipped commit, the later commits that reworked it.
 * @returns one row per review.
 */
export function reviewRecordRows(
  ledger: LedgerRead,
  shifts: readonly ShiftRecordInput[],
  followUps: Readonly<Record<string, FollowUpCommit[]>>,
): ReviewRecordRow[] {
  const logs = new Map<string, { scan: SessionScan; shift: ShiftRecordInput }>()
  for (const shift of shifts) {
    for (const scan of shift.sessions) {
      const id = REVIEW_LOG.exec(scan.file)?.[1]
      if (id !== undefined) logs.set(id, { scan, shift })
    }
  }
  const lines = ticketLines(ledger)
  const overturn = (ticket: string, at: string | null): string | null => {
    const later = lines.find(line => line.ticket === ticket && line.shipped !== null && (at === null || ms(line.at) > ms(at)))
    return later?.shipped?.commit ?? null
  }
  const rows: ReviewRecordRow[] = []
  for (const line of [...lines].sort((left, right) => ms(left.at) - ms(right.at))) {
    const verdict = line.review?.verdict.trim().toLowerCase()
    if (verdict !== 'approve' && verdict !== 'reject') continue
    const sessionId = line.review?.sessionId ?? null
    const log = sessionId === null ? undefined : logs.get(sessionId)
    const shipped = line.shipped?.commit ?? null
    rows.push({
      ticket: line.ticket,
      shift: line.shift,
      at: line.at,
      verdict,
      sessionId,
      reviewer: line.reviewer === undefined ? null : { route: line.reviewer.route, model: line.reviewer.model },
      requested: log?.scan.request ?? null,
      toolCalls: log?.scan.toolCalls ?? null,
      recordedIn: 'ledger',
      shipped,
      overturnedBy: verdict === 'reject' ? overturn(line.ticket, line.at) : null,
      followUps: shipped === null ? [] : followUps[shipped] ?? [],
    })
  }
  const named = new Set(lines.flatMap(line => (line.review?.sessionId === undefined ? [] : [line.review.sessionId])))
  for (const [sessionId, { scan, shift }] of logs) {
    if (named.has(sessionId) || scan.verdict === undefined) continue
    const ticket = (REVIEW_LOG.exec(scan.file)?.[2] ?? '').toUpperCase()
    const at = str(shift.result.endedAt) ?? str(shift.result.startedAt)
    rows.push({
      ticket,
      shift: str(shift.result.shift) ?? shift.dir,
      at: at === null ? null : new Date(at).toISOString(),
      verdict: scan.verdict,
      sessionId,
      reviewer: null,
      requested: scan.request ?? null,
      toolCalls: scan.toolCalls,
      recordedIn: 'shift record',
      shipped: null,
      overturnedBy: scan.verdict === 'reject' ? overturn(ticket, at) : null,
      followUps: [],
    })
  }
  return rows.sort((left, right) => ms(left.at ?? '') - ms(right.at ?? '') || left.ticket.localeCompare(right.ticket))
}

// ---------------------------------------------------------------------------
// Branch CI
// ---------------------------------------------------------------------------

function readRuns(body: unknown): { runs: CiRun[]; total: number } {
  if (!isRecord(body) || !Array.isArray(body.workflow_runs)) throw new Error('the runs answer carries no workflow_runs')
  const runs: CiRun[] = []
  for (const entry of body.workflow_runs) {
    if (!isRecord(entry) || typeof entry.id !== 'number' || typeof entry.head_sha !== 'string') continue
    runs.push({
      id: entry.id,
      head: entry.head_sha,
      status: str(entry.status) ?? 'unknown',
      conclusion: str(entry.conclusion),
      createdAt: str(entry.created_at) ?? '',
      updatedAt: str(entry.updated_at) ?? '',
      url: str(entry.html_url) ?? `https://github.com/${CI_REPOSITORY}/actions/runs/${entry.id}`,
    })
  }
  return { runs, total: num(body.total_count) ?? runs.length }
}

/**
 * Every Branch CI run of the branch, oldest first.
 * @param github - the API reader.
 * @param branch - the branch.
 * @returns the runs.
 */
export async function readBranchRuns(github: GitHubReader, branch: string): Promise<CiRun[]> {
  const runs: CiRun[] = []
  for (let page = 1; page <= CI_PAGE_LIMIT; page += 1) {
    const { runs: batch, total } = readRuns(await github.json(`/repos/${CI_REPOSITORY}/actions/workflows/${CI_WORKFLOW}/runs?branch=${encodeURIComponent(branch)}&per_page=100&page=${page}`))
    runs.push(...batch)
    if (batch.length === 0 || runs.length >= total) break
  }
  return runs.sort((left, right) => ms(left.createdAt) - ms(right.createdAt) || left.id - right.id)
}

/**
 * One run's jobs, each failed job's gates read from its log by `parseJobLog`.
 * @param github - the API reader.
 * @param run - the run.
 * @returns the run with its jobs, ordered by name.
 */
export async function readRunDetail(github: GitHubReader, run: CiRun): Promise<CiRunDetail> {
  const body = await github.json(`/repos/${CI_REPOSITORY}/actions/runs/${run.id}/jobs?per_page=100`)
  if (!isRecord(body) || !Array.isArray(body.jobs)) throw new Error(`the jobs answer of run ${run.id} carries no jobs`)
  const jobs: CiJob[] = []
  for (const entry of body.jobs) {
    if (!isRecord(entry) || typeof entry.id !== 'number') continue
    const conclusion = str(entry.conclusion)
    const failedGates: string[] = []
    if (conclusion === 'failure') {
      const log = parseJobLog(await github.text(`/repos/${CI_REPOSITORY}/actions/jobs/${entry.id}/logs`))
      for (const [label, result] of log.gates) if (result === 'fail') failedGates.push(label)
    }
    const name = str(entry.name) ?? String(entry.id)
    jobs.push({ name, conclusion, url: str(entry.html_url) ?? run.url, failedGates: failedGates.sort() })
  }
  return { ...run, jobs: jobs.sort((left, right) => left.name.localeCompare(right.name)) }
}

function failedGatesOf(run: CiRunDetail | null): string[] {
  return run === null ? [] : [...new Set(run.jobs.flatMap(job => job.failedGates))].sort()
}

/**
 * The Branch CI runs that bear on one shipped commit: a run on exactly that commit, the containing run of the push that
 * carried it, the run on the shift's base, and the first successful run containing it, with the containing run's failed
 * gates split by whether the base run failed them too.
 * @param github - the API reader.
 * @param git - the ancestry reader.
 * @param runs - the branch's runs, oldest first.
 * @param commit - the shipped commit.
 * @param base - the shift's base commit, when its record names one.
 * @returns the verdicts.
 */
export async function shipmentCi(
  github: GitHubReader,
  git: GitReader,
  runs: readonly CiRun[],
  commit: string,
  base: string | null,
): Promise<ShipmentCi> {
  const containing = runs.filter(run => git.isAncestor(commit, run.head))
  const onCommit = runs.filter(run => sameCommit(run.head, commit))
  const carryingRun = containing[0]
  const baseRun = base === null ? undefined : [...runs].reverse().find(run => sameCommit(run.head, base) && run.status === 'completed')
  const carrying = carryingRun === undefined ? null : await readRunDetail(github, carryingRun)
  const baseDetail = baseRun === undefined ? null : await readRunDetail(github, baseRun)
  const before = new Set(failedGatesOf(baseDetail))
  const failing = failedGatesOf(carrying)
  return {
    exact: onCommit.filter(run => run.status === 'completed').at(-1) ?? onCommit.at(-1) ?? null,
    carrying,
    base: baseDetail,
    firstGreen: containing.find(run => run.conclusion === 'success') ?? null,
    introduced: failing.filter(gate => !before.has(gate)),
    preExisting: failing.filter(gate => before.has(gate)),
  }
}

// ---------------------------------------------------------------------------
// The briefing
// ---------------------------------------------------------------------------

/** What the API reading produced, or why it failed. */
export interface CiReading {
  runs: CiRun[]
  /** Verdicts by shipped commit. */
  shipments: Map<string, ShipmentCi | Error>
  /** The failure that left every CI figure unknown, when the run list could not be read. */
  failure?: string
  /** The repository's visibility on GitHub (`public`, `private` or `internal`), or why it could not be read. */
  visibility?: string | Error
}

/**
 * Read Branch CI for the briefing. A failed run list leaves every CI figure unknown; a failed read for one
 * shipment leaves that shipment's alone unknown.
 * @param github - the API reader.
 * @param git - the ancestry reader.
 * @param shipments - each shipped commit with its shift's base.
 * @param branch - the branch.
 * @returns the reading.
 */
export async function readCi(
  github: GitHubReader,
  git: GitReader,
  shipments: readonly { commit: string; base: string | null }[],
  branch: string,
): Promise<CiReading> {
  let runs: CiRun[]
  try {
    runs = await readBranchRuns(github, branch)
  } catch (error: unknown) {
    return { runs: [], shipments: new Map(), failure: `${error instanceof Error ? error.message : String(error)}${proxyHint()}` }
  }
  const verdicts = new Map<string, ShipmentCi | Error>()
  for (const { commit, base } of shipments) {
    try {
      verdicts.set(commit, await shipmentCi(github, git, runs, commit, base))
    } catch (error: unknown) {
      verdicts.set(commit, error instanceof Error ? error : new Error(String(error)))
    }
  }
  return { runs, shipments: verdicts, visibility: await readVisibility(github) }
}

/**
 * The repository's visibility on GitHub.
 * @param github - the API reader.
 * @returns `public`, `private` or `internal`, or the error that prevented reading it.
 */
async function readVisibility(github: GitHubReader): Promise<string | Error> {
  let body: unknown
  try {
    body = await github.json(`/repos/${CI_REPOSITORY}`)
  } catch (error: unknown) {
    return error instanceof Error ? error : new Error(String(error))
  }
  if (isRecord(body) && typeof body.visibility === 'string') return body.visibility
  return new Error('the repository answer carries no visibility')
}

const ROSTER_SOURCE = [ROSTER_PATH]
const PILOT_PATHS = [LEDGER_PATH, SHIFTS_DIR, SHIFT_STARTS_PATH, CYCLES_DIR, CAPTURED_CYCLE_LOGS, CYCLE_SCRIPT, SCHEDULER_SCRIPT]
const CI_URL = `https://github.com/${CI_REPOSITORY}/actions/workflows/${CI_WORKFLOW}`

/**
 * @param shifts - the shift records.
 * @returns each shift's base commit by shift id, from its result or its manifest.
 */
function shiftBases(shifts: readonly ShiftRecordInput[]): Map<string, string | null> {
  return new Map(shifts.map(shift => [str(shift.result.shift) ?? shift.dir, str(shift.result.base) ?? str(shift.manifest?.base)]))
}

/**
 * The shipped commits the ledger names with their shifts' base commits, for {@link readCi}.
 * @param inputs - the briefing inputs.
 * @returns one entry per shipped commit.
 */
export function shipmentsOf(inputs: BriefingInputs): { commit: string; base: string | null }[] {
  const bases = shiftBases(inputs.shifts)
  const shipments = new Map<string, string | null>()
  for (const line of ticketLines(inputs.ledger)) {
    if (line.shipped !== null && !shipments.has(line.shipped.commit)) shipments.set(line.shipped.commit, bases.get(line.shift) ?? null)
  }
  return [...shipments.entries()].map(([commit, base]) => ({ commit, base }))
}

/**
 * Build the briefing from the inputs and the CI reading. Pure: the same arguments give the same briefing.
 * @param inputs - everything read from the repository.
 * @param ci - the Branch CI reading.
 * @param branch - the development branch.
 * @returns the briefing.
 */
export function buildBriefing(inputs: BriefingInputs, ci: CiReading, branch: string = DEFAULT_CI_BRANCH): Briefing {
  const { roster, ledger } = inputs
  const tickets = ticketsByStatus(inputs.tickets, ledger)
  const shifts = shiftRows(inputs.shifts)
  const titles = new Map(queueTickets(inputs.tickets).map(ticket => [ticket.id, ticket.title]))
  const seatNames = new Map(roster.agents.map(agent => [agent.id, agent.name]))
  const bases = shiftBases(inputs.shifts)
  const reviews = new Map<string, number>()
  for (const shift of inputs.shifts) {
    for (const session of shift.sessions) {
      const id = /\/(review-[^/]+)\.jsonl$/.exec(session.file)?.[1]
      if (id !== undefined) reviews.set(id, session.toolCalls)
    }
  }
  const ledgerSource = (computation: string): Source => ({ paths: [LEDGER_PATH], computation })
  const ciSource = (computation: string): Source => ({ paths: [LEDGER_PATH, SHIFTS_DIR], urls: [CI_URL], computation })

  const shippedStandings = [...ticketStandings(ticketLines(ledger)).values()]
    .filter((standing): standing is TicketStanding & { status: 'shipped' } => standing.status === 'shipped')
    .sort((left, right) => ms(left.line.at) - ms(right.line.at) || left.line.ticket.localeCompare(right.line.ticket))
  const shippedLines = shippedStandings.map(standing => standing.line)
  const shipped: ShippedRow[] = shippedStandings.map(({ line, commit }) => {
    const verdict = ci.shipments.get(commit)
    const source = ciSource(`The Branch CI runs of ${branch}: the earliest run whose commit contains ${commit.slice(0, 9)} (git merge-base --is-ancestor), the run on the shift's base commit, and the earliest successful run containing it; failed gates read from each failed job's log.`)
    const figure: Figure<ShipmentCi> = ci.failure !== undefined
      ? unknownFigure(`Branch CI could not be read: ${ci.failure}`, source)
      : verdict === undefined
        ? unknownFigure('the commit was not read', source)
        : verdict instanceof Error ? unknownFigure(verdict.message, source) : known(verdict, source)
    const reviewId = line.review?.sessionId
    return {
      ticket: line.ticket,
      title: titles.get(line.ticket) ?? null,
      seat: line.seat,
      seatName: seatNames.get(line.seat) ?? null,
      division: line.division,
      shift: line.shift,
      at: line.at,
      commit,
      base: bases.get(line.shift) ?? null,
      model: line.model ?? null,
      checks: { passed: line.checks.filter(check => check.ok).length, total: line.checks.length, ids: line.checks.map(check => check.id) },
      review: line.review?.verdict ?? null,
      reviewToolCalls: reviewId === undefined ? null : reviews.get(reviewId) ?? null,
      tokens: line.tokens ?? null,
      seconds: line.seconds ?? null,
      ci: figure,
    }
  })

  const pilot = pilotRows(inputs, shifts)
  const experiments = experimentRows(inputs.bench.results, inputs.bench.folds)
  const recall = recallRows(inputs.safety)
  const tiers = tierRows(inputs.safety)
  const selfReview = inputs.safety.records.find(record => record.seeded !== undefined)
  const economics = shippedLines.filter(line => typeof line.tokens === 'number' && typeof line.seconds === 'number')
    .map(line => ({ ticket: line.ticket, tokens: line.tokens as number, seconds: line.seconds as number }))

  const asOf = newest([
    roster.generatedAt,
    ...ledger.lines.map(line => line.at),
    ...shifts.flatMap(shift => [shift.startedAt, shift.endedAt]),
    ...inputs.intakes.map(intake => str(intake.result.at)),
    ...inputs.commits.map(commit => commit.at),
    ...inputs.cycleRecords.map(record => record.endedAt),
    ...pilot.flatMap(row => row.steps.map(step => step.at)),
  ]) ?? roster.generatedAt

  const domains = new Set(inputs.bench.environments.map(environment => environment.domain))
  const tierCounts = new Map<number, number>()
  for (const environment of inputs.bench.environments) tierCounts.set(environment.tier, (tierCounts.get(environment.tier) ?? 0) + 1)
  const hardest = Math.max(0, ...tierCounts.keys())
  const benchSource = (computation: string): Source => ({ paths: [BENCH_ENVIRONMENTS_DIR], computation })

  const shippingShifts = shifts.filter(shift => shift.shipped.length > 0 && shift.seconds !== null)
  const tokensTotal = economics.reduce((sum, row) => sum + row.tokens, 0)
  const secondsTotal = economics.reduce((sum, row) => sum + row.seconds, 0)
  const nodegoat = recall.filter(row => row.record.includes('nodegoat'))
  const reviewDurations = inputs.safety.records
    .map(record => num(record.manifest.elapsedSeconds))
    .filter((value): value is number => value !== null)
  const codeSafetyManifests = [CODE_SAFETY_DIR]

  const figures: Record<string, Figure<number | string>> = {
    'seats.defined': known(roster.counts.defined, { paths: ROSTER_SOURCE, computation: 'counts.defined: the seats the roster defines.' }),
    'divisions.count': known(roster.divisions.length, { paths: ROSTER_SOURCE, computation: 'The entries of divisions.' }),
    'seats.occupied': known(roster.counts.occupied, { paths: ROSTER_SOURCE, computation: 'counts.occupied: seats with at least one attributed recorded session or one ledger line naming them.' }),
    'seats.active': known(roster.counts.active, { paths: ROSTER_SOURCE, computation: `counts.active: seats whose newest deliverable falls in the 24 hours ending at the roster's stamp, ${roster.generatedAt}.` }),
    'roster.stamp': known(roster.generatedAt, { paths: ROSTER_SOURCE, computation: 'generatedAt: the moment the roster content last changed.' }),
    'tickets.total': known(tickets.queued.length + tickets.shipped.length + tickets.rejected.length + tickets.halted.length, { paths: [TICKETS_DIR, LEDGER_PATH], computation: 'Queue files and ticket ids the ledger names, counted once each.' }),
    'tickets.open': known(tickets.queued.length + tickets.halted.length, { paths: [TICKETS_DIR, LEDGER_PATH], computation: 'Tickets no ledger line shipped and whose latest line records no reject verdict, or that have no line.' }),
    'tickets.shipped': known(tickets.shipped.length, ledgerSource('Tickets any ticket line of which names a shipped commit, whatever the order of their lines.')),
    'tickets.rejected': known(tickets.rejected.length, ledgerSource('Tickets no line shipped whose latest ticket line records a reject verdict.')),
    'tickets.halted': known(tickets.halted.length, ledgerSource('Tickets no line shipped whose latest ticket line records no reject verdict.')),
    'shifts.count': known(shifts.length, { paths: [SHIFTS_DIR], computation: 'Shift record directories.' }),
    'ledger.lines': known(ledger.lines.length, ledgerSource('Lines the ledger reader accepted.')),
    'ledger.functionLines': known(functionLines(ledger).length, ledgerSource('Lines of type function.')),
    'sessions.recorded': known(roster.evidence.sessions, { paths: ROSTER_SOURCE, computation: 'evidence.sessions: the session logs of the committed records the roster read.' }),
    'sessions.records': known(roster.evidence.records.length, { paths: ROSTER_SOURCE, computation: 'evidence.records: the committed record directories the roster read.' }),
    'bench.environments': known(inputs.bench.environments.length, benchSource('Environment directories carrying a task.json.')),
    'bench.domains': known(domains.size, benchSource('Distinct domain fields of those task.json files.')),
    'bench.hardestTier': known(hardest, benchSource('The highest tier field.')),
    'bench.hardestTierEnvironments': known(tierCounts.get(hardest) ?? 0, benchSource('Environments on the highest tier.')),
    'bench.records': known(inputs.bench.records, { paths: [PROVING_GROUND_DIR], computation: 'Record directories carrying a manifest.json.' }),
    'bench.frozenPairs': known(experiments.length, { paths: [PROVING_GROUND_DIR], computation: 'Records whose result.json carries a verdict, an interval and at least one paired cell.' }),
    'bench.decisive': known(experiments.filter(row => (row.reread?.verdict ?? row.verdict) !== 'inconclusive').length, { paths: [PROVING_GROUND_DIR], computation: 'Frozen pairs whose current verdict (a re-read fold\'s when one exists) is promote or reject.' }),
  }
  const reviewRecord = reviewRecordRows(ledger, inputs.shifts, inputs.followUps ?? {})
  const ledgerReviews = reviewRecord.filter(row => row.recordedIn === 'ledger')
  figures['reviews.approved'] = known(ledgerReviews.filter(row => row.verdict === 'approve').length, ledgerSource('Ticket lines whose review verdict is approve.'))
  figures['reviews.rejected'] = known(ledgerReviews.filter(row => row.verdict === 'reject').length, ledgerSource('Ticket lines whose review verdict is reject.'))
  figures['reviews.reviewerRecorded'] = known(ledgerReviews.filter(row => row.reviewer !== null).length, ledgerSource('Ticket lines with an approving or rejecting review that name the reviewer\'s route and model.'))
  figures['reviews.overturned'] = known(reviewRecord.filter(row => row.overturnedBy !== null).length, { paths: [LEDGER_PATH, SHIFTS_DIR], computation: 'Rejections, on a ticket line or in a shift record\'s review log, of a ticket a later ticket line shipped.' })
  figures['reviews.recordOnly'] = known(reviewRecord.length - ledgerReviews.length, { paths: [SHIFTS_DIR], computation: 'Review logs in a shift record whose session no ticket line names and whose last answer states a verdict.' })
  figures['reviews.reworked'] = inputs.followUps === undefined
    ? unknownFigure('the git history was not read', ledgerSource('Shipped approvals a later commit reworked.'))
    : known(ledgerReviews.filter(row => row.followUps.length > 0).length, ledgerSource('Approving ticket lines whose shipped commit a later commit on the branch names in its message while changing a file in a directory the shipped commit changed (git log).'))
  const pilotSource = (computation: string): Source => ({ paths: PILOT_PATHS, computation })
  const cycleUnits = pilot.filter(row => row.kind === 'cycle')
  const shippedBy = (starter: Starter): number => pilot
    .filter(row => row.startedBy === starter)
    .reduce((sum, row) => sum + row.shipped.length, 0)
  figures['pilot.cycles'] = known(cycleUnits.length, pilotSource(`Runs of ${CYCLE_SCRIPT} the branch names, by a cycle commit's subject (git log), a ledger function line, a cycle record or a captured cycle log.`))
  figures['pilot.schedulerCycles'] = known(
    cycleUnits.filter(row => row.startedBy === 'scheduler').length,
    pilotSource('Cycles whose record states scheduler, or else that the captured scheduler log reports running, or the first to start at or after a slot it announced.'),
  )
  figures['pilot.operatorUnits'] = known(
    pilot.filter(row => row.startedBy === 'operator').length,
    pilotSource(`Cycles whose record states operator or that started before ${SCHEDULER_SCRIPT} reached the branch, and shift records outside every cycle.`),
  )
  figures['pilot.schedulerShipped'] = known(shippedBy('scheduler'), pilotSource('Tickets shipped by the ledger lines of the shifts of the cycles the scheduler started.'))
  figures['pilot.operatorShipped'] = known(shippedBy('operator'), pilotSource('Tickets shipped by the ledger lines of the shifts the operator started, directly or through a cycle.'))
  figures['pilot.unknownShipped'] = known(shippedBy('unknown'), pilotSource('Tickets shipped by the ledger lines of the shifts of the units whose starter nothing on the branch states.'))
  const visibilitySource: Source = {
    paths: [],
    urls: [`https://github.com/${CI_REPOSITORY}`],
    computation: `The visibility field of GitHub's answer to GET /repos/${CI_REPOSITORY}.`,
  }
  figures['repository.visibility'] = ci.visibility === undefined || ci.visibility instanceof Error
    ? unknownFigure(ci.visibility?.message ?? 'the repository was not read', visibilitySource)
    : known(ci.visibility, visibilitySource)
  figures['economics.shiftSeconds'] = shippingShifts.length === 0
    ? unknownFigure('no shift record that shipped states its start and end', { paths: [SHIFTS_DIR], computation: 'Mean duration of the shifts that shipped.' })
    : known(Math.round(shippingShifts.reduce((sum, shift) => sum + (shift.seconds ?? 0), 0) / shippingShifts.length), { paths: shippingShifts.map(shift => `${shift.dir}/manifest.json`), computation: `Mean of endedAt minus startedAt over the ${shippingShifts.length} shift records that shipped a ticket: from the clone to the push.` })
  figures['economics.shippingShifts'] = known(shippingShifts.length, { paths: [SHIFTS_DIR], computation: 'Shift records that shipped at least one ticket and state their start and end.' })
  figures['economics.tokensPerShipped'] = economics.length === 0
    ? unknownFigure('no shipped ticket line records tokens', ledgerSource('Mean tokens over shipped tickets.'))
    : known(Math.round(tokensTotal / economics.length), ledgerSource(`Mean of the tokens field over the ${economics.length} shipped tickets' lines: department and review model tokens.`))
  figures['economics.secondsPerShipped'] = economics.length === 0
    ? unknownFigure('no shipped ticket line records seconds', ledgerSource('Mean seconds over shipped tickets.'))
    : known(Math.round(secondsTotal / economics.length), ledgerSource(`Mean of the seconds field over the ${economics.length} shipped tickets' lines: department and review time.`))
  figures['economics.currency'] = unknownFigure('the ledger records tokens and seconds; the route is a flat-rate subscription and no record carries a price per ticket', ledgerSource('Currency per shipped ticket.'))
  if (reviewDurations.length > 0) {
    figures['safety.reviewSecondsMin'] = known(Math.min(...reviewDurations), { paths: codeSafetyManifests, computation: 'The smallest elapsedSeconds over the manifest.json of every code-safety record.' })
    figures['safety.reviewSecondsMax'] = known(Math.max(...reviewDurations), { paths: codeSafetyManifests, computation: 'The largest elapsedSeconds over the manifest.json of every code-safety record.' })
  }
  figures['safety.records'] = known(inputs.safety.records.length, { paths: [CODE_SAFETY_DIR], computation: 'Record directories carrying a manifest.json and a findings.json.' })
  figures['safety.examinerPassed'] = known(inputs.safety.records.filter(record => isRecord(record.manifest.verifier) && record.manifest.verifier.exitCode === 0).length, { paths: codeSafetyManifests, computation: 'Code-safety records whose manifest.json states verifier.exitCode 0: the committed examiner found every cited line as cited.' })
  figures['safety.barrierRefusals'] = known(inputs.safety.records.reduce((sum, record) => sum + (num(record.manifest.denials) ?? 0), 0), { paths: codeSafetyManifests, computation: 'The sum of denials, the reads the read barrier refused, over the manifest.json of every code-safety record.' })
  figures['safety.redactedRecords'] = known(inputs.safety.records.filter(record => isRecord(record.manifest.redactions) && Array.isArray(record.manifest.redactions.files) && record.manifest.redactions.files.length > 0).length, { paths: codeSafetyManifests, computation: 'Code-safety records whose manifest.json lists under redactions.files at least one file in which key material was replaced before commit.' })
  figures['shifts.redacted'] = known(shifts.reduce((sum, shift) => sum + (shift.redacted ?? 0), 0), { paths: [SHIFTS_DIR], computation: 'The sum of redacted, the credential-shaped strings cut from each shift record.' })
  if (nodegoat.length > 0) {
    const founds = nodegoat.map(row => row.found)
    figures['safety.nodegoatRuns'] = known(nodegoat.length, { paths: [CODE_SAFETY_DIR, `${CODE_SAFETY_DIR}/targets/nodegoat.ground-truth.json`], computation: 'NodeGoat records read against the 18-issue ground truth.' })
    figures['safety.nodegoatMin'] = known(Math.min(...founds), { paths: [CODE_SAFETY_DIR, `${CODE_SAFETY_DIR}/targets/nodegoat.ground-truth.json`], computation: 'The fewest documented issues any NodeGoat record caught, by the three-line rule.' })
    figures['safety.nodegoatMax'] = known(Math.max(...founds), { paths: [CODE_SAFETY_DIR, `${CODE_SAFETY_DIR}/targets/nodegoat.ground-truth.json`], computation: 'The most documented issues any NodeGoat record caught, by the three-line rule.' })
  }
  if (ci.failure === undefined) {
    const completed = ci.runs.filter(run => run.status === 'completed')
    const latest = completed.filter(run => run.conclusion === 'success' || run.conclusion === 'failure').at(-1)
    figures['ci.completed'] = known(completed.length, ciSource(`Completed Branch CI runs of ${branch}.`))
    figures['ci.success'] = known(completed.filter(run => run.conclusion === 'success').length, ciSource('Completed runs whose conclusion is success.'))
    figures['ci.failure'] = known(completed.filter(run => run.conclusion === 'failure').length, ciSource('Completed runs whose conclusion is failure.'))
    figures['ci.cancelled'] = known(completed.filter(run => run.conclusion === 'cancelled').length, ciSource('Completed runs whose conclusion is cancelled: a later push cancelled them before a verdict.'))
    const verdicts = [...ci.shipments.values()].filter((verdict): verdict is ShipmentCi => !(verdict instanceof Error))
    figures['ci.exactShipped'] = verdicts.length < ci.shipments.size
      ? unknownFigure('the runs of a shipped commit could not be read', ciSource('Shipped commits with a run on exactly that commit.'))
      : known(verdicts.filter(verdict => verdict.exact !== null).length, ciSource('Shipped commits with a Branch CI run on exactly that commit, rather than on a later commit that contains it.'))
    figures['ci.first'] = ci.runs[0] === undefined ? unknownFigure('the branch has no run', ciSource('The first run.')) : known(ci.runs[0].createdAt, ciSource('The creation time of the branch\'s first Branch CI run.'))
    const latestSource = ciSource(`The newest run that rendered a verdict (success or failure)${latest === undefined ? '' : `, ${latest.url}`}.`)
    figures['ci.latestConclusion'] = latest === undefined ? unknownFigure('no run has rendered a verdict', latestSource) : known(latest.conclusion ?? 'none', latestSource)
    figures['ci.latestAt'] = latest === undefined ? unknownFigure('no run has rendered a verdict', latestSource) : known(latest.updatedAt, latestSource)
  } else {
    for (const id of ['ci.completed', 'ci.success', 'ci.failure', 'ci.cancelled', 'ci.exactShipped', 'ci.first', 'ci.latestConclusion', 'ci.latestAt']) {
      figures[id] = unknownFigure(`Branch CI could not be read: ${ci.failure}`, ciSource(id))
    }
  }

  const ciCounts: Record<string, number> = {}
  for (const run of ci.runs) {
    const key = run.status === 'completed' ? run.conclusion ?? 'none' : run.status
    ciCounts[key] = (ciCounts[key] ?? 0) + 1
  }
  const seeded = selfReview?.seeded
  const seededInterval = seeded !== undefined && isRecord(seeded.interval) ? seeded.interval : undefined
  const seededLow = seededInterval === undefined ? null : num(seededInterval.low)
  const seededHigh = seededInterval === undefined ? null : num(seededInterval.high)
  const seededN = seeded === undefined ? null : num(seeded.n)
  const seededCaught = seeded === undefined ? null : num(seeded.caught)

  return {
    schema: BRIEFING_SCHEMA,
    asOf,
    repository: { name: CI_REPOSITORY, branch, url: `https://github.com/${CI_REPOSITORY}/tree/${branch}` },
    figures,
    divisions: known(divisionRows(roster), { paths: ROSTER_SOURCE, computation: 'Per division: seats defined; seats with an attributed session or a ledger line; seats whose status is active.' }),
    routes: known(
      Object.entries(roster.evidence.routes)
        .map(([route, sessions]) => ({ route, sessions }))
        .sort((left, right) => right.sessions - left.sessions || left.route.localeCompare(right.route)),
      { paths: ROSTER_SOURCE, computation: 'evidence.routes: the recorded sessions of the committed records per provider route, attributed to a seat or not.' },
    ),
    shipped: known(shipped, { paths: [LEDGER_PATH, TICKETS_DIR, SHIFTS_DIR, ROSTER_PATH], computation: 'The line that shipped each ticket any line of which names a shipped commit, with the queue file\'s title, the seat\'s name, the shift record\'s base commit and the review session\'s tool calls.' }),
    shifts: known(shifts, { paths: [SHIFTS_DIR], computation: 'Each shift record\'s result.json and manifest.json: the tickets worked, the tickets shipped, the start and the end, and the reason a partial record gives.' }),
    pilot: known(pilot, pilotSource(
      'Every cycle the branch names and every shift record outside all of them; a cycle\'s shifts are those its record lists, or the shift records that '
      + 'start between its start and the next cycle\'s (and before its shift step ended, when its captured log states that step); per unit, the '
      + 'tickets its shift records name, the ledger lines of those shifts by status, the named tickets no line records, and the lines\' tokens.',
    )),
    ci: ci.failure === undefined
      ? known({ runs: ci.runs, counts: ciCounts }, ciSource(`Every Branch CI run of ${branch}, oldest first, with its conclusion.`))
      : unknownFigure(`Branch CI could not be read: ${ci.failure}`, ciSource(`Every Branch CI run of ${branch}.`)),
    bench: {
      experiments: known(experiments, { paths: [PROVING_GROUND_DIR, `${PROVING_GROUND_DIR}/folds`], computation: 'Each frozen pair\'s result.json: delta, interval and verdict as recorded, certificates per arm as the sum of each cell\'s rate times its pairs, and a re-read fold\'s reading when one exists.' }),
      pooled: known(pooledRows(inputs.bench.folds), { paths: [`${PROVING_GROUND_DIR}/folds`], computation: 'Folds that pool several frozen pairs of one plan, as recorded.' }),
    },
    safety: {
      recall: known(recall, { paths: [CODE_SAFETY_DIR, `${CODE_SAFETY_DIR}/targets`], computation: 'Each record\'s findings.json read against its target\'s ground truth: an issue is found when a finding cites its file within three lines of its range or of an alsoAt location.' }),
      tiers: tiers === undefined
        ? unknownFigure('the comparison or the NodeGoat ground truth is missing', { paths: [COMPARISON_DIR], computation: 'The three-tier comparison.' })
        : known(tiers, { paths: [COMPARISON_DIR, `${CODE_SAFETY_DIR}/targets/nodegoat.ground-truth.json`], computation: 'Each tier\'s findings read against the ground truth by the same three-line rule; the single model\'s cost and time from its own metadata; the enterprise tier\'s from its record\'s manifest.' }),
      seeded: selfReview === undefined || seededN === null || seededCaught === null || seededLow === null || seededHigh === null
        ? unknownFigure('no record of a seeded copy carries a complete seeded-recall reading', { paths: [CODE_SAFETY_DIR], computation: 'The seeded-recall reading.' })
        : known({
          record: selfReview.name,
          planted: seededN,
          caught: seededCaught,
          interval: { low: seededLow, high: seededHigh },
          byClass: (Array.isArray(seeded?.byClass) ? seeded.byClass : []).filter(isRecord).map(entry => ({ cwe: str(entry.cwe) ?? '', category: str(entry.category) ?? '', n: num(entry.n) ?? 0, caught: num(entry.caught) ?? 0 })),
        }, { paths: [`${CODE_SAFETY_DIR}/${selfReview.name}/seeded-recall.json`], computation: 'The record\'s seeded-recall reading as seeded-recall.mjs wrote it: planted canaries caught by the three-line rule, with a Wilson 95% interval.' }),
    },
    governance: {
      terms: known(termsRows(inputs.sessions), { paths: [PROVING_GROUND_DIR, CODE_SAFETY_DIR, SHIFTS_DIR, INTAKE_DIR], computation: 'Session logs under each family\'s sessions/ directories, and those carrying a dataUse/terms event.' }),
      signoffs: known(signoffRows(inputs.shifts, inputs.intakes, inputs.sessions.intake), {
        paths: [SHIFTS_DIR, INTAKE_DIR],
        computation: 'Every signoff/recorded event in the shift and intake records\' session logs, with its transition, principal id, declared kind '
          + 'and time, and every entry of the decisions their result.json states, with its transition, principal id and kind.',
      }),
      reviews: known(reviewRows(inputs.shifts), { paths: [SHIFTS_DIR], computation: 'Per shift: its review-*.jsonl session logs and the tool/call events they record.' }),
      reviewRecord: known(reviewRecord, {
        paths: [LEDGER_PATH, SHIFTS_DIR],
        computation: 'Every ticket line whose review approved or rejected, with the reviewer it names and the route, model and tool calls of its review log; '
          + 'then every review log of a shift record no ticket line names, with the verdict line of its last answer; a rejection is overturned when a '
          + 'later line of the ticket shipped, and a shipped approval lists the later commits that name its commit and change a file in a directory it changed.',
      }),
    },
    economics: {
      tickets: known(economics, ledgerSource('The tokens and seconds fields of each shipped ticket\'s line: the department\'s and the review\'s model tokens and time.')),
    },
    inputs: [...inputs.digests].sort((left, right) => left.path.localeCompare(right.path)),
  }
}

/**
 * Serialize the briefing: two-space JSON with a trailing newline.
 * @param briefing - the briefing.
 * @returns the file's bytes.
 */
export function serializeBriefing(briefing: Briefing): string {
  return `${JSON.stringify(briefing, null, 2)}\n`
}

// ---------------------------------------------------------------------------
// Reading the repository
// ---------------------------------------------------------------------------

function listDirs(root: string, dir: string): string[] {
  const absolute = join(root, dir)
  if (!existsSync(absolute)) return []
  return readdirSync(absolute).filter(name => statSync(join(absolute, name)).isDirectory()).sort()
}

/**
 * Read one session log for the governance figures. A line that is not JSON is skipped.
 * @param root - repository root.
 * @param file - repository-relative path.
 * @param book - where the file's digest is recorded.
 * @returns the scan.
 */
function scanSession(root: string, file: string, book: DigestBook): SessionScan {
  const scan: SessionScan = { file, dataUseTerms: false, toolCalls: 0, signoffs: [] }
  const content = readFileSync(join(root, file), 'utf8')
  book.add(file, content)
  let answer: string | undefined
  for (const raw of content.split('\n')) {
    if (raw === '') continue
    let event: unknown
    try {
      event = JSON.parse(raw)
    } catch {
      // A torn last line of a log that was cut mid-write carries no event; nothing else reads it.
      continue
    }
    if (!isRecord(event)) continue
    if (event.type === 'dataUse/terms') scan.dataUseTerms = true
    else if (event.type === 'tool/call') scan.toolCalls += 1
    else if (event.type === 'request/header' && scan.request === undefined) {
      const request = requestOf(event.data)
      if (request !== undefined) scan.request = request
    }
    else if (event.type === 'assistant/message') answer = answerOf(event.data) ?? answer
    else if (event.type === 'signoff/recorded' && isRecord(event.data) && isRecord(event.data.principal)) {
      const { principal } = event.data
      scan.signoffs.push({
        transition: str(event.data.transition) ?? 'unknown',
        principal: str(principal.id) ?? 'unknown',
        kind: str(principal.kind) ?? 'unknown',
        time: num(event.time) ?? 0,
      })
    }
  }
  const verdict = REVIEW_LOG.test(file) && answer !== undefined ? VERDICT_LINE.exec(answer)?.[1]?.toLowerCase() : undefined
  if (verdict === 'approve' || verdict === 'reject') scan.verdict = verdict
  return scan
}

/** The verdict line a reviewer's answer opens with, as the shift engine reads it. */
const VERDICT_LINE = /^[ \t]*verdict:[ \t]*(approve|reject)[ \t]*$/im

/**
 * @param data - a `request/header` event's data.
 * @returns the route and model its header's config names, or `undefined` when it names none.
 */
function requestOf(data: unknown): { route: string; model: string } | undefined {
  const config = isRecord(data) && isRecord(data.header) && isRecord(data.header.config) ? data.header.config : undefined
  const route = str(config?.provider)
  const model = str(config?.model)
  return route === null || model === null ? undefined : { route, model }
}

/**
 * @param data - an `assistant/message` event's data.
 * @returns the message's text blocks joined, or `undefined` when it has none.
 */
function answerOf(data: unknown): string | undefined {
  const content = isRecord(data) && isRecord(data.message) && Array.isArray(data.message.content) ? data.message.content : []
  const texts = content.filter(isRecord).flatMap(block => (block.type === 'text' && typeof block.text === 'string' ? [block.text] : []))
  return texts.length === 0 ? undefined : texts.join('')
}

function scanSessions(root: string, familyDir: string, book: DigestBook): SessionScan[] {
  const scans: SessionScan[] = []
  for (const record of listDirs(root, familyDir)) {
    const dir = `${familyDir}/${record}/sessions`
    if (!existsSync(join(root, dir))) continue
    for (const name of readdirSync(join(root, dir)).filter(entry => entry.endsWith('.jsonl')).sort()) scans.push(scanSession(root, `${dir}/${name}`, book))
  }
  return scans
}

/**
 * Reassemble the cycle logs and the scheduler's log the live transcript capture holds. Each log's chunks live under
 * `<capture>/<first capture date>/enterprise-cycles_<file name>-<hash>/e<epoch>/<capture date>/<sequence>.log.gz` and hold
 * whole lines, so the log is their concatenation in epoch and sequence order.
 * @param root - repository root.
 * @param book - where each chunk's digest is recorded.
 * @returns the logs, by capture directory.
 */
function readCapturedLogs(root: string, book: DigestBook): CapturedLog[] {
  const logs: CapturedLog[] = []
  for (const date of listDirs(root, CAPTURED_CYCLE_LOGS)) {
    for (const key of listDirs(root, `${CAPTURED_CYCLE_LOGS}/${date}`)) {
      const name = /^enterprise-cycles_(scheduler\.log|cycle-\d{8}T\d{6}Z\.log)-[0-9a-f]+$/.exec(key)?.[1]
      if (name === undefined) continue
      const dir = `${CAPTURED_CYCLE_LOGS}/${date}/${key}`
      const chunks: { epoch: number; seq: number; path: string }[] = []
      for (const epoch of listDirs(root, dir).filter(entry => /^e\d+$/.test(entry))) {
        for (const day of listDirs(root, `${dir}/${epoch}`)) {
          for (const file of readdirSync(join(root, dir, epoch, day)).filter(entry => /^\d+\.log\.gz$/.test(entry))) {
            chunks.push({ epoch: Number(epoch.slice(1)), seq: Number.parseInt(file, 10), path: `${dir}/${epoch}/${day}/${file}` })
          }
        }
      }
      chunks.sort((left, right) => left.epoch - right.epoch || left.seq - right.seq)
      const text = chunks.map((chunk) => {
        const bytes = readFileSync(join(root, chunk.path))
        book.add(chunk.path, bytes)
        return gunzipSync(bytes).toString('utf8')
      }).join('')
      logs.push({ name, dir, text })
    }
  }
  return logs
}

/**
 * Read every input of the briefing from the repository at `root`.
 * @param root - repository root.
 * @param commits - the enterprise commits on the branch, from {@link enterpriseCommits}.
 * @param scripts - when the cycle and scheduler scripts reached the branch, from {@link scriptHistory}.
 * @param followUpsOf - the later commits that rework each shipped commit, from {@link followUpCommits}; omitted, none are read.
 * @returns the inputs.
 * @throws when the generated roster is missing, because every seat figure derives from it, or when a cycle record is
 * unreadable, because the pilot's rows would silently lose that cycle.
 */
export function readInputs(
  root: string,
  commits: EnterpriseCommit[],
  scripts: ScriptHistory = { cycle: null, scheduler: null },
  followUpsOf?: (shipped: readonly string[]) => Record<string, FollowUpCommit[]>,
): BriefingInputs {
  const book = new DigestBook()
  const read = (path: string): string => {
    const content = readFileSync(join(root, path), 'utf8')
    book.add(path, content)
    return content
  }
  const readJson = (path: string): unknown => JSON.parse(read(path))
  const optionalJson = (path: string): Record<string, unknown> | undefined => {
    if (!existsSync(join(root, path))) return undefined
    const value = readJson(path)
    return isRecord(value) ? value : undefined
  }
  const peekJson = (path: string): Record<string, unknown> | undefined => {
    if (!existsSync(join(root, path))) return undefined
    const value: unknown = JSON.parse(readFileSync(join(root, path), 'utf8'))
    return isRecord(value) ? value : undefined
  }
  if (!existsSync(join(root, ROSTER_PATH))) throw new Error(`enterprise-briefing: ${ROSTER_PATH} is missing; run pnpm run roster first`)
  const roster = readJson(ROSTER_PATH) as Roster
  read(LEDGER_PATH)
  const ledger = readLedger(join(root, LEDGER_PATH))
  const tickets = loadTickets(root)
  for (const { file } of tickets) read(file)

  const shifts = listDirs(root, SHIFTS_DIR).flatMap((name) => {
    const dir = `${SHIFTS_DIR}/${name}`
    const result = optionalJson(`${dir}/result.json`)
    if (result === undefined) return []
    const manifest = optionalJson(`${dir}/manifest.json`)
    const sessionsDir = `${dir}/sessions`
    const sessions = existsSync(join(root, sessionsDir))
      ? readdirSync(join(root, sessionsDir)).filter(entry => entry.endsWith('.jsonl')).sort().map(entry => scanSession(root, `${sessionsDir}/${entry}`, book))
      : []
    return [{ dir, result, ...manifest === undefined ? {} : { manifest }, sessions }]
  })
  const intakes = listDirs(root, INTAKE_DIR).flatMap((name) => {
    const result = optionalJson(`${INTAKE_DIR}/${name}/result.json`)
    return result === undefined ? [] : [{ dir: `${INTAKE_DIR}/${name}`, result }]
  })
  const shiftStarts = existsSync(join(root, SHIFT_STARTS_PATH))
    ? read(SHIFT_STARTS_PATH).split('\n').filter(line => line.trim() !== '').flatMap((line) => {
      const value: unknown = JSON.parse(line)
      if (!isRecord(value) || value.type !== 'shift-start' || typeof value.shift !== 'string' || typeof value.at !== 'string') return []
      const tickets = Array.isArray(value.tickets) ? value.tickets.filter((ticket): ticket is string => typeof ticket === 'string') : []
      return [{ shift: value.shift, at: value.at, tickets }]
    })
    : []
  const { records: cycleRecords, unreadable } = readCycleRecords(root)
  if (unreadable.length > 0) throw new Error(`enterprise-briefing: unreadable cycle records: ${unreadable.map(entry => `${entry.path} (${entry.reason})`).join('; ')}`)
  for (const record of cycleRecords) read(`${CYCLES_DIR}/${record.cycle}.json`)
  const logs = readCapturedLogs(root, book)

  const environments = listDirs(root, BENCH_ENVIRONMENTS_DIR).flatMap((name) => {
    const task = optionalJson(`${BENCH_ENVIRONMENTS_DIR}/${name}/task.json`)
    if (task === undefined) return []
    return [{ id: str(task.id) ?? name, tier: num(task.tier) ?? 0, domain: str(task.domain) ?? 'unknown', heldOut: task.heldOut === true }]
  })
  const benchDirs = listDirs(root, PROVING_GROUND_DIR).filter(name => existsSync(join(root, PROVING_GROUND_DIR, name, 'manifest.json')))
  const results = benchDirs.flatMap((name) => {
    const file = `${PROVING_GROUND_DIR}/${name}/result.json`
    const value = peekJson(file)
    if (value === undefined || !isRecord(value.result) || typeof value.result.verdict !== 'string') return []
    read(file)
    return [{ file, value }]
  })
  const foldsDir = `${PROVING_GROUND_DIR}/folds`
  const folds = existsSync(join(root, foldsDir))
    ? readdirSync(join(root, foldsDir)).filter(name => name.endsWith('.json')).sort().flatMap((name) => {
      const value = optionalJson(`${foldsDir}/${name}`)
      return value === undefined ? [] : [{ file: `${foldsDir}/${name}`, value }]
    })
    : []

  const findingsOf = (path: string): FindingInput[] => {
    const value = readJson(path)
    const list = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.findings) ? value.findings : []
    return list.filter(isRecord).flatMap(entry => (typeof entry.file === 'string' && typeof entry.line === 'number' ? [{ file: entry.file, line: entry.line }] : []))
  }
  const safetyRecords = listDirs(root, CODE_SAFETY_DIR)
    .filter(name => /^\d{4}-\d{2}-\d{2}-/.test(name) && existsSync(join(root, CODE_SAFETY_DIR, name, 'manifest.json')) && existsSync(join(root, CODE_SAFETY_DIR, name, 'findings.json')))
    .map((name) => {
      const manifest = optionalJson(`${CODE_SAFETY_DIR}/${name}/manifest.json`) ?? {}
      const seeded = optionalJson(`${CODE_SAFETY_DIR}/${name}/seeded-recall.json`)
      return { name, manifest, findings: findingsOf(`${CODE_SAFETY_DIR}/${name}/findings.json`), ...seeded === undefined ? {} : { seeded } }
    })
  const groundTruths: BriefingInputs['safety']['groundTruths'] = {}
  for (const target of ['nodegoat', 'dvja']) {
    const value = optionalJson(`${CODE_SAFETY_DIR}/targets/${target}.ground-truth.json`)
    if (value === undefined || !Array.isArray(value.issues)) continue
    groundTruths[target] = {
      issues: value.issues.filter(isRecord).map(issue => ({
        id: str(issue.id) ?? '',
        ...typeof issue.category === 'string' ? { category: issue.category } : {},
        file: str(issue.file) ?? '',
        lines: (Array.isArray(issue.lines) ? issue.lines : [0, 0]) as [number, number],
        ...Array.isArray(issue.alsoAt) ? { alsoAt: issue.alsoAt.filter(isRecord).map(at => ({ file: str(at.file) ?? '', lines: (Array.isArray(at.lines) ? at.lines : [0, 0]) as [number, number] })) } : {},
      })),
      ...typeof value.revision === 'string' ? { revision: value.revision } : {},
      ...typeof value.target === 'string' ? { target: value.target } : {},
    }
  }
  const comparisonValue = optionalJson(`${COMPARISON_DIR}/comparison.json`)
  const comparison = comparisonValue === undefined || !existsSync(join(root, COMPARISON_DIR, 't0-semgrep-findings.json')) || !existsSync(join(root, COMPARISON_DIR, 't1-single-model-findings.json'))
    ? undefined
    : {
      value: comparisonValue,
      semgrep: findingsOf(`${COMPARISON_DIR}/t0-semgrep-findings.json`),
      singleModel: findingsOf(`${COMPARISON_DIR}/t1-single-model-findings.json`),
      singleModelMeta: optionalJson(`${COMPARISON_DIR}/t1-single-model-meta.json`) ?? {},
    }

  const shippedCommits = [...new Set(ticketLines(ledger).flatMap(line => (line.shipped === null ? [] : [line.shipped.commit])))]
  const sessions: BriefingInputs['sessions'] = {
    bench: scanSessions(root, PROVING_GROUND_DIR, book),
    codeSafety: scanSessions(root, CODE_SAFETY_DIR, book),
    shifts: shifts.flatMap(shift => shift.sessions),
    intake: scanSessions(root, INTAKE_DIR, book),
  }
  return {
    roster,
    ledger,
    tickets,
    shifts,
    intakes,
    commits,
    cycleRecords,
    shiftStarts,
    logs,
    scripts,
    bench: { environments, results, folds, records: benchDirs.length },
    safety: { records: safetyRecords, groundTruths, ...comparison === undefined ? {} : { comparison } },
    sessions,
    digests: book.summarize(),
    ...followUpsOf === undefined ? {} : { followUps: followUpsOf(shippedCommits) },
  }
}

/**
 * The later commits on the checked-out branch that rework each shipped commit: a commit after it whose message names
 * it by a prefix of at least seven characters and that changes a file in a directory the shipped commit changed. Two
 * such commits with the same subject and files, a cherry-pick beside its original, count once, the older kept.
 * @param root - repository root.
 * @param shipped - the shipped commits.
 * @returns the follow-ups per shipped commit, oldest first; empty for a commit git cannot read here.
 */
export function followUpCommits(root: string, shipped: readonly string[]): Record<string, FollowUpCommit[]> {
  const git = (...args: string[]): string | undefined => {
    try {
      return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    } catch {
      // A commit this clone does not hold, or no git history at all: nothing reworks what cannot be read.
      return undefined
    }
  }
  const dirsOf = (commit: string): Set<string> => new Set((git('show', '--name-only', '--format=', commit) ?? '').split('\n').filter(path => path !== '').map(path => dirname(path)))
  const byCommit: Record<string, FollowUpCommit[]> = {}
  for (const commit of shipped) {
    const dirs = dirsOf(commit)
    const log = git('log', '--reverse', '--format=%H%x1f%cI%x1f%s%x1f%B%x1e', `--grep=${commit.slice(0, 7)}`, `${commit}..HEAD`)
    const named = new RegExp(`\\b${commit.slice(0, 7)}[0-9a-f]*\\b`)
    const seen = new Set<string>()
    byCommit[commit] = (log ?? '').split('\x1e').map(entry => entry.trim()).filter(entry => entry !== '').flatMap((entry) => {
      const [sha = '', at = '', subject = '', body = ''] = entry.split('\x1f')
      const match = named.exec(body)
      if (match === null || !commit.startsWith(match[0])) return []
      const changed = [...dirsOf(sha)]
      const key = `${subject}\x1f${(git('show', '--name-only', '--format=', sha) ?? '').trim()}`
      if (!changed.some(dir => dirs.has(dir)) || seen.has(key)) return []
      seen.add(key)
      return [{ commit: sha, at: new Date(at).toISOString(), subject }]
    })
  }
  return byCommit
}

/**
 * The enterprise's own commits on the checked-out branch: every `chore(enterprise): cycle-…` and `chore(enterprise): shift …` subject.
 * @param root - repository root.
 * @returns the commits, oldest first; empty when git cannot be read.
 */
export function enterpriseCommits(root: string): EnterpriseCommit[] {
  let output: string
  try {
    output = execFileSync('git', ['-C', root, 'log', '--format=%H%x1f%cI%x1f%s', '-E', '--grep=^chore\\(enterprise\\): (cycle-|shift )'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  } catch {
    // A checkout without git history (an exported tree) names no cycle; the cycle figures then count none.
    return []
  }
  return output.split('\n').filter(line => line !== '').map((line) => {
    const [sha = '', at = '', subject = ''] = line.split('\x1f')
    return { sha, at: new Date(at).toISOString(), subject }
  }).reverse()
}

/**
 * When the cycle and scheduler scripts first reached the checked-out branch: the committer time of the oldest commit
 * that added each (`git log --diff-filter=A`).
 * @param root - repository root.
 * @returns the times; `null` for a script git cannot date here, such as in a shallow clone.
 */
export function scriptHistory(root: string): ScriptHistory {
  const added = (path: string): string | null => {
    let output: string
    try {
      output = execFileSync('git', ['-C', root, 'log', '--diff-filter=A', '--format=%cI', '--', path], { encoding: 'utf8' })
    } catch {
      // A checkout without git history cannot date the script; the pilot then states the starter as unknown.
      return null
    }
    const oldest = output.trim().split('\n').filter(line => line !== '').at(-1)
    return oldest === undefined ? null : new Date(oldest).toISOString()
  }
  return { cycle: added(CYCLE_SCRIPT), scheduler: added(SCHEDULER_SCRIPT) }
}

/**
 * Git ancestry through `git merge-base --is-ancestor`.
 * @param root - repository root.
 * @returns the reader.
 */
export function gitReader(root: string): GitReader {
  return {
    isAncestor: (ancestor, descendant) => {
      try {
        execFileSync('git', ['-C', root, 'merge-base', '--is-ancestor', ancestor, descendant], { stdio: 'ignore' })
        return true
      } catch {
        // Exit 1 is "not an ancestor"; any other exit is a commit this clone does not hold, which contains nothing here either.
        return false
      }
    },
  }
}

/**
 * Write a file only when its bytes change.
 * @param file - absolute path.
 * @param content - the bytes.
 * @returns whether the file changed.
 */
export function writeIfChanged(file: string, content: string): boolean {
  if (existsSync(file) && readFileSync(file, 'utf8') === content) return false
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content)
  return true
}

/**
 * Build and write the briefing under `root`.
 * @param root - repository root.
 * @param github - the API reader.
 * @param git - the ancestry reader.
 * @returns the briefing and whether the fixture's bytes changed.
 */
export async function publishBriefing(
  root: string,
  github: GitHubReader,
  git: GitReader,
): Promise<{ briefing: Briefing; changed: boolean }> {
  const inputs = readInputs(root, enterpriseCommits(root), scriptHistory(root), shipped => followUpCommits(root, shipped))
  const ci = await readCi(github, git, shipmentsOf(inputs), DEFAULT_CI_BRANCH)
  const briefing = buildBriefing(inputs, ci)
  return { briefing, changed: writeIfChanged(join(root, BRIEFING_FIXTURE), serializeBriefing(briefing)) }
}

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${resolve(process.argv[1])}`
if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const args = process.argv.slice(2).filter(arg => arg !== '--')
  const unknownArg = args.find(arg => arg !== '--summary' && arg !== '--check-summary')
  if (unknownArg !== undefined) {
    console.error(`enterprise-briefing: unknown argument ${unknownArg}; usage: enterprise-briefing.ts [--summary | --check-summary]`)
    process.exit(2)
  }
  const { briefing, changed } = await publishBriefing(root, githubReader(), gitReader(root))
  const ciNote = briefing.ci.value === null ? `CI unknown (${briefing.ci.unknown})` : `${briefing.ci.value.runs.length} Branch CI runs read`
  console.log(`enterprise-briefing: ${changed ? `wrote ${BRIEFING_FIXTURE}` : 'kept'}; as of ${briefing.asOf}; ${ciNote}`)
  const { CLAIMS_PATH, checkClaims } = await import('./enterprise-briefing-claims.ts')
  let claims: { problems: string[]; register: string }
  try {
    claims = checkClaims(root, briefing.asOf)
  } catch (error: unknown) {
    claims = { problems: [`the page could not be rendered: ${error instanceof Error ? error.message : String(error)}`], register: '' }
  }
  for (const problem of claims.problems) console.error(`enterprise-briefing: ${problem}`)
  if (claims.problems.length > 0) process.exitCode = 1
  else console.log(`enterprise-briefing: ${writeIfChanged(join(root, CLAIMS_PATH), claims.register) ? `wrote ${CLAIMS_PATH}` : 'claims register kept'}`)
  if (args.length > 0) {
    const { checkSummary, summaryFiles } = await import('./enterprise-briefing-summary.ts')
    if (args.includes('--summary')) {
      const written = summaryFiles(briefing)
        .filter(({ path, content }) => writeIfChanged(join(root, path), content))
        .map(({ path }) => path)
      console.log(`enterprise-briefing: ${written.join(', ') || 'summary kept'}; re-record the pair with pnpm run verify-translation-pairing --write docs/client/daliesk-executive-summary.md`)
    }
    if (args.includes('--check-summary')) {
      const stale = checkSummary(root, briefing)
      if (stale.length > 0) {
        console.error(`enterprise-briefing: ${stale.join(' and ')} differ from the rendering of ${BRIEFING_FIXTURE}; run with --summary`)
        process.exit(1)
      }
      console.log('enterprise-briefing: the executive summary matches the briefing')
    }
  }
}
