/**
 * How the Enterprise view states what the recorded sessions show of the roster:
 * which seats they occupied, which routes they ran on, and why the rest of the
 * sessions occupy no seat. Every figure here is read from the roster payload's
 * evidence, never from a seat's configured route.
 */

import type { Agent, Roster, UnattributedReason } from '@/deck/contract'

/** What a seat no recorded session occupied is called, in the hover label and the panel. */
export const NEVER_RUN = 'defined, never run'

/**
 * @param agent - One seat.
 * @returns Whether at least one recorded session occupied it.
 */
export function isOccupied(agent: Agent): boolean {
  return agent.evidence.sessions > 0
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
