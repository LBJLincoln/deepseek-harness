/**
 * How the Enterprise view states what the records show of the roster: which
 * seats a recorded deliverable occupied, which routes the sessions ran on, and
 * why the rest of the sessions occupy no seat. Every figure here is read from
 * the roster payload's evidence and ledger counts, never from a seat's
 * configured route.
 */

import type { Agent, EnterpriseOutcomes, Roster, UnattributedReason, WorkCounts, WorkKind } from '@/deck/contract'

/** What a seat no recorded deliverable occupied is called, in the hover label and the panel. */
export const NEVER_RUN = 'provisioned, no work assigned yet'

/** What each kind of work is called where a count of seats names it. */
export const WORK_TEXT: Record<WorkKind, string> = {
  model: 'model-driven',
  check: 'automated checks',
  halted: 'halted before any model ran',
}

/**
 * Some seats split by what they did, zeros left out.
 * @param work - Seats per kind.
 * @returns Such as `18 model-driven · 22 automated checks`, or empty when every count is zero.
 */
export function workPhrase(work: WorkCounts): string {
  return (Object.keys(WORK_TEXT) as WorkKind[])
    .filter(kind => work[kind] > 0)
    .map(kind => `${work[kind]} ${WORK_TEXT[kind]}`)
    .join(' · ')
}

/** What a model-driven function is called in the delivered outcomes; a function not named here shows its own id. */
const PROGRAM_TEXT: Record<string, string> = {
  review: 'code-safety review seats',
  intake: 'intake coordinators',
}

/**
 * What the enterprise delivered in the window, one phrase per outcome, in the
 * order the Enterprise view leads with them.
 * @param outcomes - The published outcomes.
 * @returns Such as `3 tickets shipped`, `7 of 7 code-safety review seats passed`, `105 of 114 automated checks passed`.
 */
export function outcomePhrases(outcomes: EnterpriseOutcomes): string[] {
  const phrases = [`${outcomes.shipped} ${outcomes.shipped === 1 ? 'ticket' : 'tickets'} shipped`]
  for (const program of outcomes.programs) phrases.push(`${program.pass} of ${program.runs} ${PROGRAM_TEXT[program.function] ?? program.function} passed`)
  if (outcomes.checks.runs > 0) phrases.push(`${outcomes.checks.pass} of ${outcomes.checks.runs} automated checks passed`)
  return phrases
}

/**
 * @param agent - One seat.
 * @returns Whether a recorded deliverable occupied it: an attributed session, or a ledger line naming its id.
 */
export function isOccupied(agent: Agent): boolean {
  return agent.evidence.sessions > 0 || ledgerLines(agent) > 0
}

/**
 * @param agent - One seat.
 * @returns The ledger lines naming it; `0` for a feed that predates the ledger.
 */
export function ledgerLines(agent: Agent): number {
  return agent.ledger?.lines ?? 0
}

/**
 * The deliverables a seat's hover label and panel name, in one phrase.
 * @param agent - One seat.
 * @returns Such as `model-driven · 3 recorded sessions · 2 ledger lines`, or {@link NEVER_RUN}.
 */
export function deliverables(agent: Agent): string {
  const parts: string[] = agent.work === undefined ? [] : [WORK_TEXT[agent.work.occupied]]
  if (agent.evidence.sessions > 0) parts.push(`${agent.evidence.sessions} recorded sessions`)
  const lines = ledgerLines(agent)
  if (lines > 0) parts.push(`${lines} ledger ${lines === 1 ? 'line' : 'lines'}`)
  return parts.length === 0 ? NEVER_RUN : parts.join(' · ')
}

/** One row of the routes legend. */
export interface RouteRow {
  /** Provider route key, such as `claude-code`. */
  provider: string
  /** Recorded sessions that ran on the route, attributed to a seat or not. */
  sessions: number
  /** Seats defined for the route. */
  seats: number
}

/**
 * The routes legend: every route a seat is defined for or a recorded session
 * ran on, with the sessions seen on it, most-used first.
 * @param roster - The roster payload.
 * @returns One row per provider route key.
 */
export function routeRows(roster: Roster): RouteRow[] {
  const seats = new Map<string, number>()
  for (const agent of roster.agents) seats.set(agent.route.provider, (seats.get(agent.route.provider) ?? 0) + 1)
  const providers = new Set([...seats.keys(), ...Object.keys(roster.evidence.routes)])
  return [...providers]
    .map(provider => ({ provider, sessions: roster.evidence.routes[provider] ?? 0, seats: seats.get(provider) ?? 0 }))
    .sort((left, right) => right.sessions - left.sessions || right.seats - left.seats || left.provider.localeCompare(right.provider))
}

/**
 * @param roster - The roster payload.
 * @returns Recorded sessions that made no model request, so ran on no route.
 */
export function routelessSessions(roster: Roster): number {
  return roster.evidence.sessions - Object.values(roster.evidence.routes).reduce((sum, count) => sum + count, 0)
}

/** One line per reason a recorded session occupies no seat, in the order the panel lists them. */
export const UNATTRIBUTED_REASON_TEXT: Record<UnattributedReason, string> = {
  'environment-not-seated': 'ran a bench environment no seat is defined for',
  'program-not-code-safety': 'belong to a program that is not a code-safety review',
  'program-member-not-seated': 'belong to a review department no seat names',
  'parent-not-recorded': 'were delegated by a session the record does not hold',
  'no-seat-evidence': 'name no program, environment or delegating session',
}
