/**
 * The feed contract the Command Deck reads.
 *
 * These types mirror the HTTP surface documented in `README.md`; the committed
 * fixtures under `fixtures/` satisfy the same types, so replay and live mode
 * render through one code path.
 */

/** Lifecycle of one agent definition inside the enterprise roster. */
export type AgentStatus = 'defined' | 'active' | 'certified' | 'failed'

/** Relationship kinds between two agents in the roster graph. */
export type EdgeKind = 'delegates' | 'verifies' | 'judges' | 'merges' | 'reads' | 'reports'

/** Event kinds carried by a run's Server-Sent Events stream. */
export type EventKind
  = 'step' | 'tool' | 'delegation' | 'directive' | 'certificate' | 'finding' | 'merge' | 'refusal'

/** Severity ladder shared by findings, events, and the certificate counts. */
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'

/**
 * How far the department traced a finding: `confirmed` read the source, the
 * sink and the path between them, `likely` a dangerous sink with a plausible
 * source, `possible` the pattern without established reachability.
 */
export type Confidence = 'confirmed' | 'likely' | 'possible'

/** Run categories the deck can subscribe to. */
export type RunKind = 'program' | 'fleet' | 'experiment' | 'code-safety'

/** The model route a seat is defined for. */
export interface AgentRoute {
  provider: string
  model: string
}

/** What the recorded sessions show of one seat, attributed by the feed's rules. */
export interface SeatEvidence {
  /** Sessions attributed to the seat; `0` for a seat no recorded session occupied. */
  sessions: number
  /** When the newest of those sessions last logged anything, as an ISO time. */
  lastSeen?: string
  /** Provider route keys those sessions ran on, sorted; empty when none made a model request. */
  routesSeen: string[]
}

/**
 * What a deliverable was: `model` when a model did the work (a recorded
 * session, a ticket its department spent model tokens on, a code-safety review
 * or an intake), `check` when a script or a read did it (a `verify-*` gate, a
 * CI verdict read from GitHub, a fold of recorded sessions), and `halted` for a
 * ticket its shift stopped before any model ran.
 */
export type WorkKind = 'model' | 'check' | 'halted'

/** Seats per kind of work. */
export type WorkCounts = Record<WorkKind, number>

/** The kind of one occupied seat's work: the strongest kind among all its deliverables, and among those inside the window. */
export interface SeatWork {
  occupied: WorkKind
  /** Present exactly when the seat is active. */
  active?: WorkKind
}

/** The ledger lines naming one seat's id: its tickets worked and functions performed. */
export interface SeatLedger {
  lines: number
  /** When the newest of those lines is dated, as an ISO time. */
  lastAt?: string
}

/** One defined seat in the enterprise. */
export interface Agent {
  id: string
  name: string
  role: string
  division: string
  department?: string
  /** The route the seat is defined for; `evidence.routesSeen` names what its sessions actually ran on. */
  route: AgentRoute
  preset: string
  skills: string[]
  tools: string[]
  source: string
  /** `active` when the seat's newest deliverable falls inside the roster's window; the feed overlays live session status. */
  status: AgentStatus
  evidence: SeatEvidence
  /** Absent from a feed built before the ledger existed, which the relay may still serve. */
  ledger?: SeatLedger
  /** Absent for a seat no deliverable occupies, and from a roster built before the split existed. */
  work?: SeatWork
}

/** A named cluster of agents; `purpose` is the one-line charter shown in 3D. */
export interface Division {
  id: string
  name: string
  purpose: string
}

/** A directed relationship between two agents. */
export interface RosterEdge {
  from: string
  to: string
  kind: EdgeKind
}

/**
 * Why a recorded session occupies no seat: it ran a bench environment no seat
 * is specialized in, it belongs to a program run that is not a code-safety
 * review, it belongs to a review under a member no seat names, its delegating
 * session is not recorded, or it names no program, environment or parent.
 */
export type UnattributedReason =
  | 'environment-not-seated'
  | 'program-not-code-safety'
  | 'program-member-not-seated'
  | 'parent-not-recorded'
  | 'no-seat-evidence'

