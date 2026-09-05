/** Package-owned durable read-barrier invariants. @module @deepseek-ai/dsh-read-barrier/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {
  ReadBarrierAttestation,
  ReadBarrierCapability,
  ReadBarrierDenial,
  ReadBarrierEnforcementState,
  ReadBarrierRole,
  ReadBarrierScope,
} from './types.ts'
import {
  ENFORCED_CAPABILITY_SERVICES,
  READ_BARRIER_ATTESTATION_VERSION,
  READ_BARRIER_DENIED_VERSION,
  READ_BARRIER_SCOPE_VERSION,
} from './index.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-read-barrier'

/** Cordis companion plugin name. */
export const name = 'read-barrier-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Every seam that can refuse a read. */
const CAPABILITIES: readonly ReadBarrierCapability[] = ['fs', 'shell', 'subprocess', 'terminal']

/** Every role a session can hold. */
const ROLES: readonly ReadBarrierRole[] = ['implementer', 'validator', 'unrestricted']

/** Every enforcement decision a capability can record. */
const ENFORCEMENT_STATES: readonly ReadBarrierEnforcementState[] = ['denied-at-executor', 'unenforced', 'not-composed']

/** Sessions whose census is already recorded, so a second one is caught as a contradiction. */
const sessionScope = new WeakMap<object, ReadBarrierScope>()

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

/** Reject a record that names a different barrier root than the session's earlier records. */
function checkConstantRoot(session: object, type: string, root: string, seq: number, fail: InvariantFailure): void {
  const first = sessionRoot.get(session)
  if (first === undefined) {
    sessionRoot.set(session, root)
    return
  }
  if (first !== root) {
    fail(`session event ${seq} records a ${type} under root ${JSON.stringify(root)} after ${JSON.stringify(first)}`)
  }
}

/** Reject a census that is not the record this package writes, or a second one in the same session. */
function checkScope(session: object, scope: ReadBarrierScope, seq: number, fail: InvariantFailure): void {
  // Widened: the durable log is a boundary, so a version this build does not
  // write can still appear here even though the declared type pins one literal.
  const version: number = scope.version
  if (version !== READ_BARRIER_SCOPE_VERSION) {
    fail(`session event ${seq} records a read-barrier/scope of unknown version ${JSON.stringify(version)}`)
  }
  if (!ROLES.includes(scope.role)) {
    fail(`session event ${seq} records a read-barrier/scope for unknown role ${JSON.stringify(scope.role)}`)
  }
  for (const entry of scope.enforcement) {
    if (!(entry.capability in ENFORCED_CAPABILITY_SERVICES)) {
      fail(`session event ${seq} records read-barrier/scope enforcement for unknown capability ${JSON.stringify(entry.capability)}`)
    }
    if (!ENFORCEMENT_STATES.includes(entry.state)) {
      fail(`session event ${seq} records read-barrier/scope enforcement state ${JSON.stringify(entry.state)} for ${JSON.stringify(entry.capability)}`)
    }
  }
  const first = sessionScope.get(session)
  if (first === undefined) {
    sessionScope.set(session, scope)
    return
  }
  fail(`session event ${seq} records a second read-barrier/scope; one session composes one census`)
}

/** Reject an attestation whose payload is not the record this package writes. */
function checkAttestation(attestation: ReadBarrierAttestation, seq: number, fail: InvariantFailure): void {
  // Widened for the same durable-boundary reason as the census version.
  const version: number = attestation.version
  if (version !== READ_BARRIER_ATTESTATION_VERSION) {
    fail(`session event ${seq} records a read-barrier/attestation of unknown version ${JSON.stringify(version)}`)
  }
  if (attestation.path === '') {
    fail(`session event ${seq} records a read-barrier/attestation with no file path`)
  }
}

/** Validate the package-owned records and ignore unrelated events. */
function validateEvent(session: object, event: SessionEvent, fail: InvariantFailure): void {
  if (event.type === 'read-barrier/scope') {
    checkScope(session, event.data, event.seq, fail)
    checkConstantRoot(session, event.type, event.data.root, event.seq, fail)
    return
  }
  if (event.type === 'read-barrier/attestation') {
    checkAttestation(event.data, event.seq, fail)
    return
  }
  if (event.type !== 'read-barrier/denied') return
  checkPayload(event.data, event.seq, fail)
  checkConstantRoot(session, event.type, event.data.root, event.seq, fail)
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
