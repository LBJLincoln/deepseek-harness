/**
 * Package-owned invariant: the program ledger is what a restarted process reads
 * to decide which department to start, so its four relations hold in every
 * program session. Every `program/goal`, `program/integration`,
 * `program/resume`, and `program/end` follows a `program/start` of the same
 * program in the same session — a record naming another program would attribute
 * a department, a merge, or a release to a session that never ran it. A goal's
 * status moves only along the transitions the ledger admits, so a reconciliation
 * cannot silently rewrite a department's history. `merged` follows a certified
 * integration, because the merge commit that makes a branch merged is the
 * integration's own; and `program/end { released }` follows the same certified
 * integration, because the certificate over the merged head is what a release
 * claims.
 *
 * @module @deepseek-ai/dsh-program/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import { sessionEventValidator } from '@deepseek-ai/dsh-invariants'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProgramGoalStatus, ProgramIntegrationStatus } from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-program'

/** Cordis companion plugin name. */
export const name = 'program-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Statuses one goal may move to from each status it holds. A key with no record
 * yet enters at `pending`, so a ledger states every goal of the spec before it
 * states what became of any of them.
 */
const GOAL_TRANSITIONS: Readonly<Record<ProgramGoalStatus, readonly ProgramGoalStatus[]>> = {
  pending: ['running', 'failed', 'abandoned'],
  running: ['blocked', 'certified', 'failed'],
  blocked: ['running', 'failed', 'abandoned'],
  certified: ['merged', 'failed'],
  merged: [],
  failed: [],
  abandoned: [],
}

/**
 * Statuses one integration may move to from each status it holds. It enters at
 * `running` once its merged worktree exists, or straight at `failed` when the
 * worktree could not be created at all.
 */
const INTEGRATION_TRANSITIONS: Readonly<Record<ProgramIntegrationStatus, readonly ProgramIntegrationStatus[]>> = {
  running: ['certified', 'failed'],
  certified: [],
  failed: ['running'],
}

/** The statuses one integration may be recorded at before any record exists. */
const INTEGRATION_ENTRY: readonly ProgramIntegrationStatus[] = ['running', 'failed']

/** The latest status the prefix recorded for one goal key, absent when it records none. */
function latestGoalStatus(prior: readonly SessionEvent[], key: string): ProgramGoalStatus | undefined {
  let status: ProgramGoalStatus | undefined
  for (const event of prior) {
    if (event.type === 'program/goal' && event.data.key === key) status = event.data.status
  }
  return status
}

/** The latest integration status the prefix recorded, absent when it records none. */
function latestIntegrationStatus(prior: readonly SessionEvent[]): ProgramIntegrationStatus | undefined {
  let status: ProgramIntegrationStatus | undefined
  for (const event of prior) {
    if (event.type === 'program/integration') status = event.data.status
  }
  return status
}

/** Whether the prefix carries a certified integration of this program. */
function integrationCertified(prior: readonly SessionEvent[]): boolean {
  return prior.some(event => event.type === 'program/integration' && event.data.status === 'certified')
}

/** Report a goal record whose status does not follow the one the prefix recorded. */
function checkGoalTransition(prior: readonly SessionEvent[], event: SessionEvent<'program/goal'>, fail: InvariantFailure): void {
  const { key, status } = event.data
  const previous = latestGoalStatus(prior, key)
  if (previous === undefined) {
    if (status !== 'pending') {
      fail(`session event ${event.seq} records goal "${key}" as ${status}, which this program never declared pending`)
    }
    return
  }
  const allowed = GOAL_TRANSITIONS[previous]
  if (!allowed.includes(status)) {
    fail(`session event ${event.seq} moves goal "${key}" from ${previous} to ${status}, which the ledger does not admit`)
  }
  if (status === 'merged' && !integrationCertified(prior)) {
    fail(`session event ${event.seq} records goal "${key}" as merged before a certified integration`)
  }
}

/**
 * Report a ledger event that breaks one of the four relations, reading the
 * events that precede it in the same session.
 * @param prior - the session's committed events, oldest first.
 * @param event - the candidate session event.
 * @param fail - the reporter for a broken relation.
 */
export function checkLedgerEvent(prior: readonly SessionEvent[], event: SessionEvent, fail: InvariantFailure): void {
  if (event.type !== 'program/goal' && event.type !== 'program/integration'
    && event.type !== 'program/resume' && event.type !== 'program/end') return
  const opened = prior.some(candidate => candidate.type === 'program/start'
    && candidate.data.programId === event.data.programId)
  if (!opened) {
    fail(`session event ${event.seq} records ${event.type} for program "${event.data.programId}", which this session never started`)
    return
  }
  if (event.type === 'program/goal') {
    checkGoalTransition(prior, event, fail)
    return
  }
  if (event.type === 'program/integration') {
    const previous = latestIntegrationStatus(prior)
    const allowed = previous === undefined ? INTEGRATION_ENTRY : INTEGRATION_TRANSITIONS[previous]
    if (!allowed.includes(event.data.status)) {
      fail(`session event ${event.seq} moves the integration from ${previous ?? 'unrecorded'} to ${event.data.status}, which the ledger does not admit`)
    }
    return
  }
  if (event.type === 'program/end' && event.data.outcome === 'released' && !integrationCertified(prior)) {
    fail(`session event ${event.seq} releases program "${event.data.programId}" without a certified integration`)
  }
}

/** Check existing sessions and every candidate event before Session publishes it. */
const install: InvariantInstaller = sessionEventValidator(checkLedgerEvent, ctx => ctx.sessions.list())

/**
 * Register the program-ledger invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