/** The interval, both ends inclusive, inside which a deliverable makes its seat active. */
export interface ActiveWindow {
  since: string
  until: string
}

/** `GET /roster` payload. */
export interface Roster {
  generatedAt: string
  /**
   * Seats defined, seats a recorded deliverable occupies, and seats whose
   * newest deliverable is inside `activeWindow`, all as of `generatedAt`;
   * `work` splits the occupied and the active seats by what they did (absent
   * from a roster built before the split existed), and `running`, which only
   * the live feed adds, counts the seats a session is running on now.
   */
  counts: { defined: number; occupied: number; active: number; work?: { occupied: WorkCounts; active: WorkCounts }; running?: number }
  /** The 24 hours ending at `generatedAt`; absent from a feed built before the ledger existed. */
  activeWindow?: ActiveWindow
  divisions: Division[]
  agents: Agent[]
  edges: RosterEdge[]
  /** The runs the evidence was read from, their session count, and sessions per provider route. */
  evidence: { records: string[]; sessions: number; routes: Record<string, number> }
  /** Sessions no rule places on a seat, by reason; they are never lit on a seat. */
  unattributed: { sessions: number; reasons: Record<UnattributedReason, number> }
  /** The ledger the seats' lines were counted from: its path, the lines read, and the lines naming no seat; absent as above. */
  ledger?: { path: string; lines: number; unseated: number }
}

/** How a ticket stands: `queued` with no ledger line, else by its newest line. */
export type TicketStatus = 'queued' | 'shipped' | 'rejected' | 'halted'

/** One ticket as the enterprise report lists it. */
export interface TicketSummary {
  ticket: string
  seat: string
  division: string
  status: TicketStatus
  title?: string
  at?: string
  shift?: string
  commit?: string
  reason?: string
}

/** How a function ended: the gate or verdict itself, or a failure to obtain one. */
export type FunctionOutcome = 'pass' | 'fail' | 'error'

/** One seat performing its function on one commit, as the ledger records it. */
export interface FunctionRun {
  at: string
  shift: string
  seat: string
  division: string
  function: string
  target: { commit: string; requested?: string }
  outcome: FunctionOutcome
  evidence: { path: string } | { url: string }
  seconds: number
}

/** One CI verdict a judge recorded on a commit. */
export interface CommitVerdict {
  seat: string
  function: string
  outcome: FunctionOutcome
  url: string
  at: string
}

/** One shipped commit with the tickets it shipped and the verdicts recorded on it. */
export interface ShippedCommit {
  commit: string
  at: string
  tickets: string[]
  seats: string[]
  verdicts: CommitVerdict[]
}

/** What the enterprise delivered inside the report's window, read from the ledger lines dated inside it. */
export interface EnterpriseOutcomes {
  /** Tickets with a line in the window that shipped a commit. */
  shipped: number
  /** Tickets a model worked in the window that shipped no commit there. */
  notShipped: number
  /** Tickets whose every line in the window halted before any model ran. */
  haltedBeforeModel: number
  /** Model-driven function runs in the window, per function, such as the code-safety `review` and the `intake`. */
  programs: { function: string; runs: number; pass: number }[]
  /** Automated checks in the window, by outcome. */
  checks: { runs: number } & Record<FunctionOutcome, number>
}

/**
 * `fixtures/enterprise.json`: the ledger's reading of the enterprise's current
 * day, published by `pnpm run enterprise:publish` from the roster and the
 * ledger. It is a static artifact, the same in live and replay, so the deck
 * reads it from the committed fixtures in both modes.
 */
export interface EnterpriseReport {
  /** The moment the report describes: the newer of the roster's stamp and the last ledger line. */
  asOf: string
  window: ActiveWindow
  counts: Roster['counts']
  /** What the enterprise delivered inside the window; absent from a report built before it existed. */
  outcomes?: EnterpriseOutcomes
  /** Each division's seats; `work` splits its active seats and is absent from a report built before the split. */
  divisions: { id: string; name: string; defined: number; occupied: number; active: number; work?: WorkCounts }[]
  tickets: Record<TicketStatus, TicketSummary[]>
  /** Function runs inside the window, newest first. */
  functions: FunctionRun[]
  /** The latest shipped commits, newest first. */
  shipped: ShippedCommit[]
  ledger: { lines: number; tickets: number; functions: number; skipped: number }
}

