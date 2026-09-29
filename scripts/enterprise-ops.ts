#!/usr/bin/env node
/**
 * The enterprise's operations snapshot: every agent working now, what needs
 * attention and why, and the whole organisation's day, folded from every
 * activity source on the enterprise's machine into one JSON document, the
 * `OpsSnapshot` of `apps/command-deck/deck/contract.ts`.
 *
 * The sources are the ledger, the roster and the ticket queue in the checkout;
 * the cycle logs and the scheduler's log; the branch history's cycle commits;
 * the shifts' and intakes' scratch directories and their session logs; the
 * departments' and the operator's Claude Code transcripts; the Proving Ground
 * bench's live runs and records; the process table; Branch CI on GitHub; and
 * the host's memory and disks. Each is read by `scripts/enterprise-ops-sources.ts`;
 * one that cannot be read is listed as `unknown` with the reason, every figure
 * counted from it is `null`, and nothing is inferred in its place.
 *
 * `pnpm run enterprise:ops` prints the snapshot; `--out` writes it, `--fixture`
 * writes the deck's `public/fixtures/ops.json`, and `--push` sends it to the
 * mirror relay (`INGEST_URL`, `INGEST_TOKEN_FILE`) as `/ops` with its activity
 * frames as the `ops` event stream. `scripts/enterprise-ops-live.sh` runs it on
 * an interval.
 *
 * @module enterprise-ops
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { gzipSync } from 'node:zlib'

import {
  OPS_SCHEMA,
  SEVERITY_ORDER,
  type OpsAgent,
  type OpsAgentKind,
  type OpsAttention,
  type OpsBigPicture,
  type OpsCycle,
  type OpsCycleStep,
  type OpsHeartbeat,
  type OpsHour,
  type OpsLink,
  type OpsRun,
  type OpsRunOutcome,
  type OpsShift,
  type OpsShiftTicket,
  type OpsShipped,
  type OpsShippedTicket,
  type OpsSnapshot,
  type OpsSource,
  type OpsSourceId,
  type RunEvent,
  type Severity,
} from '../apps/command-deck/deck/contract.ts'
import { readCycleRecords, type CycleRecord } from './enterprise-cycle-record.ts'
import { parseLedgerLine, ticketStatus, type LedgerLine, type TicketLine } from './enterprise-ledger.ts'
import {
  claudeProjectName,
  currentCycleStep,
  cyclesFromHistory,
  diskUsage,
  emptyTranscript,
  foldHarnessSession,
  foldProgramLedger,
  foldTranscript,
  msOf,
  parseCaptureLog,
  parseCiJobs,
  parseCiRuns,
  parseCycleLog,
  parseJsonl,
  parseMeminfo,
  parseSchedulerLog,
  pendingCycleSteps,
  newestCapture,
  publicLine,
  readFrom,
  readProcesses,
  reviewVerdictOf,
  type CiJob,
  type CiRun,
  type CycleLog,
  type Frame,
  type HarnessSessionFacts,
  type MemoryReading,
  type ProcessInfo,
  type TranscriptState,
} from './enterprise-ops-sources.ts'
import { readRequestStatuses, type RequestState } from './enterprise-requests.ts'
import { hostlessJson, hostlessText } from '../apps/command-deck/deck/host-paths.ts'
import { sessionFilesIn } from './session-records.ts'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The GitHub repository whose pages the snapshot links to and whose Branch CI it reads. */
export const OPS_REPOSITORY = 'LBJLincoln/deepseek-harness'

/** The branch the enterprise ships to. */
export const OPS_BRANCH = 'claude/coding-agent-harness-u9l4gt'

/** The workflow whose runs are Branch CI. */
const CI_WORKFLOW = 'branch-ci.yml'

/** The deck fixture `--fixture` writes, relative to the repository root. */
export const OPS_FIXTURE = 'apps/command-deck/public/fixtures/ops.json'

/** The window the snapshot's day covers. */
const WINDOW_MS = 24 * 60 * 60 * 1000

/** How far back the activity frames reach. */
const ACTIVITY_MS = 10 * 60 * 1000

/** The most activity frames one snapshot carries, newest kept. */
const ACTIVITY_LIMIT = 300

/** How many shipped commits the big picture lists. */
const SHIPPED_LIMIT = 10

/** Disk use at which the attention queue reports pressure, by severity. */
const DISK_PRESSURE: readonly [Severity, number][] = [['critical', 95], ['high', 90], ['medium', 85]]

/** Available memory below which the attention queue reports pressure, by severity. */
const MEMORY_PRESSURE: readonly [Severity, number][] = [['critical', 5], ['high', 10]]

/** Swap use above which the attention queue reports memory pressure. */
const SWAP_PRESSURE_PCT = 50

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * The format of the collector's state file. The state caches folds of sources
 * that may never change again, such as a finished agent's transcript, so a
 * change to what a fold records bumps it; a state file of another format is
 * discarded, and every source is read again from its start.
 */
export const OPS_STATE_FORMAT = 2

/** What the collector keeps between runs: incremental transcript reads, committed-record facts, and Branch CI reads. */
export interface OpsState {
  /** The {@link OPS_STATE_FORMAT} the state was folded under. */
  format: typeof OPS_STATE_FORMAT
  transcripts: Record<string, TranscriptState>
  records: Record<string, { size: number; facts: RecordFacts }>
  ci?: { fetchedAt: number; runs: CiRun[]; jobs: Record<string, CiJob[]>; error?: string; errorAt?: number }
  /** The newest activity frame `--push` sent, epoch milliseconds. */
  pushedUntil?: number
}

/** The facts the timeline needs from a committed session record, which never changes once written. */
interface RecordFacts {
  sessionId: string
  createdAt?: number
  lastAt?: number
  certified: boolean
  goalEnded: boolean
}

/** Reads one GitHub REST path and returns the decoded body; throws on a failed read. */
export type GitHubJson = (path: string) => Promise<unknown>

/** Everything the collector reads, so a test substitutes each source. */
export interface OpsInputs {
  /** Repository checkout: the ledger, roster, tickets and records, and the git history. */
  root: string
  now: Date
  producer: OpsSnapshot['producer']
  intervalSeconds?: number
  /** Where the scheduler writes each cycle's log and its own `scheduler.log`. */
  cyclesDir: string
  /** The shifts' and intakes' scratch root. */
  scratch: string
  /** Claude Code's transcript root, `~/.claude/projects`. */
  claudeProjects: string
  /** The operator's working tree, whose Claude Code sessions and background agents are the operator's agents. */
  operatorTree: string
  /** Checkouts whose `.proving-ground/runs` hold live bench runs. */
  benchRoots: readonly string[]
  /** The nightly bench loop's output. */
  benchLog: string
  branch: string
  /** No event for this long marks a running agent stuck. */
  stuckMs: number
  /** No cycle started for this long marks the scheduler stale. */
  staleMs: number
  /** A shift's scratch run with no process and no record, silent for this long, is abandoned. */
  abandonMs: number
  /** The state file the operations loop rewrites on every tick, whose age is the loop's newest run. */
  opsLoopState: string
  /** Branch CI is re-read when the cached read is older than this. */
  ciMaxAgeMs: number
  state: OpsState
  /** Absent: Branch CI is not read and reported unknown. */
  github?: GitHubJson
  processes: () => ProcessInfo[] | undefined
  alive: (pid: number) => boolean
  memory: () => MemoryReading | undefined
  disks: () => { mount: string; usedPct: number; freeBytes: number }[]
  /** Runs git in `root`; `undefined` when it fails. */
  git: (args: readonly string[]) => string | undefined
}

// ---------------------------------------------------------------------------
// Small readers
// ---------------------------------------------------------------------------

function readText(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    // Missing or unreadable: the caller reports the source that needed it.
    return undefined
  }
}

function readJson(file: string): unknown {
  const text = readText(file)
  if (text === undefined) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    // A torn or hand-edited file: the caller reports it as unreadable.
    return undefined
  }
}

function listDir(dir: string): string[] | undefined {
  try {
    return readdirSync(dir)
  } catch {
    // Missing or unreadable: the caller decides whether that is an unknown or an empty source.
    return undefined
  }
}

