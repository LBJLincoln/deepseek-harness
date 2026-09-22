/**
 * Which recorded sessions occupy which roster seats. `scripts/enterprise-roster.ts`
 * writes the result for the committed records into `data/enterprise/roster.json`,
 * and `scripts/harness-feed.ts` computes it again on `GET /roster` for every run
 * it discovers, so the file and the feed agree by construction over the same
 * records.
 *
 * A session occupies a seat only when its own record names that seat's work:
 *
 * - a program session in a code-safety review occupies the code-safety seat
 *   its id names (see {@link parseProgramSession}): a department's session its
 *   department's integrator seat, the program's own session and its
 *   integration session the program lead;
 * - a session whose `environment/run` names a bench environment occupies the
 *   Proving Ground bench operator seat specialized in that environment;
 * - a delegated session (its header names a `parentSession`) occupies what its
 *   delegating session occupies.
 *
 * A provider or model a session shares with a seat's configured route is not
 * evidence: the configured route is what a seat is defined for, and
 * {@link SeatEvidence.routesSeen} reports what its sessions actually ran on.
 * Every other session is counted in {@link UnattributedSessions} under the
 * reason no rule applied, and never lit on a seat.
 *
 * @module roster-evidence
 */

import { join, relative } from 'node:path'

import {
  CODE_SAFETY_RECORDS,
  foldSessionFacts,
  PROVING_GROUND_RECORDS,
  readJsonlLines,
  recordIds,
  sessionFilesIn,
  statSafeIsDirectory,
  type SessionFacts,
} from './session-records.ts'

/** The fields of a roster seat the attribution rules read; a roster agent definition satisfies it. */
export interface EvidenceSeat {
  id: string
  division: string
  role: string
  department?: string
  specialization?: string
}

/** What the recorded sessions show of one seat. */
export interface SeatEvidence {
  /** Sessions attributed to the seat; `0` for a seat no recorded session occupied. */
  sessions: number
  /** ISO time of the newest line any of those sessions logged; absent when there is none. */
  lastSeen?: string
  /** Provider route keys those sessions' first `request/header` stamped, sorted; empty when none made a model request. */
  routesSeen: string[]
}

/**
 * Why a session occupies no seat:
 *
 * - `environment-not-seated`: it ran a bench environment no Proving Ground seat is specialized in;
 * - `program-not-code-safety`: it belongs to a program run that is not a code-safety review;
 * - `program-member-not-seated`: it belongs to a code-safety review under a member key no code-safety seat names;
 * - `parent-not-recorded`: it was delegated by a session its run does not hold, or its delegation chain loops;
 * - `no-seat-evidence`: it names no program membership, no environment run and no delegating session.
 */
type UnattributedReason =
  | 'environment-not-seated'
  | 'program-not-code-safety'
  | 'program-member-not-seated'
  | 'parent-not-recorded'
  | 'no-seat-evidence'

/** The reasons in their presentation order, which is also the key order of {@link UnattributedSessions.reasons}. */
const UNATTRIBUTED_REASONS: readonly UnattributedReason[] = [
  'environment-not-seated',
  'program-not-code-safety',
  'program-member-not-seated',
  'parent-not-recorded',
  'no-seat-evidence',
]

/** Sessions no rule attributes to a seat, counted by reason; every reason is present, zero included. */
export interface UnattributedSessions {
  sessions: number
  reasons: Record<UnattributedReason, number>
}

/** The records a roster's evidence was computed over. */
export interface RosterEvidence {
  /** Run directories read, relative to the directory runs were discovered under, sorted. */
  records: string[]
  /** Session files read across those runs. */
  sessions: number
  /**
   * Sessions per provider route key their first `request/header` stamped,
   * keys sorted; a session that made no model request counts under no key.
   */
  routes: Record<string, number>
}

/** One run's sessions, as the attribution rules read them. */
export interface RunSessions {
  /** The run directory, relative to the directory runs were discovered under. */
  path: string
  /** Whether the run is a code-safety review; only then do its program sessions occupy code-safety seats. */
  codeSafety: boolean
  sessions: readonly SessionFacts[]
}

/** Where the rules place one session: on a seat, or nowhere, with the reason. */
type Attribution =
  | { kind: 'seat'; seatId: string }
  | { kind: 'unattributed'; reason: UnattributedReason }

/** One session and where the rules place it. */
export interface AttributedSession {
  facts: SessionFacts
  attribution: Attribution
}

/** One run's sessions with their attributions, in the run's session order. */
export interface AttributedRun {
  path: string
  sessions: readonly AttributedSession[]
}