/** One Branch CI run as the 24-hour report cites it. */
export interface DayCiRun {
  id: number
  headSha: string
  status: string
  conclusion: string | null
  url: string
  createdAt: string
}

/**
 * A shipped commit's Branch CI answer: the runs whose head is that exact
 * commit, else the first completed run created after it whose head contains
 * it, else no run, or unknown with the reason.
 */
export type DayCiAnswer =
  | { basis: 'exact'; runs: DayCiRun[] }
  | { basis: 'later'; run: DayCiRun }
  | { basis: 'none' }
  | { basis: 'unknown'; reason: string }

/** One cycle that started inside the report's window. */
export interface DayCycle {
  cycle: string
  startedAt: string
  /** `record` when its cycle record was committed, `git` when only commits naming it were. */
  source: 'record' | 'git'
  outcome: 'clean' | 'failed' | 'unknown'
  /** The commits whose subjects name the cycle, oldest first. */
  commits: { commit: string; carries: string }[]
  /** Who started the cycle, and what says so. */
  startedBy?: { by: 'scheduler' | 'operator' | 'unknown'; basis: string }
  record?: {
    endedAt: string
    firstFailure: { step: string; exit: number } | null
    failedSteps: string[]
    shifts: string[]
    tickets: Record<'shipped' | 'rejected' | 'halted', number>
    functions: Record<FunctionOutcome, number>
    /** Whether the next cycle's record found this record on the remote branch. */
    recordOnRemote: boolean | 'unknown'
  }
}

/** One distinct ticket shipped inside the window. */
export interface DayShippedTicket {
  ticket: string
  division: string
  seat: string
  commit: string
  at: string
  shift: string
}

/** One shipped commit with its Branch CI answer and the answer in one phrase. */
export interface DayShippedCommit {
  commit: string
  tickets: string[]
  divisions: string[]
  ci: DayCiAnswer
  /** A run's conclusion, `in progress`, `no run` or `unknown`. */
  verdict: string
}

/** One shift of the report's window: recorded, shown by ledger lines only, or lost as the loss register states. */
export interface DayShift {
  shift: string
  startedAt: string | null
  source: 'record' | 'ledger' | 'lost'
  outcome: string
  tickets: Record<'shipped' | 'rejected' | 'halted', number>
  evidence: string
}

/** One labelled total of spend; totals overlap and are never summed. */
export interface DayEffortTotal {
  covers: string
  source: string
  items: number
  tokens: number | null
  seconds: number | null
  breakdown?: { input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number }
}

/**
 * `fixtures/enterprise-day.json`: the report `pnpm run enterprise:report`
 * writes, over the 24 hours ending at the roster's stamp, published by
 * `pnpm run enterprise:publish` with the rest of the enterprise data. The deck
 * reads it from the committed fixtures in live and replay alike. The optional
 * fields are absent from a report an earlier publisher wrote, until the next
 * cycle publishes again.
 */
export interface EnterpriseDay {
  window: ActiveWindow
  head: { commit: string; committedAt: string | null }
  /** The pilot's state over the window in one sentence of exact counts. */
  headline?: string
  shifts?: DayShift[]
  cycles: {
    count: number
    recorded: number
    gitOnly: number
    clean: number
    failed: number
    failedByStep: Record<string, number>
    list: DayCycle[]
  }
  tickets: {
    lines: number
    byStatus: Record<'shipped' | 'rejected' | 'halted', number>
    byDivision: ({ division: string; lines: number } & Record<'shipped' | 'rejected' | 'halted', number>)[]
    /** The independent review of the window's ticket lines. */
    reviews?: { approved: number; rejected: number; notReached: number }
    shipped: DayShippedTicket[]
  }
  commits: DayShippedCommit[]
  seats: {
    at: string
    defined: number
    occupied: number
    active: number
    /** The occupied and active seats by what they did; absent from a report an earlier publisher wrote. */
    work?: { occupied: WorkCounts; active: WorkCounts }
    byDivision: { id: string; name: string; defined: number; occupied: number; active: number; work?: WorkCounts }[]
  }
  functions: { lines: number; byDivision: ({ division: string } & Record<FunctionOutcome, number>)[] }
  /** Spend, one labelled total per source; an earlier publisher wrote an object here instead. */
  effort: DayEffortTotal[] | Record<string, unknown>
  /** Every fact the report could not establish. */
  unknowns: string[]
}

