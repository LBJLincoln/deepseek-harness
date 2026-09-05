/** Package-owned durable read-barrier invariants. @module @deepseek-ai/dsh-read-barrier/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { ReadBarrierCapability, ReadBarrierDenial } from './types.ts'
import { READ_BARRIER_DENIED_VERSION } from './index.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-read-barrier'

/** Cordis companion plugin name. */
export const name = 'read-barrier-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Every seam that can refuse a read. */
const CAPABILITIES: readonly ReadBarrierCapability[] = ['fs', 'shell', 'subprocess', 'terminal']

/**
 * The barrier root the first refusal in a session named. One composition owns
 * one root, so every later refusal in that session must name the same one.
 */
const sessionRoot = new WeakMap<object, string>()

/** Reject a refusal whose payload is not the record this package writes. */
function checkPayload(denial: ReadBarrierDenial, seq: number, fail: InvariantFailure): void {
  // Widened: the durable log is a boundary, so a version this build does not
  // write can still appear here even though the declared type pins one literal.
  const version: number = denial.version
  if (version !== READ_BARRIER_DENIED_VERSION) {
    fail(`session event ${seq} records a read-barrier/denied of unknown version ${JSON.stringify(version)}`)
  }
  if (!CAPABILITIES.includes(denial.capability)) {
    fail(`session event ${seq} records a read-barrier/denied from unknown capability ${JSON.stringify(denial.capability)}`)
  }
  if (denial.role !== 'implementer') {
    fail(`session event ${seq} records a read-barrier/denied for role ${JSON.stringify(denial.role)}; only an implementer is denied a read`)
  }
}

/** Reject a refusal that names a different barrier root than the session's earlier refusals. */
function checkConstantRoot(session: object, root: string, seq: number, fail: InvariantFailure): void {
  const first = sessionRoot.get(session)
  if (first === undefined) {
    sessionRoot.set(session, root)
    return
  }
  if (first !== root) {
    fail(`session event ${seq} records a read-barrier/denied under root ${JSON.stringify(root)} after ${JSON.stringify(first)}`)
  }
}

/** Validate the package-owned refusal record and ignore unrelated events. */
function validateEvent(session: object, event: SessionEvent, fail: InvariantFailure): void {
  if (event.type !== 'read-barrier/denied') return
  checkPayload(event.data, event.seq, fail)
  checkConstantRoot(session, event.data.root, event.seq, fail)
}

/* jscpd:ignore-start -- package companions share replay and dispatch plumbing */
/** Install validation for loaded and newly appended refusal records. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  for (const session of ctx.sessions.list()) {
    for (const event of session.events) validateEvent(session, event, fail)
  }
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    validateEvent(session, event, fail)
  }, { global: true })
}, { inject: ['sessions'] })
/* jscpd:ignore-end */

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
