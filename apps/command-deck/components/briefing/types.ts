/**
 * The fields of `public/fixtures/briefing.json` the `/briefing` page reads.
 *
 * `scripts/enterprise-briefing.ts` at the repository root writes the file and
 * owns its field set; this module restates only what the page consumes, and
 * {@link BRIEFING_SCHEMA} is the version both sides agree on. Every figure is
 * either known, with the paths or URLs it was read from and its computation,
 * or unknown with the reason.
 */

/** The `schema` of `briefing.json` this page reads. */
export const BRIEFING_SCHEMA = 1

/** Where a figure comes from. */
export interface Source {
  /** Repository paths, relative to the root. */
  paths: string[]
  /** Pages read over the network. */
  urls?: string[]
  computation: string
}

/** A computed figure, or an unknown one with the reason. */
export type Figure<T> = { value: T; source: Source } | { value: null; unknown: string; source: Source }

export interface DivisionRow {
  id: string
  name: string
  purpose: string
  defined: number
  occupied: number
  active: number
}

interface CiJob {
  name: string
  conclusion: string | null
  url: string
  failedGates: string[]
}

export interface CiRun {
  id: number
  head: string
  status: string
  conclusion: string | null
  createdAt: string
  updatedAt: string
  url: string
}

interface CiRunDetail extends CiRun {
  jobs: CiJob[]
}

export interface ShipmentCi {
  /** A run on exactly the shipped commit, when one tested it on its own. */
  exact: CiRun | null
  /** The earliest run whose commit contains the shipped commit: the containing run of the push that carried it. */
  carrying: CiRunDetail | null
  base: CiRunDetail | null
  firstGreen: CiRun | null
  introduced: string[]
  preExisting: string[]
}

/** One later commit that reworked a shipped change. */
export interface FollowUpCommit {
  commit: string
  at: string
  subject: string
}

/** One review that decided a ticket, from its ledger line or, for a shift that never wrote its lines, its shift record. */
export interface ReviewRecordRow {
  ticket: string
  shift: string
  at: string | null
  verdict: 'approve' | 'reject'
  sessionId: string | null
  /** The route and model the ledger line names; `null` for a line written before the engine recorded them. */
  reviewer: { route: string; model: string } | null
  /** The route and model the review session's request was sent with, from its log; `null` without a log. */
  requested: { route: string; model: string } | null
  toolCalls: number | null
  recordedIn: 'ledger' | 'shift record'
  shipped: string | null
  /** For a rejection: the commit a later line of the ticket shipped. */
  overturnedBy: string | null
  followUps: FollowUpCommit[]
}

export interface ShippedRow {
  ticket: string
  title: string | null
  seat: string
  seatName: string | null
  division: string
  shift: string
  at: string
  commit: string
  base: string | null
  model: string | null
  checks: { passed: number; total: number; ids: string[] }
  review: string | null
  reviewToolCalls: number | null
  tokens: number | null
  seconds: number | null
  ci: Figure<ShipmentCi>
}

interface ShiftRow {
  shift: string
  dir: string
  type: string
  startedAt: string | null
  endedAt: string | null
  tickets: string[]
  shipped: string[]
  reason: string | null
  redacted: number | null
  seconds: number | null
}

/** Who started a unit of the pilot's work. */
export type Starter = 'scheduler' | 'operator' | 'unknown'

/** One unit of the pilot's work: a run of the cycle script, or a shift started outside every cycle. */
export interface PilotRow {
  id: string
  kind: 'cycle' | 'shift'
  startedAt: string
  startedBy: Starter
  /** The evidence `startedBy` rests on. */
  basis: string
  shifts: string[]
  /** `null` when a shift of the unit left no record on the branch, or nothing states its steps. */
  attempted: number | null
  shipped: string[]
  failed: { ticket: string; status: 'halted' | 'rejected'; failedChecks: string[]; reason: string | null }[]
  lost: number | null
  tokens: number | null
  steps: { name: string; exit: number; at: string }[]
  /** For a cycle, whether anything on the branch records its end; `null` for a shift. */
  finished: boolean | null
  paths: string[]
}

export interface ExperimentRow {
  record: string
  plan: string
  date: string
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
  reread: { fold: string; delta: number; interval: { lower: number; upper: number }; verdict: string; statistic: string } | null
}

interface PooledRow {
  fold: string
  plan: string
  records: string[]
  pairs: number
  delta: number
  interval: { lower: number; upper: number }
  verdict: string
  statistic: string
}

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
  iteration: { id: string; pair: string | null; arm: string | null; decision: string | null } | null
}

export interface TierRow {
  id: string
  name: string
  found: number
  knownIssues: number
  findings: number
  /** How many of the findings land on a documented issue; absent from a briefing.json written before the field existed. */
  onKnown?: number
  verifiedAtLine: boolean
  /** The time as the comparison states it, for a tier without a measured duration. */
  wall: string | null
  wallSeconds: number | null
  /** The cost as the comparison states it, for a tier without a measured price. */
  cost: string | null
  costUsd: number | null
  record: string | null
}

interface InputDigest {
  path: string
  files: number
  bytes: number
  sha256: string
}

interface SeededReading {
  record: string
  planted: number
  caught: number
  interval: { low: number; high: number }
  byClass: { cwe: string; category: string; n: number; caught: number }[]
}

/** `briefing.json`. */
export interface Briefing {
  schema: number
  asOf: string
  repository: { name: string; branch: string; url: string }
  figures: Record<string, Figure<number | string>>
  divisions: Figure<DivisionRow[]>
  routes: Figure<{ route: string; sessions: number }[]>
  shipped: Figure<ShippedRow[]>
  shifts: Figure<ShiftRow[]>
  pilot: Figure<PilotRow[]>
  ci: Figure<{ runs: CiRun[]; counts: Record<string, number> }>
  bench: { experiments: Figure<ExperimentRow[]>; pooled: Figure<PooledRow[]> }
  safety: {
    recall: Figure<RecallRow[]>
    tiers: Figure<TierRow[]>
    seeded: Figure<SeededReading>
  }
  governance: {
    terms: Figure<{ family: string; sessions: number; withTerms: number }[]>
    signoffs: Figure<{
      run: string
      record: 'shift' | 'intake'
      transition: string
      principal: string
      kind: string
      at: string | null
      form: 'event' | 'decision'
    }[]>
    reviews: Figure<{ shift: string; reviews: number; toolCalls: number }[]>
    /** Every review that decided a ticket; absent from a briefing built before it existed. */
    reviewRecord?: Figure<ReviewRecordRow[]>
  }
  economics: { tickets: Figure<{ ticket: string; tokens: number; seconds: number }[]> }
  inputs: InputDigest[]
}