/** One entry of `GET /runs`. */
export interface Run {
  id: string
  kind: RunKind
  name: string
  startedAt: string
  endedAt?: string
  status: string
  path: string
}

/** One `data:` frame of `GET /runs/:id/events`. */
export interface RunEvent {
  /** When the frame was logged, in epoch milliseconds. */
  ts: number
  /** Position inside the frame's own session, counted from one; unique only together with `sessionId`. */
  seq: number
  /** The seat the frame's session is attributed to; absent when no rule places the session on a seat. */
  agentId?: string
  sessionId: string
  kind: EventKind
  label: string
  detail?: string
  severity?: Severity
  file?: string
  line?: number
}

/**
 * The seat one frame's session occupies, when it occupies one the roster knows.
 * @param event - The frame.
 * @param agents - The roster index.
 * @returns The seat, or `undefined` for an unattributed session.
 */
export function seatOf(event: RunEvent, agents: ReadonlyMap<string, Agent>): Agent | undefined {
  return event.agentId === undefined ? undefined : agents.get(event.agentId)
}

/**
 * The key the deck tracks a frame's actor under: its seat, or its own session
 * when no seat is attributed, so an unattributed session keeps its own lane,
 * node and activity clock without borrowing a seat.
 * @param event - The frame.
 * @returns The seat id, else the session id.
 */
export function actorOf(event: RunEvent): string {
  return event.agentId ?? event.sessionId
}

/** One file of the reviewed target repository. */
export interface TargetFile {
  path: string
  bytes: number
  language: string
}

/** The repository under code-safety review. */
export interface SafetyTarget {
  name: string
  path: string
  files: TargetFile[]
  languages: Record<string, number>
}

/** A code-safety department's roll-up for one review. */
export interface SafetyDepartment {
  id: string
  name: string
  status: string
  certified: boolean
  findings: number
}

/** One code-safety finding placed on the target's code. */
export interface Finding {
  id: string
  cwe: string
  owasp: string
  severity: Severity
  confidence: Confidence
  title: string
  file: string
  line: number
  snippet: string
  evidence: string
  impact: string
  fix: string
  /** Sources the department cited, as the review wrote them. */
  references?: string[]
}

/** The verifier's certificate over a completed review. */
export interface SafetyCertificate {
  verified: boolean
  verifier: string
  checkedAt: string
  counts: Record<Severity, number>
  unverified: string[]
}

/** `GET /safety/:id` payload. */
export interface SafetyReview {
  target: SafetyTarget
  departments: SafetyDepartment[]
  findings: Finding[]
  certificate: SafetyCertificate
  report: { markdown: string }
}

/** One approach's score in a target's comparison, as `assemble-comparison.mjs` records it. */
export interface ComparisonTier {
  id: string
  name: string
  kind: string
  found: number
  recall: number
  findings: number
  onKnown: number
  verified: boolean
  wall: string
  cost: string
  detail: string
}

/** One known issue and which approaches caught it. */
export interface ComparisonRow {
  id: string
  category: string
  semgrep: boolean
  singleModel: boolean
  enterprise: boolean
}

/**
 * One target reviewed three ways and scored against one ground truth, the
 * `comparison.json` a committed record carries. It is a static artifact, the
 * same in live and replay, so the deck reads it from the committed fixtures in
 * both modes rather than from the feed.
 */
