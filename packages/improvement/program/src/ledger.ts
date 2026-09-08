/**
 * Reading a program back out of persisted session logs: the program session's
 * own `program/*` events folded into a record, the department state a
 * department's log states about itself, and the member sessions whose usage a
 * program ceiling is folded from.
 *
 * The typed `SessionEventMap` decides these payloads and the invariant
 * companions reject a malformed one at append, so the folds here read committed
 * events rather than revalidating them.
 *
 * @module @deepseek-ai/dsh-program/ledger
 */

import { foldGoal } from '@deepseek-ai/dsh-goal'
import type { GoalPhase } from '@deepseek-ai/dsh-goal/types'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type {
  ProgramEnd,
  ProgramGoalRecord,
  ProgramGoalStatus,
  ProgramGoalStatusCounts,
  ProgramId,
  ProgramIntegrationRecord,
  ProgramStart,
} from './types.ts'

/** One persisted session as the reconciliation scan reads it. */
export interface ScannedSession {
  /** Stored header. */
  readonly meta: SessionHeader
  /** The stored log, oldest first. */
  readonly events: readonly SessionEvent[]
}

/** One program session's ledger, folded from its log. */
export interface ProgramLedger {
  readonly sessionId: SessionId
  readonly start: ProgramStart
  /** The latest `program/goal` per key, in first-record order of the keys. */
  readonly goals: ReadonlyMap<string, ProgramGoalRecord>
  /** The latest `program/integration`, absent while none was recorded. */
  readonly integration?: ProgramIntegrationRecord
  /** The closing record, absent while the program is unfinished. */
  readonly end?: ProgramEnd
}

/** What one department's own log states about the department. */
export interface DepartmentLog {
  /** Whether the department's log carries a certificate. */
  readonly certified: boolean
  /** The department goal's durable phase, absent when the log carries no goal. */
  readonly phase?: GoalPhase
  /** The blocking code of a blocked goal, absent otherwise. */
  readonly blockedCode?: string
  /**
   * The highest attempt a `program/delegation` in this log records, and `0`
   * when it records none. A resumed delegated department continues after it, so
   * an attempt that already ended is never run again. One department session
   * carries one goal's delegations, so the fold reads every record.
   */
  readonly delegated: number
  /**
   * Validation runs this log records, and `0` when it records none. An attempt
   * whose worktree carried uncommitted work records none, so the count is the
   * attempts that reached the checks; a resumed session continues after them
   * rather than spending its round cap from the first attempt again.
   */
  readonly runs: number
}

/** One session stamped as a member of some program, with the tokens its log accounts for. */
export interface ProgramMemberSpend {
  readonly programId: ProgramId
  /** The goal key the session works, or the integration key. */
  readonly key: string
  readonly sessionId: SessionId
  /** Input plus output tokens the session's log accounts for. */
  readonly totalTokens: number
}

/**
 * Fold one persisted session into its program ledger.
 * @param session - the stored header and log.
 * @returns the ledger, or `undefined` when the log carries no `program/start`
 *   and is therefore not a program session.
 */
export function foldProgramLedger(session: ScannedSession): ProgramLedger | undefined {
  let start: ProgramStart | undefined
  let integration: ProgramIntegrationRecord | undefined
  let end: ProgramEnd | undefined
  const goals = new Map<string, ProgramGoalRecord>()
  for (const event of session.events) {
    if (event.type === 'program/start') start = event.data
    else if (event.type === 'program/goal') goals.set(event.data.key, event.data)
    else if (event.type === 'program/integration') integration = event.data
    else if (event.type === 'program/end') end = event.data
  }
  if (start === undefined) return undefined
  return {
    sessionId: session.meta.id,
    start,
    goals,
    ...integration === undefined ? {} : { integration },
    ...end === undefined ? {} : { end },
  }
}

/**
 * Fold one department session's log into what it states about its own work.
 * @param events - the department session's stored log, oldest first.
 * @returns the certificate presence, the goal phase, the blocking code, and
 *   the last delegated attempt and the validation runs the log records.
 */
export function foldDepartmentLog(events: readonly SessionEvent[]): DepartmentLog {
  const certified = events.some(event => event.type === 'verification/certificate')
  const goal = foldGoal(events).goal
  let delegated = 0
  let runs = 0
  for (const event of events) {
    if (event.type === 'program/delegation') delegated = Math.max(delegated, event.data.attempt)
    if (event.type === 'verification/run') runs += 1
  }
  return {
    certified,
    delegated,
    runs,
    ...goal === undefined ? {} : { phase: goal.phase },
    ...goal?.blockedReason === undefined ? {} : { blockedCode: goal.blockedReason.code },
  }
}

/**
 * The program membership one persisted session carries, with the tokens its log
 * accounts for. A session without a `program/member` stamp belongs to no
 * program and is invisible to the ceiling fold.
 * @param session - the stored header and log.
 * @param totalTokens - the session's folded input plus output tokens.
 * @returns the membership, or `undefined` when the session carries no stamp.
 */
export function memberSpend(session: ScannedSession, totalTokens: number): ProgramMemberSpend | undefined {
  for (const event of session.events) {
    if (event.type !== 'program/member') continue
    return {
      programId: event.data.programId,
      key: event.data.key,
      sessionId: session.meta.id,
      totalTokens,
    }
  }
  return undefined
}

/**
 * Tokens every session of one program already spent.
 * @param members - every membership the reconciliation scan found.
 * @param programId - the program whose sessions to sum.
 * @returns the summed input plus output tokens; `0` for a program with no session yet.
 */
export function programSpend(members: readonly ProgramMemberSpend[], programId: ProgramId): number {
  return members
    .filter(member => member.programId === programId)
    .reduce((sum, member) => sum + member.totalTokens, 0)
}

/**
 * Count reconciled goals per status.
 * @param statuses - the reconciled status of every goal of the spec.
 * @returns one count per status, zero where no goal holds it.
 */
export function countStatuses(statuses: Iterable<ProgramGoalStatus>): ProgramGoalStatusCounts {
  const counts: Record<ProgramGoalStatus, number> = {
    pending: 0,
    running: 0,
    blocked: 0,
    certified: 0,
    failed: 0,
    merged: 0,
    abandoned: 0,
  }
  for (const status of statuses) counts[status] += 1
  return counts
}
