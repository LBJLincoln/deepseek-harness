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
  status: AgentStatus
  evidence: SeatEvidence
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

/** `GET /roster` payload. */
export interface Roster {
  generatedAt: string
  /** Seats defined, seats at least one recorded session occupies, and seats a running session occupies now. */
  counts: { defined: number; occupied: number; active: number }
  divisions: Division[]
  agents: Agent[]
  edges: RosterEdge[]
  /** The runs the evidence was read from, their session count, and sessions per provider route. */
  evidence: { records: string[]; sessions: number; routes: Record<string, number> }
  /** Sessions no rule places on a seat, by reason; they are never lit on a seat. */
  unattributed: { sessions: number; reasons: Record<UnattributedReason, number> }
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