export interface Comparison {
  target: string
  revision: string
  knownIssues: number
  date: string
  note: string
  tiers: ComparisonTier[]
  matrix: ComparisonRow[]
  bothModelsMiss: string[]
  singleModelOnly: string[]
  enterpriseOnly: string[]
  iterations: ComparisonIteration[]
}

/**
 * One improvement-loop iteration run against the enterprise baseline: the change
 * it tested and the decision taken are authored in the record's `iterations.json`;
 * the recall, the issues gained and lost against the baseline, and the targets it
 * caught are scored from the iteration's own record.
 */
export interface ComparisonIteration {
  id: string
  ran: string
  record: string
  baseline: string
  mechanism: string
  change: string
  targets: string[]
  decision: string
  reading: string
  /** The pair this run belongs to, when the iteration was read as a pair of arms rather than one run. */
  pair?: string
  /** The arm the run took inside its pair, e.g. `with` or `without`. */
  arm?: string
  found: number
  recall: number
  findings: number
  onKnown: number
  verified: boolean
  wall: string
  gained: string[]
  lost: string[]
  targetsCaught: string[]
}

/** One department of a recorded program run. */
export interface ProgramDepartment {
  key: string
  sessionId: string
  /** The last status the program's ledger gave the department, such as `merged`. */
  status: string
  /** The department's session log, relative to the repository. */
  sessionPath?: string
  certified: boolean
  steps: number
  toolCalls: number
  /** The seat the session occupies; absent when no rule places it. */
  seatId?: string
}

/** The integration step of a recorded program run and its verdict. */
export interface ProgramIntegration {
  sessionId: string
  /** The last status the ledger reported, such as `certified`. */
  status: string
  sessionPath?: string
  certified: boolean
  steps: number
  toolCalls: number
  seatId?: string
  /** When the integration reported `certified`, as an ISO time. */
  certifiedAt?: string
  mergedRevision?: string
}

/** One signature the program's ledger recorded. */
export interface ProgramSignoff {
  /** The transition signed, such as `spec-freeze` or `release`. */
  transition: string
  at?: string
  /** The principal the deployment recorded as having decided; recorded, never authenticated. */
  decidedBy?: { kind: string; id: string; displayName?: string }
  artefactSha256?: string
}

/** One entry of `GET /programs`: a recorded program run, the organisation of record. */
export interface ProgramRecord {
  programId: string
  runId: string
  kind: 'code-safety' | 'program'
  /** The record directory, relative to the repository. */
  path: string
  /** The reviewed repository, for a code-safety review. */
  target?: string
  spec?: { sha256: string; objective: string }
  startedAt: string
  endedAt?: string
  /** How the program ended, such as `released`; absent while it runs. */
  outcome?: string
  departments: ProgramDepartment[]
  integration?: ProgramIntegration
  signoffs: ProgramSignoff[]
}

/** Severity order used for sorting and for the legend, worst first. */
export const SEVERITY_ORDER: readonly Severity[] = ['critical', 'high', 'medium', 'low', 'info']

// ---------------------------------------------------------------------------
// Operations snapshot: `GET /ops`, `GET /ops/events`, `fixtures/ops.json`
// ---------------------------------------------------------------------------

/** The version of {@link OpsSnapshot} a producer writes; a reader refuses any other. */
export const OPS_SCHEMA = 2

/**
 * What kind of work one agent on the operations snapshot does: a step of the
 * enterprise cycle, a department working a ticket (or a shift's integration),
 * an independent reviewer, an intake coordinator, a function gate or CI judge,
 * a Proving Ground bench cell, or one of the operator's own background agents.
 */
export type OpsAgentKind =
  | 'cycle-step'
  | 'department'
  | 'reviewer'
  | 'coordinator'
  | 'function-gate'
  | 'bench-cell'
  | 'operator-agent'

/** Every agent kind, in the order the Operations view lays out its lanes. */
export const OPS_AGENT_KINDS: readonly OpsAgentKind[] = [
  'cycle-step',
  'coordinator',
  'department',
  'reviewer',
  'function-gate',
  'bench-cell',
  'operator-agent',
]