function mtimeOf(file: string): number | undefined {
  try {
    return statSync(file).mtimeMs
  } catch {
    // Gone since it was listed.
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

/**
 * A path under the home directory written from `~`, as a published snapshot names it.
 * @param path - An absolute path.
 * @returns The path, its home prefix replaced by `~`.
 */
function homePath(path: string): string {
  const home = homedir()
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

function githubUrl(path: string): string {
  return `https://github.com/${OPS_REPOSITORY}/${path}`
}

function commitLink(commit: string): OpsLink {
  return { label: `commit ${commit.slice(0, 9)}`, url: githubUrl(`commit/${commit}`) }
}

/**
 * A link as a collector finds it: a published link, or a file on this machine
 * (`path`), which {@link publishLink} names by its label alone.
 */
type MachineLink = OpsLink & { path?: string }

/**
 * The link a snapshot carries: a GitHub page as it is, a file on this machine
 * by its label alone, with the label cleared of the machine's absolute paths,
 * so no path of the producing machine reaches the screen or the relay.
 * @param link - The link as collected.
 * @returns The published link.
 */
function publishLink(link: MachineLink): OpsLink {
  return { label: hostlessText(link.label), ...link.url === undefined ? {} : { url: link.url } }
}

/**
 * The committed record of one enterprise cycle, named by the cycle's id.
 * @param branch - The branch the records are committed to.
 * @param cycle - `cycle-20260928T221301Z`.
 * @param committed - Whether `data/enterprise/cycles/<cycle>.json` is committed.
 * @returns A link to the record, or the id alone while no record is committed.
 */
function cycleLink(branch: string, cycle: string, committed: boolean): OpsLink {
  return committed ? { label: cycle, url: githubUrl(`blob/${branch}/data/enterprise/cycles/${cycle}.json`) } : { label: cycle }
}

function blobLink(branch: string, path: string, line?: number): OpsLink {
  return {
    label: line === undefined ? path : `${basename(path)} line ${line}`,
    url: githubUrl(`blob/${branch}/${path}${line === undefined ? '' : `#L${line}`}`),
  }
}

// ---------------------------------------------------------------------------
// The roster, the ledger and the queue
// ---------------------------------------------------------------------------

interface RosterSeat {
  id: string
  name: string
  division: string
  source: string
  status: string
  occupied: boolean
}

interface RosterRead {
  /** When the roster was computed, epoch milliseconds, when it says. */
  generatedAt?: number
  divisions: { id: string; name: string }[]
  seats: Map<string, RosterSeat>
}

/**
 * @param root - The checkout.
 * @returns The roster's divisions and seats, or `undefined` when `data/enterprise/roster.json` cannot be read.
 */
function readRoster(root: string): RosterRead | undefined {
  const raw = readJson(join(root, 'data/enterprise/roster.json'))
  if (!isRecord(raw) || !Array.isArray(raw.divisions) || !Array.isArray(raw.agents)) return undefined
  const divisions = raw.divisions.filter(isRecord).map(entry => ({ id: String(entry.id), name: String(entry.name) }))
  const seats = new Map<string, RosterSeat>()
  for (const agent of raw.agents) {
    if (!isRecord(agent) || typeof agent.id !== 'string') continue
    const evidence = isRecord(agent.evidence) ? agent.evidence : {}
    const ledger = isRecord(agent.ledger) ? agent.ledger : {}
    seats.set(agent.id, {
      id: agent.id,
      name: typeof agent.name === 'string' ? agent.name : agent.id,
      division: String(agent.division),
      source: typeof agent.source === 'string' ? agent.source : '',
      status: typeof agent.status === 'string' ? agent.status : 'defined',
      occupied: (typeof evidence.sessions === 'number' && evidence.sessions > 0) || (typeof ledger.lines === 'number' && ledger.lines > 0),
    })
  }
  const generatedAt = msOf(raw.generatedAt)
  return { ...generatedAt === undefined ? {} : { generatedAt }, divisions, seats }
}

/** One readable ledger line with its line number in the file. */
interface NumberedLine {
  line: number
  entry: LedgerLine
}

/**
 * @param root - The checkout.
 * @returns Every readable ledger line with its number, and how many were skipped, or `undefined` when the ledger cannot be read.
 */
function readLedgerNumbered(root: string): { lines: NumberedLine[]; skipped: number } | undefined {
  const text = readText(join(root, 'data/enterprise/ledger.jsonl'))
  if (text === undefined) return undefined
  const lines: NumberedLine[] = []
  let skipped = 0
  for (const [index, row] of text.split('\n').entries()) {
    if (row.trim().length === 0) continue
    let decoded: unknown
    try {
      decoded = JSON.parse(row)
    } catch {
      // A torn row: counted as skipped, the rest of the ledger still counts.
      skipped += 1
      continue
    }
    const parsed = parseLedgerLine(decoded)
    if (typeof parsed === 'string') skipped += 1
    else lines.push({ line: index + 1, entry: parsed })
  }
  return { lines, skipped }
}

interface TicketFile {
  id: string
  seat?: string
  division?: string
  title?: string
}

/**
 * @param root - The checkout.
 * @returns The queue's tickets by id, or `undefined` when the queue directory cannot be read.
 */
function readTickets(root: string): Map<string, TicketFile> | undefined {
  const dir = join(root, 'data/enterprise/tickets')
  const names = listDir(dir)
  if (names === undefined) return undefined
  const tickets = new Map<string, TicketFile>()
  for (const name of names.filter(entry => /^T-\d{4}\.json$/.test(entry)).sort()) {
    const raw = readJson(join(dir, name))
    const id = name.slice(0, -'.json'.length)
    if (!isRecord(raw)) {
      tickets.set(id, { id })
      continue
    }
    tickets.set(id, {
      id,
      ...typeof raw.seat === 'string' ? { seat: raw.seat } : {},
      ...typeof raw.division === 'string' ? { division: raw.division } : {},
      ...typeof raw.title === 'string' ? { title: raw.title } : {},
    })
  }
  return tickets
}

// ---------------------------------------------------------------------------
// The collection
// ---------------------------------------------------------------------------

/** The working set one collection builds, source by source. */
class Collection {
  readonly sources = new Map<OpsSourceId, OpsSource>()
  readonly agents: OpsAgent[] = []
  readonly attention: OpsAttention[] = []
  readonly runs = new Map<string, OpsRun>()
  readonly frames: RunEvent[] = []

  constructor(readonly inputs: OpsInputs) {}

  get now(): number {
    return this.inputs.now.getTime()
  }

  get since(): number {
    return this.now - WINDOW_MS
  }

  /** Record a source read live: its facts describe the collection's own time. */
  ok(id: OpsSourceId, detail: string): void {
    this.dated(id, detail, this.now)
  }

  /**
   * Record a source whose facts describe an earlier moment.
   * @param id - The source.
   * @param detail - What was read.
   * @param asOf - That moment, epoch milliseconds; `undefined` when it cannot be told.
   */
  dated(id: OpsSourceId, detail: string, asOf: number | undefined): void {
    this.sources.set(id, { id, state: 'ok', detail, ...asOf === undefined ? {} : { asOf: iso(asOf) } })
  }

  unknown(id: OpsSourceId, detail: string): void {
    this.sources.set(id, { id, state: 'unknown', detail })
  }

  /** Add a run to the timeline when it overlaps the window; a later add of the same id replaces it. */
  run(run: OpsRun): void {
    const end = run.endedAt === undefined ? this.now : Date.parse(run.endedAt)
    if (end < this.since) return
    this.runs.set(run.id, run)
  }

  /** Stamp an agent's frames with its id and seat, keeping those inside the activity window. */
  addFrames(sessionId: string, frames: readonly Frame[], seat?: string): void {
    for (const frame of frames) {
      if (frame.ts < this.now - ACTIVITY_MS) continue
      this.frames.push({ ...frame, sessionId, ...seat === undefined ? {} : { agentId: seat } })
    }
  }

  /**
   * Add one agent that has not ended.
   * @param agent - Everything but the derived times and state.
   * @param frames - Its activity frames.
   */
  agent(agent: Omit<OpsAgent, 'elapsedSeconds' | 'idleSeconds' | 'state' | 'evidence'> & { evidence?: MachineLink }, frames: readonly Frame[] = []): void {
    const idle = Math.max(0, this.now - Date.parse(agent.lastEventAt))
    const { evidence, ...rest } = agent
    const full: OpsAgent = {
      ...rest,
      ...evidence === undefined ? {} : { evidence: publishLink(evidence) },
      elapsedSeconds: Math.max(0, Math.round((this.now - Date.parse(agent.startedAt)) / 1000)),
      idleSeconds: Math.round(idle / 1000),
      state: idle > this.inputs.stuckMs ? 'stuck' : 'working',
    }
    this.agents.push(full)
    this.addFrames(agent.id, frames, agent.seat)
  }

  /**
   * Add one attention item.
   * @param item - The item, its evidence as collected.
   */
  flag(item: Omit<OpsAttention, 'evidence'> & { evidence: MachineLink[] }): void {
    this.attention.push({ ...item, evidence: item.evidence.map(publishLink) })
  }
}

/**
 * Collect one operations snapshot.
 * @param inputs - The sources and the collector's state; `inputs.state` is updated in place.
 * @returns The snapshot.
 */
export async function collectOps(inputs: OpsInputs): Promise<OpsSnapshot> {
  const c = new Collection(inputs)
  const processes = inputs.processes()
  const checkoutAt = checkoutTime(inputs)

  const roster = readRoster(inputs.root)
  if (roster === undefined) c.unknown('roster', 'data/enterprise/roster.json could not be read')
  else c.dated('roster', `${roster.seats.size} seats in ${roster.divisions.length} divisions`, roster.generatedAt ?? checkoutAt)

  const ledger = readLedgerNumbered(inputs.root)
  if (ledger === undefined) c.unknown('ledger', 'data/enterprise/ledger.jsonl could not be read')
  else c.dated('ledger', `${ledger.lines.length} lines${ledger.skipped === 0 ? '' : `, ${ledger.skipped} unreadable and skipped`}`, checkoutAt)

  const tickets = readTickets(inputs.root)
  if (tickets === undefined) c.unknown('tickets', 'data/enterprise/tickets/ could not be read')
  else c.dated('tickets', `${tickets.size} tickets in the queue`, checkoutAt)

  const history = inputs.git(['log', `--since=${iso(c.since)}`, '--format=%H%x09%cI%x09%s', 'HEAD'])
  const cycles = collectCycles(c, processes, history, checkoutAt)
  const scratchRuns = collectScratch(c, roster, tickets, ledger, cycles)
  collectShiftRecords(c, scratchRuns)
  const shift = collectShift(c, scratchRuns, tickets)
  collectRecords(c, roster, tickets, ledger)
  collectOperatorAgents(c)
  collectBench(c, processes)
  collectGates(c, roster, processes)
  collectLedgerRuns(c, roster, ledger)
  const ci = await collectCi(c, ledger)
  const host = collectHost(c)
  collectRequests(c, checkoutAt)
  const heartbeats = collectHeartbeats(c, processes, history, cycles, checkoutAt)
  flagTickets(c, ledger, tickets)
  settleCycleAgent(c)
  flagStuck(c)

  const big: OpsBigPicture = {
    seats: seatCounts(roster, c.agents),
    tickets: ticketCounts(c, ledger, tickets),
    cycles: cycles.summary,
    throughput: ledger === undefined ? null : throughput(c, ledger.lines),
    shipped: ledger === undefined ? null : shippedCommits(c, ledger.lines, ci),
    shippedTickets: ledger === undefined ? null : shippedTickets(c, ledger.lines, tickets, ci),
    ci: ci === undefined ? null : ci.summary,
    host,
  }

  const frames = c.frames.sort((a, b) => a.ts - b.ts || a.seq - b.seq).slice(-ACTIVITY_LIMIT)
  // The snapshot leaves the machine (the relay, the committed fixture), so no string in it keeps an absolute path of this machine.
  return hostlessJson<OpsSnapshot>({
    schema: OPS_SCHEMA,
    generatedAt: inputs.now.toISOString(),
    producer: inputs.producer,
    ...inputs.intervalSeconds === undefined ? {} : { intervalSeconds: inputs.intervalSeconds },
    window: { since: iso(c.since), until: inputs.now.toISOString() },
    sources: SOURCE_ORDER.map(id => c.sources.get(id) ?? { id, state: 'unknown', detail: 'not read' }),
    heartbeats,
    agents: c.agents.sort((a, b) => a.kind.localeCompare(b.kind) || a.startedAt.localeCompare(b.startedAt)),
    attention: rankAttention(c.attention),
    big,
    seats: roster === undefined ? null : [...roster.seats.values()].map(seat => ({
      id: seat.id,
      name: seat.name,
      division: seat.division,
      occupied: seat.occupied,
      activeToday: seat.status === 'active',
    })),
    runs: [...c.runs.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id)),
    activity: frames,
    cycles: cycles.timeline,
    shift,
  })
}

/** The order the snapshot lists its sources in. */
const SOURCE_ORDER: readonly OpsSourceId[] = [
  'roster', 'ledger', 'tickets', 'cycle-logs', 'cycle-history', 'scheduler', 'shifts',
  'department-transcripts', 'operator-agents', 'bench', 'ci', 'host', 'requests',
]

/**
 * When the checkout's branch files were current: its newest fetch of the
 * branch (the mtime of `FETCH_HEAD`), else its HEAD commit's time.
 * @param inputs - The checkout and its git.
 * @returns Epoch milliseconds, or `undefined` when git cannot say.
 */
function checkoutTime(inputs: OpsInputs): number | undefined {
  const fetchHead = inputs.git(['rev-parse', '--git-path', 'FETCH_HEAD'])?.trim()
  const fetched = fetchHead === undefined || fetchHead === '' ? undefined : mtimeOf(resolve(inputs.root, fetchHead))
  return fetched ?? msOf(inputs.git(['log', '-1', '--format=%cI', 'HEAD'])?.trim())
}

/**
 * Rank the attention queue: worst severity first, then newest first, a
 * condition with no recorded time (disk, memory, a scheduler that is down)
 * counting as current, then by id.
 * @param items - The items in any order.
 * @returns A new, ranked array.
 */
export function rankAttention(items: readonly OpsAttention[]): OpsAttention[] {
  const when = (item: OpsAttention): number => msOf(item.at) ?? Number.POSITIVE_INFINITY
  return [...items].sort((a, b) =>
    SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
    || (when(a) === when(b) ? 0 : when(b) > when(a) ? 1 : -1)
    || a.id.localeCompare(b.id))
}

// ---------------------------------------------------------------------------
// Cycles and the scheduler
// ---------------------------------------------------------------------------

interface CycleReading {
  summary: OpsBigPicture['cycles']
  /** The running cycle's log, when one runs. */
  running?: CycleLog
  /** The newest cycle start any source records, epoch milliseconds. */
  lastStart?: number
  /** The scheduler's newest slot: the newest cycle start or cycle log, a refused cycle's included. */
  lastTick?: number
  /** The scheduler's process, when the process table shows one. */
  scheduler?: ProcessInfo
  /** The window's cycles, newest first; `null` when neither the logs nor the history could be read. */
  timeline: OpsCycle[] | null
}

/**
 * A cycle's ended steps on the timeline, each timed from the end of the one before.
 * @param startedAt - The cycle's start, epoch milliseconds.
 * @param steps - The steps in the order they ended.
 * @returns The timeline steps.
 */
function endedSteps(startedAt: number, steps: readonly { name: string; exit: number; at: string }[]): OpsCycleStep[] {
  let from = startedAt
  return steps.map((step) => {
    const at = Date.parse(step.at)
    const seconds = Math.max(0, Math.round((at - from) / 1000))
    from = at
    return { name: step.name, state: step.exit === 0 ? 'ok' : 'failed', exit: step.exit, at: iso(at), seconds }
  })
}

/**
 * One cycle log as a timeline entry: its logged steps, then, while it runs,
 * its running step and the steps it has still to reach.
 * @param c - The collection.
 * @param log - The log.
 * @param live - Whether the cycle runs now.
 * @param record - Its committed record, when the checkout has one.
 * @param exit - The cycle's exit code as the scheduler logged it.
 * @returns The entry.
 */
function logCycle(c: Collection, log: CycleLog, live: boolean, record: CycleRecord | undefined, exit: number | undefined): OpsCycle {
  const cycle = log.cycle ?? log.file.replace(/\.log$/, '')
  const started = Date.parse(log.startedAt)
  const steps = endedSteps(started, log.steps.map(step => ({ name: step.step, exit: step.exit, at: step.at })))
  const last = steps.at(-1)?.at
  if (live) {
    const from = last === undefined ? started : Date.parse(last)
    steps.push({ name: currentCycleStep(log), state: 'running', at: iso(from), seconds: Math.max(0, Math.round((c.now - from) / 1000)) })
    for (const name of pendingCycleSteps(log)) steps.push({ name, state: 'pending' })
  }
  const failed = steps.some(step => step.state === 'failed') || (log.done?.firstFailure ?? 0) !== 0 || (exit ?? 0) !== 0
  const outcome: OpsCycle['outcome'] = live ? 'running'
    : log.refused !== undefined ? 'refused'
      : failed ? 'failed'
        : log.done !== undefined ? 'clean'
          : 'interrupted'
  const endedAt = live ? undefined : record?.endedAt ?? last
  return {
    cycle,
    startedAt: log.startedAt,
    ...endedAt === undefined ? {} : { endedAt },
    outcome,
    ...exit === undefined ? {} : { exit },
    source: 'log',
    steps,
    ...log.shift === undefined ? {} : { shift: log.shift },
    ...record === undefined ? {} : { tickets: record.tickets, functions: record.functions },
    ...log.refused === undefined ? {} : { detail: log.refused },
    evidence: cycleLink(c.inputs.branch, cycle, record !== undefined),
  }
}

/**
 * A committed cycle record as a timeline entry, for a cycle whose log is gone.
 * @param c - The collection.
 * @param record - The record.
 * @param exit - The cycle's exit code as the scheduler logged it.
 * @returns The entry.
 */
function recordCycle(c: Collection, record: CycleRecord, exit: number | undefined): OpsCycle {
  return {
    cycle: record.cycle,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    outcome: record.firstFailure === null && (exit ?? 0) === 0 ? 'clean' : 'failed',
    ...exit === undefined ? {} : { exit },
    source: 'record',
    steps: endedSteps(Date.parse(record.startedAt), record.steps),
    ...record.shifts[0] === undefined ? {} : { shift: record.shifts[0] },
    tickets: record.tickets,
    functions: record.functions,
    evidence: cycleLink(c.inputs.branch, record.cycle, true),
  }
}

/** Whether a process runs a given script. */
function runs(entry: ProcessInfo, script: string): boolean {
  return entry.cmdline.includes(script)
}

function collectCycles(
  c: Collection,
  processes: ProcessInfo[] | undefined,
  history: string | undefined,
  checkoutAt: number | undefined,
): CycleReading {
  const { cyclesDir } = c.inputs
  const names = listDir(cyclesDir)
  const logs: CycleLog[] = []
  if (names === undefined) {
    c.unknown('cycle-logs', `${cyclesDir} is absent (a container reset erases it)`)
  } else {
    for (const name of names.filter(entry => entry.startsWith('cycle-') && entry.endsWith('.log')).sort()) {
      const text = readText(join(cyclesDir, name))
      const log = text === undefined ? undefined : parseCycleLog(name, text)
      if (log !== undefined && Date.parse(log.startedAt) >= c.since - WINDOW_MS) logs.push(log)
    }
    c.ok('cycle-logs', `${logs.length} cycle ${logs.length === 1 ? 'log' : 'logs'} in ${cyclesDir}`)
  }

  const committed = history === undefined ? undefined : cyclesFromHistory(history)
  const { records, unreadable } = readCycleRecords(c.inputs.root)
  const recorded = records.filter(record => Date.parse(record.endedAt) >= c.since)
  const timeline: OpsCycle[] = []
  if (committed === undefined) c.unknown('cycle-history', 'git log could not be read in the checkout')
  else {
    const skipped = unreadable.length === 0 ? '' : `, ${unreadable.length} unreadable ${unreadable.length === 1 ? 'record' : 'records'} skipped`
    c.dated('cycle-history', `${committed.size} cycles committed to the branch and ${recorded.length} cycle records in the window${skipped}`, checkoutAt)
  }

  const cycleProcess = processes?.find(entry => runs(entry, 'scripts/enterprise-cycle.sh'))
  const schedulerProcess = processes?.find(entry => runs(entry, 'scripts/enterprise-scheduler.sh'))
  const scheduler = parseSchedulerLog(readText(join(cyclesDir, 'scheduler.log')) ?? '')
  if (processes === undefined) c.unknown('scheduler', 'the process table could not be read')
  else c.ok('scheduler', schedulerProcess === undefined ? 'no scheduler process runs' : `scheduler runs (pid ${schedulerProcess.pid})`)

  const starts = new Map<string, number>()
  for (const log of logs) if (log.cycle !== undefined) starts.set(log.cycle, Date.parse(log.startedAt))
  for (const record of recorded) if (!starts.has(record.cycle)) starts.set(record.cycle, Date.parse(record.startedAt))
  for (const [cycle, times] of committed ?? []) if (!starts.has(cycle)) starts.set(cycle, Date.parse(times.first))

  const newest = logs.at(-1)
  const newestDone = logs.findLast(log => log.done !== undefined)
  let running: CycleLog | undefined
  for (const log of logs) {
    const cycle = log.cycle ?? log.file
    const commits = committed?.get(cycle)
    const evidence: OpsLink[] = [cycleLink(c.inputs.branch, cycle, existsSync(join(c.inputs.root, `data/enterprise/cycles/${cycle}.json`)))]
    let from = Date.parse(log.startedAt)
    for (const step of log.steps) {
      const at = Date.parse(step.at)
      c.run({
        id: `cycle:${cycle}:${step.step}`,
        kind: 'cycle-step',
        label: `${cycle.replace('cycle-', '')} ${step.step}`,
        startedAt: iso(from),
        endedAt: step.at,
        outcome: step.exit === 0 ? 'ok' : 'failed',
      })
      if (at >= c.now - ACTIVITY_MS) {
        c.frames.push({ ts: at, seq: log.steps.indexOf(step) + 1, sessionId: `cycle:${cycle}`, kind: step.exit === 0 ? 'step' : 'refusal', label: `${step.step} exit=${step.exit}` })
      }
      from = at
    }
    const live = log === newest && log.done === undefined && log.refused === undefined && cycleProcess !== undefined
    if (Date.parse(log.startedAt) >= c.since) {
      timeline.push(logCycle(c, log, live, recorded.find(record => record.cycle === cycle), scheduler.exits.get(log.file.replace(/\.log$/, ''))))
    }
    if (live) {
      running = log
      const step = currentCycleStep(log)
      const lastEvent = Math.max(mtimeOf(join(cyclesDir, log.file)) ?? from, from)
      c.run({ id: `cycle:${cycle}:${step}`, kind: 'cycle-step', label: `${cycle.replace('cycle-', '')} ${step}`, startedAt: iso(from), outcome: 'running' })
      c.agent({
        id: `cycle:${cycle}`,
        kind: 'cycle-step',
        label: `${cycle} · ${step}`,
        doing: `running the cycle's ${step} step`,
        startedAt: iso(from),
        lastEventAt: iso(lastEvent),
        run: cycle,
        evidence: evidence[0] ?? { label: log.file },
      })
    }
    // A failed step matters while it is the newest word on its step: in the newest finished cycle, or in the newest cycle while it runs.
    const current = log === newest || log === newestDone
    for (const step of current ? log.steps : []) {
      if (step.exit === 0) continue
      c.flag({
        id: `cycle-step:${cycle}:${step.step}`,
        kind: 'cycle-step-failed',
        severity: 'high',
        title: `${cycle}: ${step.step} exited ${step.exit}`,
        detail: step.step === 'intake' && step.exit === 3
          ? 'The intake stopped at the usage limit, so the cycle skipped its shift.'
          : `The cycle carried on after the failed ${step.step} step; its closing line names the first failure.`,
        at: step.at,
        evidence: [...evidence, ...commits === undefined ? [] : [commitLink(commits.commit)]],
        next: NEXT_FOR_STEP[step.step] ?? `Read the ${step.step} step's output in ${log.file} and rerun it by hand from the cycle's checkout if its work must land before the next cycle.`,
      })
    }
    if (log === newest && log.done === undefined && log.refused === undefined && cycleProcess === undefined && processes !== undefined) {
      c.flag({
        id: `cycle-interrupted:${cycle}`,
        kind: 'cycle-interrupted',
        severity: 'high',
        title: `${cycle} stopped during ${currentCycleStep(log)}`,
        detail: 'Its log has no closing line and no cycle process runs: the cycle was killed, most likely by a container reset.',
        at: log.steps.at(-1)?.at ?? log.startedAt,
        evidence,
        next: 'The next scheduled cycle starts over. Check the cycle checkout for uncommitted changes first: they make the next cycle refuse to run (exit 5).',
      })
    }
    if (log.refused !== undefined && log === newest) {
      c.flag({
        id: `cycle-refused:${log.file}`,
        kind: 'cycle-step-failed',
        severity: 'high',
        title: `The cycle of ${log.startedAt.slice(11, 16)}Z refused to run`,
        detail: `enterprise-cycle: ${log.refused}.`,
        at: log.startedAt,
        evidence,
        next: log.refused.startsWith('another') ? 'Wait for the running cycle; the scheduler starts the next one after it.' : 'Commit or discard the uncommitted changes in the cycle checkout; the next slot then runs.',
      })
    }
  }
  const newestStart = Math.max(...logs.map(log => Date.parse(log.startedAt)), Number.NEGATIVE_INFINITY)
  for (const record of recorded) {
    if (logs.some(log => log.cycle === record.cycle)) continue
    recordRuns(c, record, committed?.get(record.cycle)?.commit, Date.parse(record.startedAt) > newestStart && record === recorded.at(-1))
    if (Date.parse(record.startedAt) >= c.since) timeline.push(recordCycle(c, record, scheduler.exits.get(record.cycle)))
  }
  for (const [cycle, times] of committed ?? []) {
    if (logs.some(log => log.cycle === cycle) || recorded.some(record => record.cycle === cycle)) continue
    c.run({ id: `cycle:${cycle}`, kind: 'cycle-step', label: `${cycle.replace('cycle-', '')} (log erased)`, startedAt: times.first, endedAt: times.last, outcome: 'unknown' })
    if (Date.parse(times.first) >= c.since) {
      timeline.push({ cycle, startedAt: times.first, endedAt: times.last, outcome: 'unknown', source: 'history', steps: [], evidence: commitLink(times.commit) })
    }
  }

  const inWindow = [...starts.entries()].filter(([, at]) => at >= c.since)
  const lastStart = Math.max(...starts.values(), Number.NEGATIVE_INFINITY)
  const stale = !Number.isFinite(lastStart) || c.now - lastStart > c.inputs.staleMs
  const known = names !== undefined || committed !== undefined
  if (known && stale) {
    const down = processes !== undefined && schedulerProcess === undefined
    c.flag({
      id: 'scheduler-stale',
      kind: 'scheduler-stale',
      severity: down ? 'critical' : 'high',
      title: Number.isFinite(lastStart) ? `No cycle for ${hoursSince(c.now, lastStart)}` : 'No cycle in the last 24 hours',
      detail: `The scheduler runs a cycle every two hours; more than ${c.inputs.staleMs / 3_600_000} hours have passed${down ? ', and no scheduler process runs' : ''}.`,
      ...Number.isFinite(lastStart) ? { at: iso(lastStart) } : {},
      evidence: [{ label: 'scheduler.log', path: join(cyclesDir, 'scheduler.log') }],
      next: down ? SCHEDULER_START : 'Read the newest cycle log: a long shift delays the next slot; a hung one needs stopping.',
    })
  } else if (processes !== undefined && schedulerProcess === undefined) {
    c.flag({
      id: 'scheduler-down',
      kind: 'scheduler-down',
      severity: 'high',
      title: 'The cycle scheduler is not running',
      detail: 'No enterprise-scheduler.sh process runs, so no cycle will start on its own.',
      evidence: [{ label: 'scheduler.log', path: join(cyclesDir, 'scheduler.log') }],
      next: SCHEDULER_START,
    })
  }

  return {
    ...running === undefined ? {} : { running },
    ...Number.isFinite(lastStart) ? { lastStart } : {},
    ...Number.isFinite(Math.max(lastStart, newestStart)) ? { lastTick: Math.max(lastStart, newestStart) } : {},
    ...schedulerProcess === undefined ? {} : { scheduler: schedulerProcess },
    timeline: !known ? null : timeline.sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.cycle.localeCompare(a.cycle)),
    summary: !known ? null : {
      last24h: inWindow.length,
      ...Number.isFinite(lastStart) ? { lastStartedAt: iso(lastStart) } : {},
      ...running?.cycle === undefined ? {} : { running: running.cycle },
      ...scheduler.nextAt === undefined || Date.parse(scheduler.nextAt) <= c.now ? {} : { nextAt: scheduler.nextAt },
    },
  }
}

/**
 * A committed cycle record's steps as timeline runs, for a cycle whose log is
 * gone; its failed steps are flagged when it is the newest cycle known.
 * @param c - The collection.
 * @param record - The record.
 * @param commit - The cycle's newest commit on the branch, when the history names one.
 * @param newest - Whether no later cycle is known.
 */
function recordRuns(c: Collection, record: CycleRecord, commit: string | undefined, newest: boolean): void {
  let from = Date.parse(record.startedAt)
  const evidence = [blobLink(c.inputs.branch, `data/enterprise/cycles/${record.cycle}.json`), ...commit === undefined ? [] : [commitLink(commit)]]
  for (const step of record.steps) {
    c.run({
      id: `cycle:${record.cycle}:${step.name}`,
      kind: 'cycle-step',
      label: `${record.cycle.replace('cycle-', '')} ${step.name}`,
      startedAt: iso(from),
      endedAt: step.at,
      outcome: step.exit === 0 ? 'ok' : 'failed',
    })
    from = Date.parse(step.at)
    if (!newest || step.exit === 0) continue
    c.flag({
      id: `cycle-step:${record.cycle}:${step.name}`,
      kind: 'cycle-step-failed',
      severity: 'high',
      title: `${record.cycle}: ${step.name} exited ${step.exit}`,
      detail: 'The cycle record states the failure; the cycle log that held its output is gone.',
      at: step.at,
      evidence,
      next: NEXT_FOR_STEP[step.name] ?? `Rerun the ${step.name} step by hand from the cycle's checkout if its work must land before the next cycle.`,
    })
  }
}

/** How to start the scheduler, as the attention queue states it. */
const SCHEDULER_START = 'Start it detached from the cycle checkout: setsid nohup bash scripts/enterprise-scheduler.sh >> /home/user/enterprise-cycles/scheduler.log 2>&1 < /dev/null &'

/** The next action for a failed cycle step. */
const NEXT_FOR_STEP: Record<string, string> = {
  pull: 'The checkout could not fast-forward: check it for local commits or a rewritten branch before the next slot.',
  intake: 'Read the intake record under data/enterprise/intake/ for the coordinators\' report.',
  'intake-push': 'The intake\'s commit did not reach the branch: push it by hand from the cycle checkout.',
  shift: 'Read the shift\'s run.log under /tmp/dsh-enterprise/<shift>/ and its record under data/enterprise/shifts/.',
  'pull-after-shift': 'The checkout could not take the shift\'s push: check it for local commits.',
  functions: 'Read the failing gate\'s log under data/enterprise/functions/<cycle>/; a failed gate is recorded, not retried.',
  roster: 'Run pnpm run roster in the cycle checkout and read the error it names.',
  publish: 'Run pnpm run enterprise:publish in the cycle checkout and read the error it names.',
  record: 'Run pnpm run enterprise:cycle-record in the cycle checkout and read the problem it names; the cycle\'s commit still carries its data.',
  push: 'The cycle\'s commit is local only: push it by hand from the cycle checkout.',
}

function hoursSince(now: number, then: number): string {
  const minutes = Math.round((now - then) / 60_000)
  return minutes < 120 ? `${minutes} minutes` : `${(minutes / 60).toFixed(1)} hours`
}

// ---------------------------------------------------------------------------
// Shifts and intakes: live scratch runs
// ---------------------------------------------------------------------------

/** How a session id names its role in a program run. */
interface SessionRole {
  kind: OpsAgentKind
  label: string
  seat?: string
  division?: string
  /** The ticket, for a department or a reviewer. */
  ticket?: string
}

/**
 * Name what one program session is from its id: `program-<hash>-t-NNNN` is the
 * department working ticket T-NNNN, `program-<hash>-~0040integration` the
 * shift's integration, `program-<hash>-<seat>` an intake coordinator,
 * `review-t-NNNN-…` the ticket's independent reviewer, and `program-<hash>`
 * alone the program's own ledger, which is no agent.
 * @param sessionId - The session's id.
 * @param roster - The seats, for a coordinator's.
 * @param tickets - The queue, for a department's seat.
 * @returns The role, or `undefined` for the program ledger and an id no rule names.
 */
export function sessionRole(
  sessionId: string,
  roster: RosterRead | undefined,
  tickets: Map<string, TicketFile> | undefined,
): SessionRole | undefined {
  const review = /^review-t-(\d{4})\b/.exec(sessionId)
  if (review !== null) return { kind: 'reviewer', label: `review of T-${review[1]}`, ticket: `T-${review[1]}` }
  const member = /^program-[0-9a-f]{16,}-(.+)$/.exec(sessionId)?.[1]
  if (member === undefined) return undefined
  const ticket = /^t-(\d{4})$/.exec(member)
  if (ticket !== null) {
    const id = `T-${ticket[1]}`
    const file = tickets?.get(id)
    const seat = file?.seat === undefined ? undefined : roster?.seats.get(file.seat)
    const division = seat?.division ?? file?.division
    return {
      kind: 'department',
      label: `${id}${seat === undefined ? '' : ` · ${seat.name}`}`,
      ticket: id,
      ...file?.seat === undefined ? {} : { seat: file.seat },
      ...division === undefined ? {} : { division },
    }
  }
  if (member.endsWith('integration')) return { kind: 'department', label: 'integration' }
  const seat = roster?.seats.get(member)
  if (seat !== undefined) return { kind: 'coordinator', label: `${seat.name} · intake`, seat: seat.id, division: seat.division }
  return { kind: 'department', label: member }
}

interface ScratchRun {
  id: string
  dir: string
  live: boolean
  intake: boolean
}

function collectScratch(
  c: Collection,
  roster: RosterRead | undefined,
  tickets: Map<string, TicketFile> | undefined,
  ledger: { lines: NumberedLine[] } | undefined,
  cycles: CycleReading,
): ScratchRun[] {
  const { scratch } = c.inputs
  const names = listDir(scratch)
  if (names === undefined) {
    c.unknown('shifts', `${scratch} is absent: no shift or intake has run since the machine started`)
    c.unknown('department-transcripts', 'no scratch runs to match transcripts to')
    return []
  }
  const lock = readJson(join(scratch, 'shift.lock'))
  const holder = isRecord(lock) && typeof lock.pid === 'number' && typeof lock.shift === 'string' && c.inputs.alive(lock.pid) ? lock.shift : undefined
  const intakeStep = cycles.running !== undefined && currentCycleStep(cycles.running) === 'intake'
  const cycleStart = cycles.running === undefined ? Number.POSITIVE_INFINITY : Date.parse(cycles.running.startedAt)
  const runsHere: ScratchRun[] = []
  for (const id of names.filter(name => /^\d{6}-[0-9a-f]{4}$/.test(name))) {
    const dir = join(scratch, id)
    const intake = existsSync(join(dir, 'plan.json')) || existsSync(join(dir, 'stdout.jsonl'))
    const started = mtimeOf(dir) ?? 0
    const live = holder === id || (intake && intakeStep && started >= cycleStart - 5_000)
    runsHere.push({ id, dir, live, intake })
  }
  const verdicts = reviewVerdicts(ledger?.lines ?? [])
  let sessions = 0
  let working = 0
  for (const run of runsHere) {
    // A shift or an intake writes its sessions under `.sessions` alone; the rest of the run is a clone of
    // the branch whose committed records are history, not agents at work, so a run without it has none yet.
    const sessionsDir = join(run.dir, '.sessions')
    for (const file of existsSync(sessionsDir) ? sessionFilesIn(sessionsDir) : []) {
      const facts = foldHarnessSession(parseJsonl(readText(file) ?? ''), basename(dirname(file)))
      const role = sessionRole(facts.sessionId, roster, tickets)
      if (role === undefined || facts.createdAt === undefined) continue
      sessions += 1
      const ended = facts.goalEnded || (role.kind === 'reviewer' && facts.turnEnded) || !run.live
      const transcript = ended ? undefined : departmentTranscript(c, run.id, facts.sessionId)
      const lastAt = Math.max(facts.lastAt ?? facts.createdAt, transcript?.lastAt ?? 0)
      c.run({
        id: `session:${facts.sessionId}`,
        kind: role.kind,
        label: role.label,
        ...role.seat === undefined ? {} : { seat: role.seat },
        ...role.division === undefined ? {} : { division: role.division },
        startedAt: iso(facts.createdAt),
        ...ended ? { endedAt: iso(facts.lastAt ?? facts.createdAt) } : {},
        outcome: sessionOutcome(role, facts, ended, run.live, verdicts),
      })
      if (ended) continue
      working += 1
      const doing = transcript?.doing !== undefined && (transcript.lastAt ?? 0) > (facts.lastAt ?? 0) ? transcript.doing : facts.doing
      c.agent({
        id: `session:${facts.sessionId}`,
        kind: role.kind,
        label: role.label,
        ...role.seat === undefined ? {} : { seat: role.seat },
        ...role.division === undefined ? {} : { division: role.division },
        doing: doing ?? 'starting',
        startedAt: iso(facts.createdAt),
        lastEventAt: iso(lastAt),
        ...facts.tokens > 0 ? { tokens: facts.tokens } : {},
        run: `${run.intake ? 'intake' : 'shift'} ${run.id}`,
        evidence: { label: `${run.intake ? 'intake' : 'shift'} ${run.id} session log`, path: homePath(file) },
      }, facts.frames)
    }
  }
  c.ok('shifts', `${runsHere.length} scratch ${runsHere.length === 1 ? 'run' : 'runs'}${holder === undefined ? '' : `, shift ${holder} running`}; ${sessions} sessions, ${working} working`)
  if (!c.sources.has('department-transcripts')) c.ok('department-transcripts', 'no working department to match a transcript to')
  return runsHere
}

/** Review verdicts by review session id, from the ledger's ticket lines. */
function reviewVerdicts(lines: readonly NumberedLine[]): Map<string, string> {
  const verdicts = new Map<string, string>()
  for (const { entry } of lines) {
    if (entry.type !== 'ticket' || entry.review === undefined) continue
    if (entry.review.sessionId !== undefined) verdicts.set(entry.review.sessionId, entry.review.verdict)
  }
  return verdicts
}

function sessionOutcome(
  role: SessionRole,
  facts: HarnessSessionFacts | RecordFacts,
  ended: boolean,
  live: boolean,
  verdicts: Map<string, string>,
): OpsRunOutcome {
  if (!ended) return 'running'
  if (role.kind === 'reviewer') {
    const verdict = verdicts.get(facts.sessionId)
    return verdict === 'approve' ? 'ok' : verdict === 'reject' ? 'failed' : 'unknown'
  }
  if (facts.certified) return 'ok'
  if (facts.goalEnded) return 'failed'
  return live ? 'running' : 'unknown'
}

/**
 * The Claude Code transcript behind a working department, when its route runs
 * Claude Code: the newest transcript under the project directory named for the
 * department's worktree.
 * @param c - The collection.
 * @param runId - The scratch run.
 * @param sessionId - The department's session id, `program-<hash>-<member>`.
 * @returns The transcript's state, or `undefined` when it has none.
 */
function departmentTranscript(c: Collection, runId: string, sessionId: string): TranscriptState | undefined {
  const match = /^(program-[0-9a-f]+)-(.+)$/.exec(sessionId)
  if (match === null) return undefined
  const [, program, member] = match
  const worktree = join(c.inputs.scratch, runId, 'repo', program ?? '', (member ?? '').replace('~0040', '@'))
  const dir = join(c.inputs.claudeProjects, claudeProjectName(worktree))
  const names = listDir(dir)
  if (names === undefined) return undefined
  let newest: TranscriptState | undefined
  for (const name of names.filter(entry => entry.endsWith('.jsonl'))) {
    const state = readTranscript(c.inputs.state, join(dir, name))
    if (state !== undefined && (newest === undefined || (state.lastAt ?? 0) > (newest.lastAt ?? 0))) newest = state
  }
  c.ok('department-transcripts', `read under ${c.inputs.claudeProjects}`)
  return newest
}

/**
 * Read a transcript incrementally through the state.
 * @param state - The collector's state; its entry for the file is replaced.
 * @param file - The transcript.
 * @returns The folded transcript, or `undefined` when it cannot be read.
 */
function readTranscript(state: OpsState, file: string): TranscriptState | undefined {
  const prior = state.transcripts[file] ?? emptyTranscript()
  let chunk = readFrom(file, prior.offset)
  let base = prior
  if (chunk === undefined && prior.offset > 0) {
    // Shorter than the last read: rewritten, so it is read again from the start.
    base = emptyTranscript()
    chunk = readFrom(file, 0)
  }
  if (chunk === undefined) return undefined
  const next = foldTranscript(base, chunk)
  state.transcripts[file] = next
  return next
}

// ---------------------------------------------------------------------------
// Committed shift and intake records
// ---------------------------------------------------------------------------

function collectRecords(
  c: Collection,
  roster: RosterRead | undefined,
  tickets: Map<string, TicketFile> | undefined,
  ledger: { lines: NumberedLine[] } | undefined,
): void {
  const verdicts = reviewVerdicts(ledger?.lines ?? [])
  const kept: Record<string, { size: number; facts: RecordFacts }> = {}
  for (const tree of ['data/enterprise/shifts', 'data/enterprise/intake']) {
    const base = join(c.inputs.root, tree)
    for (const record of listDir(base) ?? []) {
      // A record directory is named `<UTC date>-<run id>`; one dated before the window cannot overlap it.
      const date = /^(\d{4}-\d{2}-\d{2})-/.exec(record)?.[1]
      if (date === undefined || Date.parse(`${date}T23:59:59Z`) < c.since) continue
      const dir = join(base, record, 'sessions')
      for (const name of listDir(dir) ?? []) {
        if (!name.endsWith('.jsonl')) continue
        const file = join(dir, name)
        const facts = recordFacts(c.inputs.state, file)
        if (facts === undefined) continue
        kept[file] = c.inputs.state.records[file] ?? { size: 0, facts }
        const role = sessionRole(facts.sessionId, roster, tickets)
        if (role === undefined || facts.createdAt === undefined) continue
        const id = `session:${facts.sessionId}`
        if (c.runs.get(id)?.outcome === 'running') continue
        c.run({
          id,
          kind: role.kind,
          label: role.label,
          ...role.seat === undefined ? {} : { seat: role.seat },
          ...role.division === undefined ? {} : { division: role.division },
          startedAt: iso(facts.createdAt),
          endedAt: iso(facts.lastAt ?? facts.createdAt),
          outcome: sessionOutcome(role, facts, true, false, verdicts),
        })
      }
    }
  }
  // Records that left the window are dropped from the cache.
  c.inputs.state.records = kept
}

/**
 * A committed record's facts, read once per file size.
 * @param state - The collector's state.
 * @param file - The record's session log.
 * @returns The facts, or `undefined` when the file cannot be read.
 */
function recordFacts(state: OpsState, file: string): RecordFacts | undefined {
  let size: number
  try {
    size = statSync(file).size
  } catch {
    // Gone since it was listed.
    return undefined
  }
  const cached = state.records[file]
  if (cached !== undefined && cached.size === size) return cached.facts
  const text = readText(file)
  if (text === undefined) return undefined
  const folded = foldHarnessSession(parseJsonl(text), basename(file, '.jsonl'))
  const facts: RecordFacts = {
    sessionId: folded.sessionId,
    ...folded.createdAt === undefined ? {} : { createdAt: folded.createdAt },
    ...folded.lastAt === undefined ? {} : { lastAt: folded.lastAt },
    certified: folded.certified,
    goalEnded: folded.goalEnded,
  }
  state.records[file] = { size, facts }
  return facts
}

// ---------------------------------------------------------------------------
// The operator's own agents
// ---------------------------------------------------------------------------

function collectOperatorAgents(c: Collection): void {
  const project = join(c.inputs.claudeProjects, claudeProjectName(c.inputs.operatorTree))
  const entries = listDir(project)
  if (entries === undefined) {
    c.unknown('operator-agents', `no Claude Code transcripts for ${c.inputs.operatorTree} under ${c.inputs.claudeProjects}`)
    return
  }
  let read = 0
  let working = 0
  const consider = (file: string, id: string, label: string): void => {
    const mtime = mtimeOf(file)
    if (mtime === undefined || mtime < c.since) return
    const state = readTranscript(c.inputs.state, file)
    if (state?.firstAt === undefined) return
    read += 1
    const lastAt = Math.max(state.lastAt ?? state.firstAt, mtime)
    // A transcript whose newest message ended its turn is finished; one idle past the window's end was never reported ended.
    const ended = state.endedTurn
    c.run({ id, kind: 'operator-agent', label, startedAt: iso(state.firstAt), ...ended ? { endedAt: iso(lastAt) } : {}, outcome: ended ? 'ok' : 'running' })
    if (ended) return
    working += 1
    c.agent({
      id,
      kind: 'operator-agent',
      label,
      doing: state.doing ?? 'reading its brief',
      startedAt: iso(state.firstAt),
      lastEventAt: iso(lastAt),
      ...state.tokens > 0 ? { tokens: state.tokens } : {},
      run: 'operator',
      evidence: { label: `${basename(file)} transcript`, path: homePath(file) },
    }, state.frames)
  }
  for (const entry of entries) {
    if (entry.endsWith('.jsonl')) {
      consider(join(project, entry), `operator:${entry.slice(0, 8)}`, 'operator session')
      continue
    }
    const subagents = join(project, entry, 'subagents')
    for (const name of listDir(subagents) ?? []) {
      const agent = /^agent-([0-9a-f]+)\.jsonl$/.exec(name)?.[1]
      if (agent === undefined) continue
      const meta = readJson(join(subagents, `agent-${agent}.meta.json`))
      const description = isRecord(meta) && typeof meta.description === 'string' ? publicLine(meta.description, 60) : `agent ${agent.slice(0, 7)}`
      consider(join(subagents, name), `operator:${agent}`, description)
    }
  }
  c.ok('operator-agents', `${read} transcripts touched in the window, ${working} working`)
}

// ---------------------------------------------------------------------------
// The Proving Ground bench
// ---------------------------------------------------------------------------

function collectBench(c: Collection, processes: ProcessInfo[] | undefined): void {
  const loop = processes?.find(entry => runs(entry, 'proving-ground.ts') && / loop\b/.test(entry.cmdline))
  let live = 0
  let cells = 0
  for (const root of c.inputs.benchRoots) {
    const base = join(root, '.proving-ground/runs')
    for (const id of listDir(base) ?? []) {
      const dir = join(base, id)
      const log = readText(join(dir, 'run.log')) ?? ''
      const finished = log.split('\n').some(line => /^\{.*"type":"(result|error|refused)"/.test(line.trim()))
      const running = !finished && loop !== undefined
      if (running) live += 1
      for (const file of sessionFilesIn(dir)) {
        const mtime = mtimeOf(file)
        if (mtime === undefined || mtime < c.since) continue
        // A live run keeps each session at `.sessions/<cwd>/<session id>/session.jsonl`, a record at `sessions/<session id>.jsonl`.
        const named = basename(file, '.jsonl')
        const facts = foldHarnessSession(parseJsonl(readText(file) ?? ''), named === 'session' ? basename(dirname(file)) : named)
        if (facts.createdAt === undefined) continue
        cells += 1
        const cellId = `bench:${id}:${facts.sessionId}`
        const ended = facts.goalEnded || !running
        const label = `${id.replace(/-\d{8}T\d{6}Z$/, '')} · cell ${facts.sessionId.replace(/^environment-/, '').slice(0, 8)}`
        c.run({ id: cellId, kind: 'bench-cell', label, startedAt: iso(facts.createdAt), ...ended ? { endedAt: iso(facts.lastAt ?? facts.createdAt) } : {}, outcome: ended ? (facts.certified ? 'ok' : facts.goalEnded ? 'failed' : 'unknown') : 'running' })
        if (ended) continue
        c.agent({
          id: cellId,
          kind: 'bench-cell',
          label,
          doing: facts.doing ?? 'starting',
          startedAt: iso(facts.createdAt),
          lastEventAt: iso(Math.max(facts.lastAt ?? facts.createdAt, mtime)),
          ...facts.tokens > 0 ? { tokens: facts.tokens } : {},
          run: id,
          evidence: { label: `${id} session log`, path: homePath(file) },
        }, facts.frames)
      }
    }
  }
  let recorded = 0
  const records = join(c.inputs.root, 'data/proving-ground')
  for (const id of listDir(records) ?? []) {
    if (!/^\d{4}-\d{2}-\d{2}-/.test(id)) continue
    const manifest = readJson(join(records, id, 'manifest.json'))
    if (!isRecord(manifest)) continue
    const ranAt = msOf(manifest.ranAt)
    const endedAt = msOf(manifest.endedAt)
    if (ranAt === undefined || (endedAt ?? ranAt) < c.since) continue
    recorded += 1
    c.run({ id: `bench:${id}`, kind: 'bench-cell', label: id, startedAt: iso(ranAt), ...endedAt === undefined ? {} : { endedAt: iso(endedAt) }, outcome: endedAt === undefined ? 'unknown' : 'ok' })
  }
  const loopLine = (readText(c.inputs.benchLog) ?? '').split('\n').filter(line => line.startsWith('=== loop ')).at(-1)
  if (processes === undefined && live === 0) c.unknown('bench', 'the process table could not be read, so a running bench loop cannot be seen')
  else c.ok('bench', `${loop === undefined ? 'no bench loop runs' : `bench loop runs${loopLine === undefined ? '' : ` (${publicLine(loopLine.replaceAll(/^=+\s*|\s*=+$/g, ''), 60)})`}`}; ${live} live runs, ${cells} cells, ${recorded} records in the window`)
}

// ---------------------------------------------------------------------------
// Function gates running now
// ---------------------------------------------------------------------------

function collectGates(c: Collection, roster: RosterRead | undefined, processes: ProcessInfo[] | undefined): void {
  const runner = processes?.find(entry => runs(entry, 'enterprise-functions.ts'))
  if (processes === undefined || runner === undefined) return
  const children = new Map<number, ProcessInfo[]>()
  for (const entry of processes) children.set(entry.ppid, [...children.get(entry.ppid) ?? [], entry])
  const queue = [...children.get(runner.pid) ?? []]
  for (const child of queue) {
    const script = /\brun (?:-s )?([\w:-]+)/.exec(child.cmdline)?.[1]
    if (script === undefined || !child.cmdline.startsWith('pnpm') && !child.cmdline.includes('/pnpm')) {
      queue.push(...children.get(child.pid) ?? [])
      continue
    }
    const seat = [...roster?.seats.values() ?? []].find(entry => entry.division === 'verification' && basename(entry.source, '.ts') === script)
    c.agent({
      id: `gate:${script}:${child.pid}`,
      kind: 'function-gate',
      label: script,
      ...seat === undefined ? {} : { seat: seat.id, division: seat.division },
      doing: `pnpm run ${script}`,
      startedAt: iso(child.startedAt),
      lastEventAt: iso(child.startedAt),
      run: 'functions',
    })
    // A gate reports only when it ends, so its silence is its runtime, not a stall.
    const added = c.agents.at(-1)
    if (added !== undefined) added.state = 'working'
  }
}

// ---------------------------------------------------------------------------
// Ledger runs: functions and reviews, and the day's deliverables as frames
// ---------------------------------------------------------------------------

function collectLedgerRuns(c: Collection, roster: RosterRead | undefined, ledger: { lines: NumberedLine[] } | undefined): void {
  for (const { line, entry } of ledger?.lines ?? []) {
    const at = Date.parse(entry.at)
    if (entry.type === 'function') {
      const kind: OpsAgentKind = entry.function === 'intake' ? 'coordinator' : entry.function === 'review' ? 'reviewer' : 'function-gate'
      const seat = roster?.seats.get(entry.seat)
      if (kind !== 'coordinator') {
        c.run({
          id: `ledger:${line}`,
          kind,
          label: `${entry.function}${seat === undefined ? '' : ` · ${seat.name}`}`,
          seat: entry.seat,
          division: entry.division,
          startedAt: iso(at - (entry.seconds * 1000)),
          endedAt: entry.at,
          outcome: entry.outcome === 'pass' ? 'ok' : entry.outcome === 'fail' ? 'failed' : 'unknown',
        })
      }
      if (at >= c.now - ACTIVITY_MS) {
        c.frames.push({ ts: at, seq: line, sessionId: 'ledger', agentId: entry.seat, kind: entry.outcome === 'pass' ? 'certificate' : 'refusal', label: `${entry.function} ${entry.outcome}` })
      }
      continue
    }
    if (at >= c.now - ACTIVITY_MS) {
      const status = ticketStatus(entry)
      c.frames.push({ ts: at, seq: line, sessionId: 'ledger', agentId: entry.seat, kind: status === 'shipped' ? 'merge' : 'refusal', label: `${entry.ticket} ${status}` })
    }
  }
}

// ---------------------------------------------------------------------------
// Branch CI
// ---------------------------------------------------------------------------

interface CiReading {
  runs: CiRun[]
  summary: NonNullable<OpsBigPicture['ci']>
}

async function collectCi(c: Collection, ledger: { lines: NumberedLine[] } | undefined): Promise<CiReading | undefined> {
  const { github, state, branch } = c.inputs
  if (github === undefined) {
    c.unknown('ci', 'Branch CI was not read (--no-ci)')
    return undefined
  }
  const cached = state.ci
  if (cached === undefined || c.now - cached.fetchedAt > c.inputs.ciMaxAgeMs) {
    try {
      const body = await github(`/repos/${OPS_REPOSITORY}/actions/workflows/${CI_WORKFLOW}/runs?branch=${encodeURIComponent(branch)}&per_page=50`)
      const runsRead = parseCiRuns(body)
      const jobs: Record<string, CiJob[]> = {}
      const latest = runsRead.find(run => run.status === 'completed' && run.conclusion !== 'cancelled' && run.conclusion !== 'skipped')
      if (latest !== undefined && latest.conclusion !== 'success') {
        jobs[latest.id] = cached?.jobs[latest.id] ?? parseCiJobs(await github(`/repos/${OPS_REPOSITORY}/actions/runs/${latest.id}/jobs?per_page=100`))
      }
      state.ci = { fetchedAt: c.now, runs: runsRead, jobs }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      if (cached === undefined) {
        c.unknown('ci', `GitHub could not be read: ${publicLine(reason, 120)}`)
        return undefined
      }
      state.ci = { ...cached, error: reason, errorAt: c.now }
    }
  }
  const read = state.ci
  if (read === undefined) return undefined
  const age = Math.round((c.now - read.fetchedAt) / 1000)
  c.dated('ci', `${read.runs.length} Branch CI runs read ${age} s ago${read.error === undefined || (read.errorAt ?? 0) < read.fetchedAt ? '' : `; the newest read failed: ${publicLine(read.error, 80)}`}`, read.fetchedAt)

  const latest = read.runs.find(run => run.status === 'completed' && run.conclusion !== 'cancelled' && run.conclusion !== 'skipped')
  const running = read.runs.find(run => run.status !== 'completed')
  const failing = latest === undefined ? [] : (read.jobs[latest.id] ?? []).filter(job => job.conclusion === 'failure')
  if (latest !== undefined && latest.conclusion !== 'success') {
    const shippedHere = (ledger?.lines ?? []).find(({ entry }) => entry.type === 'ticket' && entry.shipped?.commit === latest.sha)
    c.flag({
      id: `ci-red:${latest.id}`,
      kind: 'ci-red',
      severity: 'high',
      title: `Branch CI is red on ${latest.sha.slice(0, 9)}`,
      detail: failing.length === 0
        ? `The newest completed run ended ${latest.conclusion ?? 'without a conclusion'}.`
        : `Failing ${failing.length === 1 ? 'job' : 'jobs'}: ${failing.map(job => job.name).join(', ')}.`,
      at: latest.updatedAt,
      evidence: [
        { label: `CI run ${latest.id}`, url: latest.url },
        ...failing.slice(0, 3).map(job => ({ label: job.name, url: job.url })),
        commitLink(latest.sha),
        ...shippedHere === undefined ? [] : [blobLink(branch, 'data/enterprise/ledger.jsonl', shippedHere.line)],
      ],
      next: failing.length === 0
        ? 'Open the run and read which lane failed.'
        : `Open the ${failing[0]?.name ?? 'failing'} log, find the gate it names, and fix it or file a ticket for it; the judges record the verdict at the next cycle.`,
    })
  }
  return {
    runs: read.runs,
    summary: {
      branch,
      ...latest === undefined ? {} : {
        latest: { commit: latest.sha, conclusion: latest.conclusion ?? 'unknown', url: latest.url, at: latest.updatedAt, failingJobs: failing.map(job => ({ name: job.name, url: job.url })) },
      },
      ...running === undefined ? {} : { running: { commit: running.sha, url: running.url, startedAt: running.createdAt } },
    },
  }
}

/**
 * The shipped commits, newest first, each with the Branch CI verdict that
 * covers it: the cycle report's rendered answer ({@link reportVerdicts}), else
 * {@link shippedVerdict} over the runs read now. A shift pushes its commits
 * together and Branch CI runs on the pushed tip, so a commit without a run of
 * its own takes the verdict of the first later run that rendered one.
 * @param c - The collection, for the branch history.
 * @param lines - The ledger.
 * @param ci - The Branch CI reading, when there is one.
 * @returns Up to {@link SHIPPED_LIMIT} commits.
 */
function shippedCommits(c: Collection, lines: readonly NumberedLine[], ci: CiReading | undefined): OpsShipped[] {
  const reported = reportVerdicts(c.inputs.root)
  const byCommit = new Map<string, OpsShipped>()
  const shippedLines = lines.filter((entry): entry is { line: number; entry: TicketLine } => entry.entry.type === 'ticket' && entry.entry.shipped !== null)
  for (const { entry } of shippedLines.sort((a, b) => b.entry.at.localeCompare(a.entry.at))) {
    const commit = entry.shipped?.commit
    if (commit === undefined) continue
    const known = byCommit.get(commit)
    if (known !== undefined) {
      if (!known.tickets.includes(entry.ticket)) known.tickets.push(entry.ticket)
      continue
    }
    if (byCommit.size >= SHIPPED_LIMIT) break
    byCommit.set(commit, { commit, at: entry.at, tickets: [entry.ticket], ...reported.get(commit) ?? shippedVerdict(c, commit, ci) })
  }
  return [...byCommit.values()]
}

/** A completed run whose lanes rendered a verdict; a cancelled run rendered none (the rule of `enterprise-report.ts`). */
function rendered(run: CiRun): boolean {
  return run.status === 'completed' && (run.conclusion === 'success' || run.conclusion === 'failure')
}

/**
 * The Branch CI verdict covering one shipped commit, under the rule
 * `pnpm run enterprise:verdicts` applies (`scripts/enterprise-report.ts`): the
 * commit's own newest run when one rendered a verdict or still runs; else the
 * oldest later run that rendered one and whose head contains the commit; else
 * `running` while a later run containing it is in progress, and `no-run`. The
 * runs are the collector's one read of the branch's newest runs.
 * @param c - The collection, for the branch history.
 * @param commit - The shipped commit.
 * @param ci - The Branch CI reading, when there is one.
 * @returns The verdict, the run's page, and the commit it ran on when that is a later one.
 */
function shippedVerdict(c: Collection, commit: string, ci: CiReading | undefined): Pick<OpsShipped, 'ci' | 'ciCommit' | 'url'> {
  if (ci === undefined) return { ci: 'unknown' }
  const newestFirst = [...ci.runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id)
  const exact = newestFirst.filter(run => run.sha === commit)
  let run = exact.some(entry => entry.status !== 'completed' || rendered(entry)) ? exact.find(rendered) ?? exact.find(entry => entry.status !== 'completed') : undefined
  if (run === undefined) {
    const later = c.inputs.git(['rev-list', '--ancestry-path', `${commit}..HEAD`])
    if (later === undefined) return { ci: 'unknown' }
    const containing = new Set(later.split('\n').map(sha => sha.trim()).filter(sha => sha.length > 0))
    const covering = newestFirst.filter(entry => containing.has(entry.sha)).reverse()
    run = covering.find(rendered) ?? covering.find(entry => entry.status !== 'completed')
    if (run === undefined) return { ci: 'no-run' }
  }
  const verdict: OpsShipped['ci'] = run.status !== 'completed' ? 'running' : run.conclusion === 'success' ? 'pass' : 'fail'
  return { ci: verdict, url: run.url, ...run.sha === commit ? {} : { ciCommit: run.sha } }
}

/** The 24-hour report the cycle's publish step writes with `pnpm run enterprise:report`, relative to the repository root. */
const DAY_REPORT = 'apps/command-deck/public/fixtures/enterprise-day.json'

/**
 * The Branch CI verdicts the cycle's 24-hour report rendered for its shipped
 * commits, the answers `pnpm run enterprise:verdicts` gives: each read from a
 * run on the commit, else from the first later run that rendered a verdict,
 * which the report pages the branch's runs to find. A commit whose answer is
 * still open (a run in progress, no run, unknown) is left out for the live read.
 * @param root - The checkout.
 * @returns The rendered verdicts by commit.
 */
function reportVerdicts(root: string): Map<string, Pick<OpsShipped, 'ci' | 'ciCommit' | 'url'>> {
  const verdicts = new Map<string, Pick<OpsShipped, 'ci' | 'ciCommit' | 'url'>>()
  const report = readJson(join(root, DAY_REPORT))
  const commits = isRecord(report) && Array.isArray(report.commits) ? report.commits.filter(isRecord) : []
  const verdict = (conclusion: unknown): OpsShipped['ci'] | undefined => (conclusion === 'success' ? 'pass' : conclusion === 'failure' ? 'fail' : undefined)
  for (const entry of commits) {
    const answer = isRecord(entry.ci) ? entry.ci : {}
    if (typeof entry.commit !== 'string') continue
    if (answer.basis === 'later' && isRecord(answer.run)) {
      const ci = verdict(answer.run.conclusion)
      if (ci !== undefined && typeof answer.run.url === 'string' && typeof answer.run.headSha === 'string') {
        verdicts.set(entry.commit, { ci, url: answer.run.url, ciCommit: answer.run.headSha })
      }
    } else if (answer.basis === 'exact' && Array.isArray(answer.runs)) {
      const run = answer.runs.filter(isRecord).find(candidate => verdict(candidate.conclusion) !== undefined)
      const ci = verdict(run?.conclusion)
      if (ci !== undefined && typeof run?.url === 'string') verdicts.set(entry.commit, { ci, url: run.url })
    }
  }
  return verdicts
}

/**
 * The newest shipped tickets, each with the commit it shipped as and that
 * commit's Branch CI verdict: the cycle report's rendered answer when it has
 * one, else {@link shippedVerdict} over the runs read now.
 * @param c - The collection, for the branch history.
 * @param lines - The ledger.
 * @param tickets - The queue, for titles.
 * @param ci - The Branch CI reading, when there is one.
 * @returns Up to {@link SHIPPED_LIMIT} tickets, newest first.
 */
function shippedTickets(
  c: Collection,
  lines: readonly NumberedLine[],
  tickets: Map<string, TicketFile> | undefined,
  ci: CiReading | undefined,
): OpsShippedTicket[] {
  const verdicts = reportVerdicts(c.inputs.root)
  const seen = new Set<string>()
  const shipped: OpsShippedTicket[] = []
  const newestFirst = lines.flatMap(({ entry }) => (entry.type === 'ticket' && entry.shipped !== null ? [entry] : [])).sort((a, b) => b.at.localeCompare(a.at))
  for (const entry of newestFirst) {
    const commit = entry.shipped?.commit
    if (commit === undefined || seen.has(entry.ticket)) continue
    if (shipped.length >= SHIPPED_LIMIT) break
    seen.add(entry.ticket)
    let verdict = verdicts.get(commit)
    if (verdict === undefined) {
      verdict = shippedVerdict(c, commit, ci)
      verdicts.set(commit, verdict)
    }
    const title = tickets?.get(entry.ticket)?.title
    shipped.push({
      ticket: entry.ticket,
      ...title === undefined ? {} : { title: publicLine(title, 120) },
      seat: entry.seat,
      division: entry.division,
      shift: entry.shift,
      at: entry.at,
      commit,
      ...verdict,
    })
  }
  return shipped
}

// ---------------------------------------------------------------------------
// The host
// ---------------------------------------------------------------------------

function collectHost(c: Collection): OpsBigPicture['host'] {
  const memory = c.inputs.memory()
  const disks = c.inputs.disks()
  if (memory === undefined && disks.length === 0) {
    c.unknown('host', '/proc/meminfo and statfs could not be read')
    return null
  }
  c.ok('host', `${disks.length} ${disks.length === 1 ? 'filesystem' : 'filesystems'}${memory === undefined ? ', memory unknown' : ''}`)
  for (const disk of disks) {
    const severity = DISK_PRESSURE.find(([, pct]) => disk.usedPct >= pct)?.[0]
    if (severity === undefined) continue
    c.flag({
      id: `disk:${disk.mount}`,
      kind: 'disk-pressure',
      severity,
      title: `Disk ${disk.usedPct}% full under ${disk.mount}`,
      detail: `${(disk.freeBytes / 1_073_741_824).toFixed(1)} GB free. A shift clones the repository and installs its dependencies; a full disk fails it mid-way.`,
      evidence: [{ label: `statfs ${disk.mount}`, path: disk.mount }],
      next: 'Remove finished shift clones under /tmp/dsh-enterprise/*/repo and stale worktrees under .claude/worktrees.',
    })
  }
  if (memory !== undefined) {
    const severity = MEMORY_PRESSURE.find(([, pct]) => memory.availablePct < pct)?.[0]
      ?? (memory.swapUsedPct > SWAP_PRESSURE_PCT ? 'medium' : undefined)
    if (severity !== undefined) {
      c.flag({
        id: 'memory',
        kind: 'memory-pressure',
        severity,
        title: `Memory ${memory.availablePct}% available, swap ${memory.swapUsedPct}% used`,
        detail: 'Heavy gates, the shift\'s departments and the operator\'s agents share one machine.',
        evidence: [{ label: '/proc/meminfo', path: '/proc/meminfo' }],
        next: 'Run heavy commands under flock /tmp/dsh-heavy.lock, and let a running shift finish before starting another heavy job.',
      })
    }
  }
  return {
    disks: disks.map(disk => ({ mount: disk.mount, usedPct: disk.usedPct })),
    memoryAvailablePct: memory?.availablePct ?? null,
    swapUsedPct: memory?.swapUsedPct ?? null,
  }
}

// ---------------------------------------------------------------------------
// Owner requests
// ---------------------------------------------------------------------------

/** What an owner request in each open state needs next, and how urgent it is; shipped and rejected requests need nothing. */
const REQUEST_ATTENTION: Partial<Record<RequestState, { severity: Severity; next: string }>> = {
  waiting: { severity: 'medium', next: 'The next intake answers it with a priority-0 ticket; run pnpm run enterprise:intake if it must not wait for the cycle.' },
  refused: { severity: 'medium', next: 'Read the intake\'s reason and rewrite the request so a ticket can answer it.' },
  queued: { severity: 'low', next: 'Its ticket carries priority 0, so the next shift takes it first.' },
  halted: { severity: 'medium', next: 'Its ticket stays open and a later shift works it again; read the shift record for why it halted.' },
}

function collectRequests(c: Collection, checkoutAt: number | undefined): void {
  if (listDir(join(c.inputs.root, 'data/enterprise/requests')) === undefined) {
    c.unknown('requests', 'data/enterprise/requests/ is absent in this checkout')
    return
  }
  let statuses: ReturnType<typeof readRequestStatuses>
  try {
    statuses = readRequestStatuses(c.inputs.root)
  } catch (error) {
    // The requests module reads committed files; a checkout without them, or an unreadable one, leaves requests unknown.
    c.unknown('requests', `the owner's requests could not be read: ${publicLine(error instanceof Error ? error.message : String(error), 100)}`)
    return
  }
  let open = 0
  for (const status of statuses) {
    const attention = REQUEST_ATTENTION[status.state]
    if (attention === undefined) continue
    open += 1
    c.flag({
      id: `request:${status.file}`,
      kind: 'owner-request',
      severity: attention.severity,
      title: `Owner request ${status.state}: ${publicLine(status.title ?? basename(status.file), 90)}`,
      detail: publicLine(status.reason ?? (status.ticket === undefined ? 'No ticket answers it yet.' : `Answered by ${status.ticket}.`), 160),
      evidence: [
        blobLink(c.inputs.branch, status.file),
        ...status.ticket === undefined ? [] : [blobLink(c.inputs.branch, `data/enterprise/tickets/${status.ticket}.json`)],
      ],
      next: attention.next,
    })
  }
  c.dated('requests', `${statuses.length} owner ${statuses.length === 1 ? 'request' : 'requests'}, ${open} open`, checkoutAt)
}

// ---------------------------------------------------------------------------
// Shift records: halted, failed and abandoned shifts
// ---------------------------------------------------------------------------

/** What the attention queue needs from one committed shift record. */
interface ShiftRecord {
  /** The record's directory under `data/enterprise/shifts/`. */
  name: string
  shift: string
  startedAt: number
  endedAt: number
  shipped: number
  /** `limit` and when it resets, when a route limit halted the shift. */
  halt?: { kind: string; resetsAt?: string }
  /** Why each ticket did not ship, or the record's own reason when the shift crashed before its report. */
  reasons: string[]
}

/**
 * @param dir - One record's directory.
 * @param name - Its name.
 * @returns The record, or `undefined` when its result cannot be read.
 */
function readShiftRecord(dir: string, name: string): ShiftRecord | undefined {
  const result = readJson(join(dir, 'result.json'))
  const manifest = readJson(join(dir, 'manifest.json'))
  if (!isRecord(result)) return undefined
  const startedAt = msOf(result.startedAt)
  const endedAt = msOf(isRecord(manifest) ? manifest.endedAt : undefined) ?? msOf(result.endedAt) ?? startedAt
  if (startedAt === undefined || endedAt === undefined) return undefined
  const tickets = Array.isArray(result.tickets) ? result.tickets.filter(isRecord) : []
  const halt = isRecord(result.halt) ? result.halt : undefined
  const reasons = tickets.flatMap(ticket => (ticket.shipped === null || ticket.shipped === undefined) && typeof ticket.ticket === 'string'
    ? [`${ticket.ticket}: ${typeof ticket.reason === 'string' ? ticket.reason : 'no reason recorded'}`]
    : [])
  return {
    name,
    shift: typeof result.shift === 'string' ? result.shift : name.slice(-11),
    startedAt,
    endedAt,
    shipped: tickets.filter(ticket => isRecord(ticket.shipped)).length,
    ...halt === undefined ? {} : { halt: { kind: String(halt.kind), ...typeof halt.resetsAt === 'string' ? { resetsAt: halt.resetsAt } : {} } },
    reasons: result.report === null || result.report === undefined
      ? typeof result.reason === 'string' ? [result.reason] : reasons
      : reasons,
  }
}

/**
 * Flag the shifts that did not deliver: every committed shift record in the
 * window newer than the newest shift that shipped (halted at a route limit,
 * or shipping nothing), and every shift whose scratch run no process holds,
 * that left no record, and has been silent past the abandon threshold.
 * @param c - The collection.
 * @param scratchRuns - The scratch runs {@link collectScratch} read.
 */
function collectShiftRecords(c: Collection, scratchRuns: readonly ScratchRun[]): void {
  const dir = join(c.inputs.root, 'data/enterprise/shifts')
  const names = listDir(dir) ?? []
  const records = names
    .filter(name => /^\d{4}-\d{2}-\d{2}-\d{6}-[0-9a-f]{4}$/.test(name))
    .flatMap(name => readShiftRecord(join(dir, name), name) ?? [])
    .filter(record => record.endedAt >= c.since)
    .sort((a, b) => a.startedAt - b.startedAt)
  const lastShipped = records.findLastIndex(record => record.shipped > 0)
  for (const record of records.slice(lastShipped + 1)) {
    const evidence = [blobLink(c.inputs.branch, `data/enterprise/shifts/${record.name}/result.json`)]
    const why = publicLine(record.reasons.join('; ') || 'the record states no reason', 220)
    if (record.halt !== undefined) {
      const reset = record.halt.resetsAt === undefined ? 'no reset stated' : `resets at ${record.halt.resetsAt}`
      c.flag({
        id: `shift-halted:${record.shift}`,
        kind: 'shift-halted',
        severity: 'high',
        title: `Shift ${record.shift} halted at its ${record.halt.kind === 'limit' ? 'usage limit' : record.halt.kind}`,
        detail: `The route refused further turns (${reset}); ${record.shipped} shipped. ${why}.`,
        at: iso(record.endedAt),
        evidence,
        next: record.halt.resetsAt === undefined
          ? 'Its tickets stay open; check the route\'s limit before the next cycle takes them again.'
          : `Its tickets stay open; the first cycle after ${record.halt.resetsAt} takes them again.`,
      })
    } else {
      c.flag({
        id: `shift-failed:${record.shift}`,
        kind: 'shift-failed',
        severity: 'medium',
        title: `Shift ${record.shift} shipped nothing`,
        detail: `${why}.`,
        at: iso(record.endedAt),
        evidence,
        next: 'Read the shift record\'s result.json and its session logs; each ticket the ledger halted or rejected is listed on its own.',
      })
    }
  }
  for (const run of scratchRuns) {
    if (run.live || run.intake || names.some(name => name.endsWith(`-${run.id}`))) continue
    const last = Math.max(mtimeOf(run.dir) ?? 0, mtimeOf(join(run.dir, 'run.log')) ?? 0)
    const result = runLogResult(run.dir)
    if (typeof result?.error === 'string' && last >= c.since) {
      flagUnpushed(c, run, result, result.error, last)
      continue
    }
    if (last < c.since || c.now - last < c.inputs.abandonMs) continue
    c.flag({
      id: `shift-abandoned:${run.id}`,
      kind: 'shift-abandoned',
      severity: 'high',
      title: `Shift ${run.id} was abandoned`,
      detail: `No process holds it, no shift record reached the branch, and its scratch run has been silent for ${hoursSince(c.now, last)}: the shift stopped before it recorded (a crash, a reset or a stop by hand).`,
      at: iso(last),
      evidence: [{ label: `shift ${run.id} scratch run`, path: homePath(run.dir) }],
      next: `Read ${homePath(join(run.dir, 'run.log'))} for its last lines; its tickets stay open and the next shift takes them again.`,
    })
  }
}

/**
 * Flag a shift whose run log closes with an error: it could not finalize or
 * push, so nothing it did reached the branch or the ledger, and what it
 * assembled is only in its kept clone.
 * @param c - The collection.
 * @param run - The shift's scratch run.
 * @param result - Its run log's closing result.
 * @param error - The result's error.
 * @param at - When the run log was last written, epoch milliseconds.
 */
function flagUnpushed(c: Collection, run: ScratchRun, result: Record<string, unknown>, error: string, at: number): void {
  const assembled = (Array.isArray(result.tickets) ? result.tickets.filter(isRecord) : [])
    .flatMap(entry => (typeof entry.ticket === 'string' && isRecord(entry.shipped) ? [entry.ticket] : []))
  const clone = typeof result.repo === 'string' ? homePath(result.repo) : homePath(join(run.dir, 'repo'))
  c.flag({
    id: `shift-unpushed:${run.id}`,
    kind: 'shift-failed',
    severity: 'high',
    title: assembled.length === 0
      ? `Shift ${run.id} failed before it recorded`
      : `Shift ${run.id} assembled ${assembled.join(', ')} but did not push`,
    detail: `${publicLine(error, 200)}. No ledger line and no shift record reached the branch${assembled.length === 0 ? '' : `, so ${assembled.length === 1 ? 'the ticket is' : 'the tickets are'} still open`}.`,
    at: iso(at),
    evidence: [{ label: `shift ${run.id} run.log`, path: homePath(join(run.dir, 'run.log')) }],
    next: assembled.length === 0
      ? `Read ${homePath(join(run.dir, 'run.log'))} for the failure; the next shift works its tickets again.`
      : `Decide now: finalize and push the kept clone (${clone}) by hand, or leave ${assembled.join(', ')} open for the next shift, which works ${assembled.length === 1 ? 'it' : 'them'} again from the start.`,
  })
}

// ---------------------------------------------------------------------------
// The shift view: the running shift's tickets and each department's stage
// ---------------------------------------------------------------------------

/** A ticket's seat and division from the queue, and its title when the source gave none. */
function ticketFacts(id: string, tickets: Map<string, TicketFile> | undefined, title: string | undefined): Pick<OpsShiftTicket, 'title' | 'seat' | 'division'> {
  const file = tickets?.get(id)
  const named = title ?? file?.title
  return {
    ...named === undefined ? {} : { title: publicLine(named, 120) },
    ...file?.seat === undefined ? {} : { seat: file.seat },
    ...file?.division === undefined ? {} : { division: file.division },
  }
}

/**
 * The tickets of a shift's result, as its committed record or its run log's
 * closing line states them: shipped with its commit, rejected by its review,
 * else halted with the reason. A result carrying `error` is a shift that could
 * not finalize or push, so a ticket it assembled reached the kept clone and not
 * the branch: it is halted at integration, with that error as its reason.
 * @param result - The decoded result.
 * @param tickets - The queue, for titles and seats.
 * @param since - When the shift ended, epoch milliseconds, when known.
 * @returns The tickets, or `undefined` when the result lists none.
 */
function resultTickets(
  result: Record<string, unknown>,
  tickets: Map<string, TicketFile> | undefined,
  since: number | undefined,
): OpsShiftTicket[] | undefined {
  if (!Array.isArray(result.tickets)) return undefined
  const unpushed = typeof result.error === 'string' ? result.error : undefined
  return result.tickets.filter(isRecord).flatMap((entry) => {
    if (typeof entry.ticket !== 'string') return []
    const assembled = isRecord(entry.shipped) && typeof entry.shipped.commit === 'string' ? entry.shipped.commit : undefined
    const shipped = unpushed === undefined ? assembled : undefined
    const verdict = isRecord(entry.review) && typeof entry.review.verdict === 'string' ? entry.review.verdict.trim().toLowerCase() : undefined
    const stage: OpsShiftTicket['stage'] = shipped !== undefined ? 'shipped' : verdict === 'reject' ? 'rejected' : 'halted'
    const integration = isRecord(entry.integration) ? entry.integration.outcome : undefined
    const department = isRecord(entry.department) ? entry.department.outcome : undefined
    const reached: OpsShiftTicket['reached'] = assembled !== undefined || (integration !== undefined && integration !== 'skipped') ? 'integration'
      : verdict === 'approve' || verdict === 'reject' ? 'review'
        : department === 'certified' ? 'certified'
          : 'working'
    const reason = assembled !== undefined && unpushed !== undefined ? `assembled, but the shift did not push it: ${unpushed}` : entry.reason
    return [{
      ticket: entry.ticket,
      ...ticketFacts(entry.ticket, tickets, undefined),
      stage,
      ...stage === 'shipped' ? {} : { reached },
      ...since === undefined ? {} : { since: iso(since) },
      ...stage !== 'shipped' && typeof reason === 'string' ? { reason: publicLine(reason, 160) } : {},
      ...shipped === undefined ? {} : { commit: shipped },
    }]
  })
}

/**
 * The closing `{"type":"result"}` line a shift's run log carries once the shift ended.
 * @param dir - The shift's scratch run.
 * @returns The decoded result, or `undefined` while the shift runs or when the log has none.
 */
function runLogResult(dir: string): Record<string, unknown> | undefined {
  const text = readText(join(dir, 'run.log'))
  let found: Record<string, unknown> | undefined
  for (const row of text?.split('\n') ?? []) {
    if (!row.startsWith('{"type":"result"')) continue
    try {
      const decoded: unknown = JSON.parse(row)
      if (isRecord(decoded)) found = decoded
    } catch {
      // A result line cut by a crash mid-write: the shift is read from its sessions instead.
    }
  }
  return found
}

/**
 * One shift read from its scratch run: the program ledger's goals, each moved
 * past `certified` by its review session and its verdict, and every ticket's
 * final stage from the run log's result once the shift ended.
 * @param c - The collection.
 * @param run - The scratch run.
 * @param tickets - The queue, for titles and seats.
 * @returns The shift, or `undefined` when the run holds no program ledger yet.
 */
function scratchShift(c: Collection, run: ScratchRun, tickets: Map<string, TicketFile> | undefined): OpsShift | undefined {
  const sessionsDir = join(run.dir, '.sessions')
  const files = existsSync(sessionsDir) ? sessionFilesIn(sessionsDir) : []
  const programFile = files.find(file => /^program-[0-9a-f]{16,}$/.test(basename(dirname(file))))
  const program = programFile === undefined ? undefined : foldProgramLedger(parseJsonl(readText(programFile) ?? ''))
  const result = run.live ? undefined : runLogResult(run.dir)
  const endedAt = result === undefined ? undefined : mtimeOf(join(run.dir, 'run.log'))
  const final = result === undefined ? undefined : resultTickets(result, tickets, endedAt)
  if (program === undefined && final === undefined) return undefined
  const reviews = new Map<string, { verdict?: 'approve' | 'reject'; startedAt?: number; lastAt?: number }>()
  for (const file of files) {
    const id = basename(dirname(file))
    const ticket = /^review-t-(\d{4})\b/.exec(id)?.[1]
    if (ticket === undefined) continue
    const lines = parseJsonl(readText(file) ?? '')
    const facts = foldHarnessSession(lines, id)
    const verdict = reviewVerdictOf(lines)
    reviews.set(`T-${ticket}`, { ...verdict === undefined ? {} : { verdict }, ...facts.createdAt === undefined ? {} : { startedAt: facts.createdAt }, ...facts.lastAt === undefined ? {} : { lastAt: facts.lastAt } })
  }
  const stageOf = (status: string, review: { verdict?: 'approve' | 'reject'; startedAt?: number; lastAt?: number } | undefined, since: number | undefined): Pick<OpsShiftTicket, 'stage' | 'since'> => {
    const at = (ms: number | undefined): Pick<OpsShiftTicket, 'since'> => (ms === undefined ? {} : { since: iso(ms) })
    switch (status) {
      case 'pending': return { stage: 'queued', ...at(since) }
      case 'running': return { stage: 'working', ...at(since) }
      case 'certified':
        if (review === undefined) return { stage: 'certified', ...at(since) }
        if (review.verdict === 'reject') return { stage: 'rejected', ...at(review.lastAt) }
        return review.verdict === 'approve' ? { stage: 'integration', ...at(review.lastAt) } : { stage: 'review', ...at(review.startedAt) }
      default: return { stage: 'halted', ...at(since) }
    }
  }
  const live: OpsShiftTicket[] = (program?.goals ?? []).map((goal) => {
    const id = goal.key.toUpperCase()
    const { stage, since } = stageOf(goal.status, reviews.get(id), goal.since)
    return {
      ticket: id,
      ...ticketFacts(id, tickets, goal.title),
      stage,
      ...stage === 'halted' ? { reached: 'working' as const } : stage === 'rejected' ? { reached: 'review' as const } : {},
      ...since === undefined ? {} : { since },
      ...stage === 'halted' && goal.reason !== undefined ? { reason: goal.reason } : {},
    }
  })
  const startedAt = msOf(result?.startedAt) ?? program?.startedAt ?? mtimeOf(run.dir) ?? c.now
  return {
    shift: run.id,
    state: run.live ? 'running' : 'ended',
    startedAt: iso(startedAt),
    ...endedAt === undefined ? {} : { endedAt: iso(endedAt) },
    source: 'scratch',
    tickets: final ?? live,
    evidence: { label: `shift ${run.id} run.log` },
  }
}

/**
 * The shift the view follows: the one holding the shift lock; else the newest
 * of the committed shift records and the scratch runs no record covers yet.
 * @param c - The collection.
 * @param scratchRuns - The scratch runs {@link collectScratch} read.
 * @param tickets - The queue, for titles and seats.
 * @returns The shift, or `null` when no shift is known.
 */
function collectShift(c: Collection, scratchRuns: readonly ScratchRun[], tickets: Map<string, TicketFile> | undefined): OpsShift | null {
  const shifts = scratchRuns.filter(run => !run.intake)
  const running = shifts.find(run => run.live)
  if (running !== undefined) return scratchShift(c, running, tickets) ?? null
  const dir = join(c.inputs.root, 'data/enterprise/shifts')
  const newestRecord = (listDir(dir) ?? []).filter(name => /^\d{4}-\d{2}-\d{2}-\d{6}-[0-9a-f]{4}$/.test(name)).sort().at(-1)
  // A scratch run is named `<HHMMSS>-<hex>` for its start; one newer than every record has not reached the checkout.
  const newestScratch = shifts
    .filter(run => newestRecord === undefined || (mtimeOf(run.dir) ?? 0) > (msOf(`${newestRecord.slice(0, 10)}T${newestRecord.slice(11, 13)}:${newestRecord.slice(13, 15)}:${newestRecord.slice(15, 17)}Z`) ?? 0))
    .filter(run => !newestRecord?.endsWith(`-${run.id}`))
    .sort((a, b) => (mtimeOf(a.dir) ?? 0) - (mtimeOf(b.dir) ?? 0))
    .at(-1)
  const fromScratch = newestScratch === undefined ? undefined : scratchShift(c, newestScratch, tickets)
  if (fromScratch !== undefined) return fromScratch
  if (newestRecord === undefined) return null
  const result = readJson(join(dir, newestRecord, 'result.json'))
  const manifest = readJson(join(dir, newestRecord, 'manifest.json'))
  if (!isRecord(result)) return null
  const startedAt = msOf(result.startedAt) ?? msOf(isRecord(manifest) ? manifest.startedAt : undefined)
  const endedAt = msOf(isRecord(manifest) ? manifest.endedAt : undefined) ?? msOf(result.endedAt)
  if (startedAt === undefined) return null
  return {
    shift: typeof result.shift === 'string' ? result.shift : newestRecord.slice(11),
    state: 'ended',
    startedAt: iso(startedAt),
    ...endedAt === undefined ? {} : { endedAt: iso(endedAt) },
    source: 'record',
    tickets: resultTickets(result, tickets, endedAt) ?? [],
    evidence: blobLink(c.inputs.branch, `data/enterprise/shifts/${newestRecord}/result.json`),
  }
}

// ---------------------------------------------------------------------------
// Heartbeats: the scheduler, the transcript capture, the operations loop
// ---------------------------------------------------------------------------

/** How often the transcript capture runs by default (`TRANSCRIPTS_CAPTURE_MINUTES`). */
const CAPTURE_EVERY_SECONDS = 300

/** How to start each loop, as the attention queue states it. */
const LOOP_START: Record<'transcript-capture' | 'ops-loop', string> = {
  'transcript-capture': 'From its own worktree of the branch: nohup setsid bash scripts/transcripts-capture.sh >> /home/user/enterprise-cycles/transcripts-capture.log 2>&1 < /dev/null & (data/transcripts/README.md).',
  'ops-loop': 'From its own worktree of the branch: setsid nohup bash scripts/enterprise-ops-live.sh >> /home/user/enterprise-cycles/ops-live.log 2>&1 < /dev/null & (apps/command-deck/mirror/README.md).',
}

/** What one loop's heartbeat is read from. */
interface BeatReading {
  id: OpsHeartbeat['id']
  label: string
  /** Its process, when the process table shows one. */
  running: ProcessInfo | undefined
  /** Its newest run, epoch milliseconds, when a record of one was read. */
  lastRun: number | undefined
  everySeconds: number
  /** How long after `measuredAt` the newest run may be before the loop is late. */
  allowanceMs: number
  /**
   * When lateness is measured: the collection for a record read live, the
   * checkout's newest fetch for a run the branch history records, since the
   * checkout cannot see a run pushed after it.
   */
  measuredAt: number
}

/**
 * How long ago something happened, in seconds, minutes or hours.
 * @param now - The collection's time.
 * @param then - The moment.
 * @returns `12 s`, `16 minutes` or `2.0 hours`.
 */
function ago(now: number, then: number): string {
  const seconds = Math.max(0, Math.round((now - then) / 1000))
  return seconds < 90 ? `${seconds} s` : hoursSince(now, then)
}

/**
 * One loop's heartbeat from its process and its newest run: alive while the
 * process runs and the newest run is inside the allowance, late past it.
 * @param c - The collection.
 * @param processesRead - Whether the process table was read.
 * @param beat - The loop's process and newest run.
 * @returns The heartbeat.
 */
function heartbeat(c: Collection, processesRead: boolean, beat: BeatReading): OpsHeartbeat {
  const { lastRun, running } = beat
  const when = lastRun === undefined ? 'no run recorded in the window' : `last ran ${ago(c.now, lastRun)} ago`
  const state: OpsHeartbeat['state'] = !processesRead ? 'unknown'
    : running === undefined ? 'down'
      : lastRun !== undefined && beat.measuredAt - lastRun <= beat.allowanceMs ? 'alive' : 'late'
  const detail = state === 'unknown' ? `the process table could not be read; ${when}`
    : state === 'down' ? `no process runs; ${when}`
      : `pid ${running?.pid ?? '?'}; ${when}`
  return {
    id: beat.id,
    label: beat.label,
    state,
    ...lastRun === undefined ? {} : { lastRunAt: iso(lastRun) },
    everySeconds: beat.everySeconds,
    detail,
  }
}

/**
 * The heartbeats of the loops the enterprise runs on, and an attention item
 * for a transcript capture or an operations loop that is down or late (the
 * scheduler's own items cover it).
 * @returns The scheduler's, the transcript capture's and the operations loop's heartbeats.
 */
function collectHeartbeats(
  c: Collection,
  processes: ProcessInfo[] | undefined,
  history: string | undefined,
  cycles: CycleReading,
  checkoutAt: number | undefined,
): OpsHeartbeat[] {
  const read = processes !== undefined
  const find = (script: string): ProcessInfo | undefined => processes?.find(entry => runs(entry, script))
  const opsEvery = c.inputs.producer === 'loop' ? c.inputs.intervalSeconds ?? 15 : 15
  // The capture's own log dates its newest push as it landed; the checkout's history sees a push only after its next fetch.
  const capture = parseCaptureLog(readText(join(c.inputs.cyclesDir, 'transcripts-capture.log')) ?? '')
  const captureBeat = heartbeat(c, read, {
    id: 'transcript-capture',
    label: 'Transcript capture',
    running: find('scripts/transcripts-capture.sh'),
    lastRun: capture.push?.at ?? (history === undefined ? undefined : newestCapture(history)),
    everySeconds: CAPTURE_EVERY_SECONDS,
    allowanceMs: 3 * CAPTURE_EVERY_SECONDS * 1000,
    measuredAt: capture.push === undefined ? checkoutAt ?? c.now : c.now,
  })
  if (capture.push !== undefined) {
    captureBeat.lastPush = { at: iso(capture.push.at), commit: capture.push.commit }
    captureBeat.detail = `${captureBeat.detail}; pushed ${capture.push.commit}`
  }
  if (capture.problem !== undefined && capture.problem.at > (capture.push?.at ?? 0)) {
    captureBeat.detail = `${captureBeat.detail}; its newest round did not push: ${capture.problem.line}`
  }
  const beats = [
    heartbeat(c, read, {
      id: 'scheduler', label: 'Cycle scheduler', running: cycles.scheduler, lastRun: cycles.lastTick, everySeconds: 7200, allowanceMs: c.inputs.staleMs, measuredAt: c.now,
    }),
    captureBeat,
    heartbeat(c, read, {
      id: 'ops-loop',
      label: 'Operations loop',
      running: find('enterprise-ops-live.sh'),
      lastRun: c.inputs.producer === 'loop' ? c.now : mtimeOf(c.inputs.opsLoopState),
      everySeconds: opsEvery,
      allowanceMs: Math.max(3 * opsEvery * 1000, 120_000),
      measuredAt: c.now,
    }),
  ]
  for (const beat of beats) {
    if (beat.id === 'scheduler' || (beat.state !== 'down' && beat.state !== 'late')) continue
    const loop = beat.id === 'transcript-capture' ? 'transcript-capture' : 'ops-loop'
    c.flag({
      id: `heartbeat:${beat.id}`,
      kind: 'heartbeat-down',
      severity: beat.state === 'down' ? 'medium' : 'low',
      title: `The ${beat.label.toLowerCase()} is ${beat.state === 'down' ? 'not running' : 'late'}`,
      detail: beat.id === 'transcript-capture'
        ? `${beat.detail}. A container reset erases every transcript written since the newest capture.`
        : `${beat.detail}. The public deck shows the operations snapshot as a replay until the loop pushes again.`,
      ...beat.lastRunAt === undefined ? {} : { at: beat.lastRunAt },
      evidence: [],
      next: beat.state === 'down' ? LOOP_START[loop] : 'Read the loop\'s log in /home/user/enterprise-cycles/ for its newest failure.',
    })
  }
  return beats
}

// ---------------------------------------------------------------------------
// Tickets and stuck agents
// ---------------------------------------------------------------------------

function newestTicketLines(lines: readonly NumberedLine[]): Map<string, { line: number; entry: TicketLine }> {
  const newest = new Map<string, { line: number; entry: TicketLine }>()
  for (const numbered of lines) {
    if (numbered.entry.type !== 'ticket') continue
    const known = newest.get(numbered.entry.ticket)
    if (known !== undefined && numbered.entry.at < known.entry.at) continue
    newest.set(numbered.entry.ticket, { line: numbered.line, entry: numbered.entry })
  }
  return newest
}

function flagTickets(c: Collection, ledger: { lines: NumberedLine[] } | undefined, tickets: Map<string, TicketFile> | undefined): void {
  if (ledger === undefined) return
  for (const { line, entry } of newestTicketLines(ledger.lines).values()) {
    const status = ticketStatus(entry)
    if (status === 'shipped') continue
    if (status === 'rejected' && Date.parse(entry.at) < c.since) continue
    const title = tickets?.get(entry.ticket)?.title
    const limit = /limit \(resets at ([^)]+)\)/.exec(entry.reason ?? '')?.[1]
    c.flag({
      id: `ticket:${entry.ticket}:${status}`,
      kind: status === 'halted' ? 'ticket-halted' : 'ticket-rejected',
      severity: status === 'halted' ? 'medium' : 'low',
      title: `${entry.ticket} ${status} in shift ${entry.shift}`,
      detail: publicLine(`${title === undefined ? '' : `${title}. `}${entry.reason ?? 'no reason recorded'}`, 180),
      at: entry.at,
      evidence: [
        blobLink(c.inputs.branch, 'data/enterprise/ledger.jsonl', line),
        blobLink(c.inputs.branch, `data/enterprise/tickets/${entry.ticket}.json`),
      ],
      next: status === 'rejected'
        ? 'Read the reviewer\'s rationale in the shift record; file a narrower ticket if the change is still wanted.'
        : limit !== undefined
          ? `The route's usage limit stopped it; a shift after ${limit} works it again.`
          : 'It stays open and a later shift works it again; read the department\'s report in the shift record first.',
    })
  }
}

/** The next action for a stuck agent, by kind. */
const NEXT_FOR_STUCK: Record<OpsAgentKind, string> = {
  'cycle-step': 'Read the cycle log\'s tail; a hung step holds every later slot, so stop it if it does not move.',
  department: 'Read its newest session events; the ticket budget ends it at 45 minutes of wall time, and a later shift works the ticket again.',
  reviewer: 'Read its session log; a review that never answers leaves the ticket halted.',
  coordinator: 'Read its session log under the intake\'s scratch directory.',
  'function-gate': 'The gate runs under the heavy lock; check what else holds /tmp/dsh-heavy.lock.',
  'bench-cell': 'Read the cell\'s session log; the bench loop records a failed iteration and continues.',
  'operator-agent': 'Open its transcript from the operator session and message or stop it.',
}

/**
 * A running cycle step logs nothing while the shift, the intake or the gates
 * it started work, so its newest event is the newest event of those agents.
 * @param c - The collection, whose cycle agent is updated in place.
 */
function settleCycleAgent(c: Collection): void {
  const cycle = c.agents.find(agent => agent.kind === 'cycle-step')
  if (cycle === undefined) return
  const children = c.agents.filter(agent => agent.run !== undefined && /^(shift|intake) |^functions$/.test(agent.run))
  const newest = Math.max(Date.parse(cycle.lastEventAt), ...children.map(agent => Date.parse(agent.lastEventAt)))
  const idle = Math.max(0, c.now - newest)
  cycle.lastEventAt = iso(newest)
  cycle.idleSeconds = Math.round(idle / 1000)
  cycle.state = idle > c.inputs.stuckMs ? 'stuck' : 'working'
}

function flagStuck(c: Collection): void {
  for (const agent of c.agents) {
    if (agent.state !== 'stuck') continue
    c.flag({
      id: `stuck:${agent.id}`,
      kind: 'agent-stuck',
      severity: 'high',
      title: `${agent.label} silent for ${hoursSince(c.now, Date.parse(agent.lastEventAt))}`,
      detail: `Its newest event: ${agent.doing}.`,
      at: agent.lastEventAt,
      evidence: agent.evidence === undefined ? [] : [agent.evidence],
      next: NEXT_FOR_STUCK[agent.kind],
    })
  }
}

// ---------------------------------------------------------------------------
// The big picture
// ---------------------------------------------------------------------------

function seatCounts(roster: RosterRead | undefined, agents: readonly OpsAgent[]): OpsBigPicture['seats'] {
  if (roster === undefined) return null
  const working = new Set(agents.flatMap(agent => (agent.seat === undefined ? [] : [agent.seat])))
  const count = (seats: readonly RosterSeat[]): { defined: number; occupied: number; activeToday: number; workingNow: number } => ({
    defined: seats.length,
    occupied: seats.filter(seat => seat.occupied).length,
    activeToday: seats.filter(seat => seat.status === 'active').length,
    workingNow: seats.filter(seat => working.has(seat.id)).length,
  })
  const all = [...roster.seats.values()]
  return {
    ...count(all),
    divisions: roster.divisions.map(division => ({
      id: division.id,
      name: division.name,
      ...count(all.filter(seat => seat.division === division.id)),
    })),
  }
}

function ticketCounts(c: Collection, ledger: { lines: NumberedLine[] } | undefined, tickets: Map<string, TicketFile> | undefined): OpsBigPicture['tickets'] {
  if (ledger === undefined || tickets === undefined) return null
  const newest = newestTicketLines(ledger.lines)
  let halted = 0
  let shipped = 0
  let rejected = 0
  for (const { entry } of newest.values()) {
    const status = ticketStatus(entry)
    if (status === 'halted') halted += 1
    else if (Date.parse(entry.at) >= c.since) {
      if (status === 'shipped') shipped += 1
      else rejected += 1
    }
  }
  const queued = [...tickets.keys()].filter(id => !newest.has(id)).length
  return { queued, halted, shipped, rejected }
}

function throughput(c: Collection, lines: readonly NumberedLine[]): NonNullable<OpsBigPicture['throughput']> {
  const hourMs = 3_600_000
  const lastHour = Math.floor(c.now / hourMs) * hourMs
  const hours: OpsHour[] = Array.from({ length: 24 }, (_, index) => ({
    hour: iso(lastHour - ((23 - index) * hourMs)),
    shipped: 0,
    rejected: 0,
    halted: 0,
    functions: 0,
    runs: 0,
  }))
  const bucket = (ms: number): OpsHour | undefined => hours[23 - Math.floor((lastHour - Math.floor(ms / hourMs) * hourMs) / hourMs)]
  let shipped = 0
  let deliverables = 0
  for (const { entry } of lines) {
    const at = Date.parse(entry.at)
    if (at < c.since || at > c.now) continue
    const hour = bucket(at)
    if (hour === undefined) continue
    deliverables += 1
    if (entry.type === 'function') {
      hour.functions += 1
      continue
    }
    const status = ticketStatus(entry)
    hour[status] += 1
    if (status === 'shipped') shipped += 1
  }
  for (const run of c.runs.values()) {
    const at = Date.parse(run.startedAt)
    if (at >= c.since && at <= c.now) {
      const hour = bucket(at)
      if (hour !== undefined) hour.runs += 1
    }
  }
  return { hours, shippedPerHour: Math.round((shipped / 24) * 100) / 100, deliverablesPerHour: Math.round((deliverables / 24) * 100) / 100 }
}

// ---------------------------------------------------------------------------
// Output: file, fixture, relay
// ---------------------------------------------------------------------------

/**
 * Write a file atomically: to a sibling temporary name, then renamed over.
 * @param file - The destination.
 * @param content - The bytes.
 */
export function writeAtomic(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  writeFileSync(temporary, content)
  renameSync(temporary, file)
}

/**
 * Send the snapshot to the mirror relay: `/ops` through `POST /json`, and the
 * activity frames newer than the last push through `POST /events` as the `ops`
 * run, in the relay's gzip envelope.
 * @param snapshot - The snapshot.
 * @param ingest - The relay's `ingest` function URL.
 * @param token - The relay's write token.
 * @param state - The collector's state; `pushedUntil` advances.
 */
export async function pushToRelay(snapshot: OpsSnapshot, ingest: string, token: string, state: OpsState): Promise<void> {
  const post = async (path: string, body: unknown): Promise<void> => {
    const response = await fetch(`${ingest.replace(/\/+$/, '')}${path}`, {
      method: 'POST',
      headers: { 'x-daliesk-token': token, 'content-type': 'application/json' },
      body: JSON.stringify({ gz: gzipSync(Buffer.from(JSON.stringify(body))).toString('base64') }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) throw new Error(`relay ${path} answered ${response.status}: ${(await response.text()).slice(0, 160)}`)
  }
  await post('/json', { path: '/ops', body: snapshot })
  const fresh = snapshot.activity.filter(frame => frame.ts > (state.pushedUntil ?? 0) - 60_000)
  if (fresh.length > 0) {
    await post('/events', { runId: 'ops', events: fresh })
    state.pushedUntil = Math.max(...fresh.map(frame => frame.ts))
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/** The CLI's options, as parsed. */
export interface OpsCli {
  out?: string
  fixture: boolean
  push: boolean
  producer: OpsSnapshot['producer']
  interval?: number
  state: string
  ci: boolean
  cyclesDir: string
  scratch: string
  claudeProjects: string
  operatorTree: string
  benchRoots: string[]
  benchLog: string
  branch: string
  stuckMinutes: number
  staleHours: number
  abandonMinutes: number
  ciMaxAgeSeconds: number
}

/**
 * Parse the command line.
 * @param argv - The arguments after the script.
 * @param env - The environment.
 * @returns The options.
 * @throws On an unknown flag or a value that is not a positive number.
 */
export function parseOpsArgs(argv: readonly string[], env: NodeJS.ProcessEnv): OpsCli {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      out: { type: 'string' },
      fixture: { type: 'boolean', default: false },
      push: { type: 'boolean', default: false },
      producer: { type: 'string' },
      interval: { type: 'string' },
      state: { type: 'string' },
      'no-ci': { type: 'boolean', default: false },
      'cycles-dir': { type: 'string' },
      scratch: { type: 'string' },
      'claude-projects': { type: 'string' },
      'operator-tree': { type: 'string' },
      'bench-root': { type: 'string', multiple: true },
      'bench-log': { type: 'string' },
      branch: { type: 'string' },
      'stuck-minutes': { type: 'string' },
      'stale-hours': { type: 'string' },
      'abandon-minutes': { type: 'string' },
      'ci-max-age': { type: 'string' },
    },
    allowPositionals: false,
    strict: true,
  })
  const positive = (name: string, raw: string | undefined, fallback: number): number => {
    if (raw === undefined) return fallback
    const value = Number(raw)
    if (!Number.isFinite(value) || value <= 0) throw new Error(`enterprise-ops: --${name} must be a positive number, got ${JSON.stringify(raw)}`)
    return value
  }
  const producer = values.producer ?? (values.fixture ? 'cycle' : values.push ? 'loop' : 'cli')
  if (producer !== 'loop' && producer !== 'cycle' && producer !== 'feed' && producer !== 'cli') throw new Error(`enterprise-ops: --producer must be loop, cycle, feed or cli, got ${JSON.stringify(producer)}`)
  const home = env.HOME ?? homedir()
  const operatorTree = values['operator-tree'] ?? env.OPS_OPERATOR_TREE ?? '/home/user/deepseek-harness'
  return {
    ...values.out === undefined ? {} : { out: values.out },
    fixture: values.fixture,
    push: values.push,
    producer,
    ...values.interval === undefined ? {} : { interval: positive('interval', values.interval, 15) },
    state: values.state ?? join(tmpdir(), 'dsh-ops-state.json'),
    ci: !values['no-ci'],
    cyclesDir: values['cycles-dir'] ?? env.ENTERPRISE_CYCLE_LOGS ?? '/home/user/enterprise-cycles',
    scratch: values.scratch ?? env.DSH_ENTERPRISE_SCRATCH ?? join(tmpdir(), 'dsh-enterprise'),
    claudeProjects: values['claude-projects'] ?? join(home, '.claude/projects'),
    operatorTree,
    benchRoots: values['bench-root'] ?? [...new Set([REPO_ROOT, operatorTree])],
    benchLog: values['bench-log'] ?? join(tmpdir(), 'nightly-loop.log'),
    branch: values.branch ?? env.ENTERPRISE_BRANCH ?? OPS_BRANCH,
    stuckMinutes: positive('stuck-minutes', values['stuck-minutes'], 20),
    staleHours: positive('stale-hours', values['stale-hours'], 2.5),
    abandonMinutes: positive('abandon-minutes', values['abandon-minutes'], 30),
    ciMaxAgeSeconds: positive('ci-max-age', values['ci-max-age'], 120),
  }
}

/**
 * The GitHub reader the CLI uses: unauthenticated requests to the REST API,
 * through the proxy the environment names when Node's `fetch` honours it
 * (`NODE_USE_ENV_PROXY=1`, which the package script sets).
 * @returns The reader.
 */
function githubJson(): GitHubJson {
  return async (path) => {
    const response = await fetch(`https://api.github.com${path}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'deepseek-harness enterprise-ops' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error(`GET ${path.split('?')[0] ?? path} answered ${response.status}`)
    return await response.json() as unknown
  }
}

/** @returns A state nothing has been read into. */
export function emptyOpsState(): OpsState {
  return { format: OPS_STATE_FORMAT, transcripts: {}, records: {} }
}

/**
 * Read the collector's state file.
 * @param file - The state file.
 * @returns Its state, or an empty state when the file is missing, unreadable, or of another {@link OPS_STATE_FORMAT}.
 */
export function loadOpsState(file: string): OpsState {
  const raw = readJson(file)
  if (isRecord(raw) && raw.format === OPS_STATE_FORMAT && isRecord(raw.transcripts) && isRecord(raw.records)) {
    return raw as unknown as OpsState
  }
  return emptyOpsState()
}

/**
 * Whether a process is alive, by signal 0.
 * @param pid - The process.
 * @returns `true` when it exists.
 */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: it exists under another user; ESRCH: it does not.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Build the inputs the CLI collects from.
 * @param cli - The parsed options.
 * @param state - The loaded state.
 * @returns The inputs.
 */
export function cliInputs(cli: OpsCli, state: OpsState): OpsInputs {
  return {
    root: REPO_ROOT,
    now: new Date(),
    producer: cli.producer,
    ...cli.interval === undefined ? {} : { intervalSeconds: cli.interval },
    cyclesDir: cli.cyclesDir,
    scratch: cli.scratch,
    claudeProjects: cli.claudeProjects,
    operatorTree: cli.operatorTree,
    benchRoots: cli.benchRoots,
    benchLog: cli.benchLog,
    branch: cli.branch,
    stuckMs: cli.stuckMinutes * 60_000,
    staleMs: cli.staleHours * 3_600_000,
    abandonMs: cli.abandonMinutes * 60_000,
    // The path scripts/enterprise-ops-live.sh passes as --state.
    opsLoopState: join(tmpdir(), 'enterprise-ops-live-state.json'),
    ciMaxAgeMs: cli.ciMaxAgeSeconds * 1000,
    state,
    ...cli.ci ? { github: githubJson() } : {},
    processes: () => readProcesses(),
    alive,
    memory: () => parseMeminfo(readText('/proc/meminfo') ?? ''),
    disks: () => diskUsage(['/', tmpdir(), homedir(), REPO_ROOT]),
    git: (args) => {
      try {
        return execFileSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 })
      } catch {
        // Not a checkout, or git missing: the caller reports the history as unknown.
        return undefined
      }
    },
  }
}

async function main(argv: readonly string[]): Promise<number> {
  const cli = parseOpsArgs(argv, process.env)
  const state = loadOpsState(cli.state)
  const snapshot = await collectOps(cliInputs(cli, state))
  const json = `${JSON.stringify(snapshot, null, 2)}\n`
  let status = 0
  if (cli.out !== undefined) writeAtomic(resolve(cli.out), json)
  if (cli.fixture) writeAtomic(join(REPO_ROOT, OPS_FIXTURE), json)
  if (cli.push) {
    const ingest = process.env.INGEST_URL ?? ''
    const tokenFile = process.env.INGEST_TOKEN_FILE ?? ''
    const token = tokenFile === '' ? '' : (readText(tokenFile) ?? '').trim()
    if (ingest === '' || token === '') {
      process.stderr.write('enterprise-ops: --push needs INGEST_URL and a readable INGEST_TOKEN_FILE\n')
      status = 2
    } else {
      try {
        await pushToRelay(snapshot, ingest, token, state)
      } catch (error) {
        process.stderr.write(`enterprise-ops: ${error instanceof Error ? error.message : String(error)}\n`)
        status = 1
      }
    }
  }
  if (cli.out === undefined && !cli.fixture && !cli.push) process.stdout.write(json)
  writeAtomic(cli.state, JSON.stringify(state))
  const unknown = snapshot.sources.filter(source => source.state === 'unknown').map(source => source.id)
  process.stderr.write(`enterprise-ops: ${snapshot.agents.length} agents working, ${snapshot.attention.length} attention items${unknown.length === 0 ? '' : `, unknown: ${unknown.join(', ')}`}\n`)
  return status
}

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${resolve(process.argv[1])}`
if (isMain) {
  main(process.argv.slice(2)).then(code => process.exit(code), (error: unknown) => {
    process.stderr.write(`enterprise-ops: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(2)
  })
}
