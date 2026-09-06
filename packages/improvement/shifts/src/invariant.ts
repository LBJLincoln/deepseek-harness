/**
 * Package-owned invariant: the shift ledger is the only record a restarted
 * process reads, so its three relations hold in every shift session. Every
 * `shift/cell`, `shift/resume`, and `shift/end` follows a `shift/start` of the
 * same shift in the same session — a record whose `shiftId` names another
 * shift would attribute a cell, a resume, or a whole shift's spend to a
 * session that never ran it. No two `shift/cell` records of one session carry
 * the same cell, because a second record for one cell double-counts it in the
 * shift's own counts and in every pass@k fold over its group. A `shift/start`
 * re-digests to the digest it declares, so the identity a later process
 * recomputes from the plan is the identity the shift already runs under.
 *
 * @module @deepseek-ai/dsh-shifts/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import { fleetCellKey } from '@deepseek-ai/dsh-fleet'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { shiftDigest } from './plan.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-shifts'

/** Cordis companion plugin name. */
export const name = 'shifts-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Report a ledger event that breaks one of the three relations, reading the
 * events that precede it in the same session.
 * @param prior - the session's committed events, oldest first.
 * @param event - the candidate session event.
 * @param fail - the reporter for a broken relation.
 */
export function checkLedgerEvent(prior: readonly SessionEvent[], event: SessionEvent, fail: InvariantFailure): void {
  if (event.type === 'shift/start') {
    const { plan, digest, shiftId } = event.data
    const recomputed = shiftDigest(plan)
    if (recomputed !== digest) {
      fail(`shift "${shiftId}" declares digest ${digest} but its plan freezes to ${recomputed}`)
    }
    return
  }
  if (event.type !== 'shift/cell' && event.type !== 'shift/resume' && event.type !== 'shift/end') return
  const opened = prior.some(candidate => candidate.type === 'shift/start' && candidate.data.shiftId === event.data.shiftId)
  if (!opened) {
    fail(`session event ${event.seq} records ${event.type} for shift "${event.data.shiftId}", which this session never started`)
  }
  if (event.type !== 'shift/cell') return
  const cell = fleetCellKey(event.data.cell)
  const recorded = prior.some(candidate => candidate.type === 'shift/cell' && fleetCellKey(candidate.data.cell) === cell)
  if (recorded) fail(`session event ${event.seq} records cell "${cell}" a second time in one shift`)
}

/** Check existing sessions and every candidate event before Session publishes it. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  for (const session of ctx.sessions.list()) {
    session.events.forEach((event, index) => {
      checkLedgerEvent(session.events.slice(0, index), event, fail)
    })
  }
  /* jscpd:ignore-start -- package companions share dispatch and registration plumbing */
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    checkLedgerEvent(session.events, event, fail)
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register the shift-ledger invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