/**
 * A link to the record a statement rests on: a GitHub page (a commit, a CI run
 * or job, a committed record on the branch) when one exists, else the record's
 * name alone. A snapshot names a file on the producing machine by its label and
 * carries no path of that machine.
 */
export interface OpsLink {
  label: string
  url?: string
}

/**
 * One agent working now: its newest event is inside the stuck threshold
 * (`working`), or it has not ended and has been silent longer (`stuck`).
 */
export interface OpsAgent {
  /** Stable across snapshots: the session, transcript or cycle step the agent is. */
  id: string
  kind: OpsAgentKind
  label: string
  /** The roster seat the agent occupies, when one is recorded for it. */
  seat?: string
  division?: string
  /** The newest tool call or step, cut to one line with credential-shaped strings removed. */
  doing: string
  startedAt: string
  lastEventAt: string
  elapsedSeconds: number
  idleSeconds: number
  /** Input, output, cache-read and cache-write tokens its model requests reported; absent when the source records none. */
  tokens?: number
  state: 'working' | 'stuck'
  /** The shift, intake, cycle or bench record the agent belongs to. */
  run?: string
  evidence?: OpsLink
}

/** What an attention item is about. */
export type OpsAttentionKind =
  | 'ci-red'
  | 'ticket-halted'
  | 'ticket-rejected'
  | 'cycle-step-failed'
  | 'cycle-interrupted'
  | 'scheduler-stale'
  | 'scheduler-down'
  | 'agent-stuck'
  | 'shift-halted'
  | 'shift-failed'
  | 'shift-abandoned'
  | 'heartbeat-down'
  | 'disk-pressure'
  | 'memory-pressure'
  | 'owner-request'
  | 'source-unknown'

/** One thing that needs attention, with the record it rests on and the next action. */
export interface OpsAttention {
  /** Stable across snapshots while the condition holds. */
  id: string
  kind: OpsAttentionKind
  severity: Severity
  title: string
  detail: string
  /** When the condition was recorded, when the source dates it. */
  at?: string
  evidence: OpsLink[]
  next: string
}

/** How one run in the 24-hour timeline ended; `unknown` when its source records no end state. */
export type OpsRunOutcome = 'running' | 'ok' | 'failed' | 'unknown'

/** One agent run inside the snapshot's window, for the timeline. */
export interface OpsRun {
  id: string
  kind: OpsAgentKind
  label: string
  seat?: string
  division?: string
  startedAt: string
  /** Absent while it runs. */
  endedAt?: string
  outcome: OpsRunOutcome
}

/** The sources a snapshot reads. */
export type OpsSourceId =
  | 'roster'
  | 'ledger'
  | 'tickets'
  | 'cycle-logs'
  | 'cycle-history'
  | 'scheduler'
  | 'shifts'
  | 'department-transcripts'
  | 'operator-agents'
  | 'bench'
  | 'ci'
  | 'host'
  | 'requests'

/** Whether one source was read; `unknown` names why it was not, and nothing derived from it is guessed. */
export interface OpsSource {
  id: OpsSourceId
  state: 'ok' | 'unknown'
  detail: string
  /**
   * The moment the source's facts describe, present when it was read: the
   * collection for a source read live (processes, logs, transcripts, the
   * host); the checkout's newest fetch of the branch for the files the branch
   * carries (the ledger, the queue, the records); the roster's own
   * `generatedAt`; the cached read of Branch CI.
   */
  asOf?: string
}

/** The background loops the enterprise runs on. */
export type OpsHeartbeatId = 'scheduler' | 'transcript-capture' | 'ops-loop'

/**
 * Whether one background loop is alive: `alive` while its process runs and
 * its newest run is inside the loop's allowance, `late` while the process
 * runs but its newest run is older, `down` when no process runs, and
 * `unknown` when the process table could not be read.
 */