/** Everything {@link summarizeEvidence} derives from a set of attributed runs. */
export interface EvidenceSummary {
  /** Evidence per seat id, for every seat at least one session occupies. */
  bySeat: ReadonlyMap<string, SeatEvidence>
  evidence: RosterEvidence
  unattributed: UnattributedSessions
}

/** A program session id's parts, as `@deepseek-ai/dsh-program` mints them. */
export interface ProgramSession {
  /** `program-<digest>`: the program's own session id, and the prefix of every member's. */
  programId: string
  /** The member the session belongs to: a goal key, or `@integration`; absent for the program's own session. */
  member?: string
}

/** A program session id: `program-<digest>`, optionally followed by `-<member>`. */
const PROGRAM_SESSION = /^(program-[0-9a-f]{16,})(?:-(.+))?$/

/**
 * Read a program session id. `program-<digest>` is the program's own session,
 * `program-<digest>-<key>` a department's, and `program-<digest>-@integration`
 * the integration's; a session file name carries `@` as `~0040` (`~xxxx`
 * encodes one code point), which is decoded here, so an id read from a header
 * and one read from a file name give the same member.
 * @param sessionId - the session id.
 * @returns the program id and member, or `undefined` when the id is not a program session's.
 */
export function parseProgramSession(sessionId: string): ProgramSession | undefined {
  const match = PROGRAM_SESSION.exec(sessionId)
  const programId = match?.[1]
  if (programId === undefined) return undefined
  const member = match?.[2]?.replaceAll(/~([0-9a-f]{4})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
  return member === undefined ? { programId } : { programId, member }
}

/**
 * @param reason - why the session occupies no seat.
 * @returns the unattributed placement.
 */
function unattributed(reason: UnattributedReason): Attribution {
  return { kind: 'unattributed', reason }
}

/**
 * The code-safety seat one program session occupies: a department's session
 * occupies its department's integrator seat (any seat of the department when
 * the roster has no integrator for it), the program's own session and its
 * integration session the program lead.
 * @param member - the session's member, from {@link parseProgramSession}.
 * @param seats - the roster seats.
 * @returns the seat, or `undefined` when the roster seats nothing for the member.
 */
function codeSafetySeat(member: string | undefined, seats: readonly EvidenceSeat[]): EvidenceSeat | undefined {
  const codeSafety = seats.filter(seat => seat.division === 'code-safety')
  if (member === undefined || member === '@integration') return codeSafety.find(seat => seat.role === 'lead')
  return codeSafety.find(seat => seat.department === member && seat.role === 'integrator')
    ?? codeSafety.find(seat => seat.department === member)
}

/**
 * The placement one session's own record states, before delegation is followed.
 * @param session - the session's facts.
 * @param codeSafety - whether its run is a code-safety review.
 * @param seats - the roster seats.
 * @returns the placement, or `undefined` when only the delegating session can place it.
 */
function ownAttribution(session: SessionFacts, codeSafety: boolean, seats: readonly EvidenceSeat[]): Attribution | undefined {
  const program = parseProgramSession(session.sessionId)
  if (program !== undefined) {
    if (!codeSafety) return unattributed('program-not-code-safety')
    const seat = codeSafetySeat(program.member, seats)
    return seat === undefined ? unattributed('program-member-not-seated') : { kind: 'seat', seatId: seat.id }
  }
  if (session.environmentId !== undefined) {
    const environment = session.environmentId.slice(session.environmentId.indexOf(':') + 1)
    const seat = seats.find(candidate => candidate.division === 'proving-ground' && candidate.specialization === environment)
    return seat === undefined ? unattributed('environment-not-seated') : { kind: 'seat', seatId: seat.id }
  }
  return session.parentSessionId === undefined ? unattributed('no-seat-evidence') : undefined
}

/**
 * Place every session of one run by the rules the module documentation states.
 * @param run - the run's sessions.
 * @param seats - the roster seats.
 * @returns one entry per session, in the run's session order.
 */
export function attributeRun(run: RunSessions, seats: readonly EvidenceSeat[]): AttributedSession[] {
  const byId = new Map(run.sessions.map(session => [session.sessionId, session]))
  const placed = new Map<SessionFacts, Attribution>()
  // `chain` holds the sessions on the current delegation path, `session` included, so a loop ends at the first repeat.
  const place = (session: SessionFacts, chain: ReadonlySet<SessionFacts>): Attribution => {
    const known = placed.get(session)
    if (known !== undefined) return known
    const parent = session.parentSessionId === undefined ? undefined : byId.get(session.parentSessionId)
    const attribution = ownAttribution(session, run.codeSafety, seats)
      ?? (parent === undefined || chain.has(parent) ? unattributed('parent-not-recorded') : place(parent, new Set([...chain, parent])))
    placed.set(session, attribution)
    return attribution
  }
  return run.sessions.map(facts => ({ facts, attribution: place(facts, new Set([facts])) }))
}

/** Mutable per-seat tally {@link summarizeEvidence} builds before it freezes each into a {@link SeatEvidence}. */
interface SeatTally {
  sessions: number
  lastSeenMs?: number
  routes: Set<string>
}

/**
 * Summarize attributed runs into per-seat evidence, the records read, sessions
 * per route, and the unattributed bucket. Every output is ordered by sorted
 * keys, so the same records always serialize to the same bytes.
 * @param runs - the attributed runs.
 * @returns the summary.
 */
export function summarizeEvidence(runs: readonly AttributedRun[]): EvidenceSummary {
  const tallies = new Map<string, SeatTally>()
  const routes = new Map<string, number>()
  const reasons = Object.fromEntries(UNATTRIBUTED_REASONS.map(reason => [reason, 0])) as Record<UnattributedReason, number>
  let sessions = 0
  let unplaced = 0
  for (const run of runs) {
    for (const { facts, attribution } of run.sessions) {
      sessions += 1
      if (facts.route !== undefined) routes.set(facts.route, (routes.get(facts.route) ?? 0) + 1)
      if (attribution.kind === 'unattributed') {
        unplaced += 1
        reasons[attribution.reason] += 1
        continue
      }
      const tally = tallies.get(attribution.seatId) ?? { sessions: 0, routes: new Set<string>() }
      tally.sessions += 1
      if (facts.lastSeenMs !== undefined && (tally.lastSeenMs === undefined || facts.lastSeenMs > tally.lastSeenMs)) {
        tally.lastSeenMs = facts.lastSeenMs
      }
      if (facts.route !== undefined) tally.routes.add(facts.route)
      tallies.set(attribution.seatId, tally)
    }
  }
  const bySeat = new Map<string, SeatEvidence>()
  for (const [seatId, tally] of tallies) {
    bySeat.set(seatId, {
      sessions: tally.sessions,
      ...tally.lastSeenMs === undefined ? {} : { lastSeen: new Date(tally.lastSeenMs).toISOString() },
      routesSeen: [...tally.routes].sort(),
    })
  }
  return {
    bySeat,
    evidence: {
      records: runs.map(run => run.path).sort(),
      sessions,
      routes: Object.fromEntries([...routes].sort(([left], [right]) => left.localeCompare(right))),
    },
    unattributed: { sessions: unplaced, reasons },
  }
}

/**
 * @param summary - the evidence summary.
 * @param seatId - one seat's id.
 * @returns the seat's evidence; zero sessions and no routes when no recorded session occupied it.
 */
export function evidenceFor(summary: EvidenceSummary, seatId: string): SeatEvidence {
  return summary.bySeat.get(seatId) ?? { sessions: 0, routesSeen: [] }
}

/**
 * @param root - repository root.
 * @returns every committed record the roster's evidence can be computed over:
 *   each directory under `data/proving-ground` and `data/code-safety` that
 *   holds a `sessions` directory, repository-relative and sorted.
 */
export function committedRecords(root: string): string[] {
  return [PROVING_GROUND_RECORDS, CODE_SAFETY_RECORDS]
    .flatMap(tree => recordIds(root, tree).map(id => `${tree}/${id}`))
    .sort()
}

/**
 * Fold the sessions of the named committed records.
 * @param root - repository root.
 * @param records - record directories, repository-relative (see {@link committedRecords}).
 * @returns one entry per record, in the given order; a record under `data/code-safety` is a code-safety review.
 * @throws when a named record is not a directory under the root, because evidence computed without it would silently undercount.
 */
export function readRecordedSessions(root: string, records: readonly string[]): RunSessions[] {
  return records.map((record) => {
    const dir = join(root, record)
    if (!statSafeIsDirectory(dir)) {
      throw new Error(`roster-evidence: record "${record}" is not a directory under ${root}`)
    }
    const sessions = sessionFilesIn(dir)
      .map(file => ({ file, lines: readJsonlLines(file) }))
      .filter(({ lines }) => lines.length > 0)
      .map(({ file, lines }) => foldSessionFacts(lines, relative(root, file)))
    return { path: record, codeSafety: record.startsWith(`${CODE_SAFETY_RECORDS}/`), sessions }
  })
}
