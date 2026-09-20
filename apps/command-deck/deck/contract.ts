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

/** The model route an agent is bound to. */
export interface AgentRoute {
  provider: string
  model: string
}

/** One defined agent in the enterprise. */
export interface Agent {
  id: string
  name: string
  role: string
  division: string
  department?: string
  route: AgentRoute
  preset: string
  skills: string[]
  tools: string[]
  source: string
  status: AgentStatus
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

/** `GET /roster` payload. */
export interface Roster {
  generatedAt: string
  counts: { defined: number; active: number }
  divisions: Division[]
  agents: Agent[]
  edges: RosterEdge[]
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
  agentId: string
  sessionId: string
  kind: EventKind
  label: string
  detail?: string
  severity?: Severity
  file?: string
  line?: number
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

/** Severity order used for sorting and for the legend, worst first. */
export const SEVERITY_ORDER: readonly Severity[] = ['critical', 'high', 'medium', 'low', 'info']