export interface OpsHeartbeat {
  id: OpsHeartbeatId
  label: string
  state: 'alive' | 'late' | 'down' | 'unknown'
  /** The loop's newest run, when a record of one was read. */
  lastRunAt?: string
  /** How often the loop runs, in seconds. */
  everySeconds: number
  detail: string
  /**
   * The transcript capture's newest push to the branch, read from its log;
   * absent for the other loops, and from a snapshot an earlier collector wrote.
   */
  lastPush?: { at: string; commit: string }
}

/**
 * One step of a cycle on the cycle timeline: `ok` and `failed` ended with
 * their exit code, `running` is the step the cycle runs now, and `pending` is
 * a step a running cycle has still to reach.
 */
export interface OpsCycleStep {
  name: string
  state: 'ok' | 'failed' | 'running' | 'pending'
  exit?: number
  /** When the step ended, or began for the running step. */
  at?: string
  /** How long it ran, in seconds; absent for a pending step. */
  seconds?: number
}

/**
 * One cycle of the window, as the scheduler ran it: `running` now, `clean`
 * when every step exited 0, `failed` when one did not, `refused` when it
 * refused to start, `interrupted` when its log stops with no cycle process
 * left, and `unknown` when only the branch history names it.
 */
export interface OpsCycle {
  cycle: string
  startedAt: string
  /** The newest step's end, or the record's; absent while it runs. */
  endedAt?: string
  outcome: 'running' | 'clean' | 'failed' | 'refused' | 'interrupted' | 'unknown'
  /** The cycle's exit code as the scheduler logged it. */
  exit?: number
  /** Where the steps were read: the machine's cycle log, the committed cycle record, or the branch history alone. */
  source: 'log' | 'record' | 'history'
  steps: OpsCycleStep[]
  /** The shift the cycle ran. */
  shift?: string
  /** The ticket lines the ledger gained during the cycle, from its record. */
  tickets?: Record<'shipped' | 'rejected' | 'halted', number>
  /** The function lines the ledger gained during the cycle, from its record. */
  functions?: Record<'pass' | 'fail' | 'error', number>
  /** Why a refused cycle refused. */
  detail?: string
  evidence: OpsLink
}

/**
 * Where one ticket of a shift stands: `queued` behind the department working
 * before it, `working` in its department, `certified` by its acceptance
 * checks, in independent `review`, in `integration` over the assembled tree,
 * or ended `shipped`, `rejected` by its review, or `halted`.
 */
export type OpsShiftStage = 'queued' | 'working' | 'certified' | 'review' | 'integration' | 'shipped' | 'rejected' | 'halted'

/** One ticket of a shift and the stage its department has reached. */
export interface OpsShiftTicket {
  ticket: string
  title?: string
  seat?: string
  division?: string
  stage: OpsShiftStage
  /** For a ticket that ended without shipping, the furthest stage of the pipeline it reached. */
  reached?: 'working' | 'certified' | 'review' | 'integration'
  /** When the ticket entered its stage, when a record dates it. */
  since?: string
  /** Why it halted or was rejected, one line. */
  reason?: string
  /** The commit it shipped as. */
  commit?: string
}

/**
 * The shift running now, else the newest shift: its tickets in the order the
 * shift works them, each with its stage. Read from the shift's scratch run
 * while it runs, from its committed record once it ended.
 */
export interface OpsShift {
  shift: string
  state: 'running' | 'ended'
  startedAt: string
  endedAt?: string
  /** Where it was read: its scratch run on the machine, or its committed record. */
  source: 'scratch' | 'record'
  tickets: OpsShiftTicket[]
  evidence: OpsLink
}

/** One shipped ticket with the commit it shipped as and the Branch CI verdict that covers that commit. */
export interface OpsShippedTicket {
  ticket: string
  title?: string
  seat?: string
  division?: string
  shift: string
  at: string
  commit: string
  ci: OpsShipped['ci']
  ciCommit?: string
  url?: string
}

/** One roster seat as the Operations scene draws it. */
export interface OpsSeat {
  id: string
  name: string
  division: string
  /** A recorded deliverable occupies it (the roster's occupancy rule). */
  occupied: boolean
  /** Its newest deliverable falls inside the roster's 24-hour window. */
  activeToday: boolean
}

/** Seats per division: defined, occupied by a recorded deliverable, active in the roster's day, and held by an agent working now. */
export interface OpsSeatCounts {
  defined: number
  occupied: number
  activeToday: number
  workingNow: number
}

/** A shipped commit and the Branch CI verdict that covers it. */
export interface OpsShipped {
  commit: string
  at: string
  tickets: string[]
  /**
   * The Branch CI verdict under the rule of `pnpm run enterprise:verdicts`: the
   * newest run on the commit itself when one rendered a verdict or still runs;
   * else the oldest later run that rendered one (`success` or `failure`) and
   * whose head contains the commit (`ciCommit`), a cancelled run rendering none;
   * else `running` while a later run containing it is in progress, `no-run`
   * when no read run covers it, and `unknown` when it could not be placed.
   */
  ci: 'pass' | 'fail' | 'running' | 'cancelled' | 'no-run' | 'unknown'
  /** The commit the verdict was read from, when it is not the shipped commit itself. */
  ciCommit?: string
  url?: string
}

/** One hour of the window: what the enterprise delivered in it. */
export interface OpsHour {
  /** The hour's start, ISO. */
  hour: string
  shipped: number
  rejected: number
  halted: number
  functions: number
  runs: number
}

/**
 * The whole organisation at a glance. Every field is `null` when the source
 * it is counted from could not be read; the matching {@link OpsSource} says why.
 */
export interface OpsBigPicture {
  seats: (OpsSeatCounts & { divisions: (OpsSeatCounts & { id: string; name: string })[] }) | null
  /** Queued and halted are the queue now; shipped and rejected are inside the window. */
  tickets: { queued: number; halted: number; shipped: number; rejected: number } | null
  cycles: { last24h: number; lastStartedAt?: string; running?: string; nextAt?: string } | null
  throughput: { hours: OpsHour[]; shippedPerHour: number; deliverablesPerHour: number } | null
  shipped: OpsShipped[] | null
  /** The newest shipped tickets, each with its commit and verdict; absent from a snapshot an earlier collector wrote. */
  shippedTickets?: OpsShippedTicket[] | null
  ci: {
    branch: string
    /** The newest completed Branch CI run. */
    latest?: { commit: string; conclusion: string; url: string; at: string; failingJobs: { name: string; url: string }[] }
    /** A run in progress, when one is. */
    running?: { commit: string; url: string; startedAt: string }
  } | null
  host: { disks: { mount: string; usedPct: number }[]; memoryAvailablePct: number | null; swapUsedPct: number | null } | null
}

/**
 * `GET /ops` payload, and `fixtures/ops.json`: one live operations snapshot,
 * written by `scripts/enterprise-ops.ts`. `activity` frames are
 * {@link RunEvent}s whose `sessionId` is an {@link OpsAgent} id, the frames
 * `GET /ops/events` streams.
 */
export interface OpsSnapshot {
  schema: typeof OPS_SCHEMA
  generatedAt: string
  /** Who wrote it: the live loop, the cycle's publish step, the feed, or a command run by hand. */
  producer: 'loop' | 'cycle' | 'feed' | 'cli'
  /** How often the producer refreshes, in seconds; absent for a one-off snapshot. */
  intervalSeconds?: number
  window: ActiveWindow
  sources: OpsSource[]
  /** The scheduler, the transcript capture and the operations loop, in that order. */
  heartbeats: OpsHeartbeat[]
  agents: OpsAgent[]
  /** Worst first, then newest first. */
  attention: OpsAttention[]
  big: OpsBigPicture
  /** Every roster seat in roster order; `null` when the roster could not be read. */
  seats: OpsSeat[] | null
  runs: OpsRun[]
  activity: RunEvent[]
  /**
   * The window's cycles, newest first, with each step's exit status; `null`
   * when neither the cycle logs nor the history could be read. This field and
   * `shift` are absent from a snapshot an earlier collector wrote.
   */
  cycles?: OpsCycle[] | null
  /** The shift running now, else the newest one; `null` when no shift is known. */
  shift?: OpsShift | null
}
