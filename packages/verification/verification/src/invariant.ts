/** Package-owned durable verification-stream invariants. @module @deepseek-ai/dsh-verification/invariant */

import type { Context } from '@deepseek-ai/cordis'
import { decodeGoalChange } from '@deepseek-ai/dsh-goal'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { applyVerificationEvent, decodeCertificateChange, emptyVerificationFoldState } from './fold.ts'
import type { VerificationFoldState } from './fold.ts'
import { isolationProblem } from './isolation.ts'
import type { CertificateChangeMeta } from './domain.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-verification'

/** Cordis companion plugin name. */
export const name = 'verification-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Copy the independent fold before validating one candidate event. */
function cloneState(state: VerificationFoldState): VerificationFoldState {
  return {
    standard: state.standard,
    certificate: state.certificate,
    directivesIssued: state.directivesIssued,
    runsRecorded: state.runsRecorded,
    lastRun: state.lastRun,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    lastRef: state.lastRef,
    seenStandardIds: new Set(state.seenStandardIds),
  }
}

/** Decode a certificate for a relation check, leaving malformed payloads to the strict fold. */
function certificateOf(event: SessionEvent): CertificateChangeMeta | undefined {
  try {
    return decodeCertificateChange(event.data)
  } catch (_malformedCertificateChange) {
    // A malformed certificate is applyChecked's own subject: the strict fold rejects it.
    return undefined
  }
}

/** Reject a certificate that no fully passing run of the same standard revision preceded. */
function checkCertifiedRunExecuted(state: VerificationFoldState, event: SessionEvent, fail: InvariantFailure): void {
  if (event.type !== 'verification/certificate') return
  const change = certificateOf(event)
  if (change === undefined) return
  const covered = change.certificate.standard
  const run = state.lastRun
  if (run !== undefined && run.standard.id === covered.id && run.standard.revision === covered.revision
    && run.results.every(result => result.status === 'pass')) {
    if (run.executor !== change.certificate.executor) {
      fail(`session event ${event.seq} certifies executor ${JSON.stringify(change.certificate.executor)} while the run it cites recorded ${JSON.stringify(run.executor)}`)
    }
    return
  }
  fail(`session event ${event.seq} certifies standard "${covered.id}" revision ${covered.revision} without a preceding fully passing verification/run`)
}

/**
 * Reject a certificate whose isolation the session's own record does not
 * support. The identical rule `recordRun` applies live, so a forged
 * certificate fails replay wherever this companion is installed.
 */
function checkIsolationProven(session: Session, event: SessionEvent, fail: InvariantFailure): void {
  if (event.type !== 'verification/certificate') return
  const change = certificateOf(event)
  if (change === undefined) return
  const { isolation, executor } = change.certificate
  // Strictly the events before this certificate, so a loaded log and a live
  // append judge the same evidence: a live dispatch has not published the
  // certificate yet, while a replayed log holds everything after it too.
  const unproven = isolationProblem(session.events.filter(prior => prior.seq < event.seq), isolation, executor)
  if (unproven === undefined) return
  fail(`session event ${event.seq} certifies "${isolation}" isolation the session does not prove: ${unproven}`)
}

/** Reject a goal completion that a current standard measures without a covering certificate. */
function checkGoalCompletion(state: VerificationFoldState, event: SessionEvent, fail: InvariantFailure): void {
  if (event.type !== 'goal/change') return
  let completedGoalId: string | undefined
  try {
    const change = decodeGoalChange(event.data)
    if (change === undefined || change.operation !== 'complete') return
    completedGoalId = change.goal.id
  } catch (_malformedGoalChange) {
    // Malformed goal changes are the dsh-goal invariant companion's subject.
    return
  }
  const standard = state.standard
  if (standard === undefined || standard.goalId !== completedGoalId) return
  if (state.certificate === undefined) {
    fail(`session event ${event.seq} completes goal "${completedGoalId}" while standard "${standard.id}" revision ${standard.revision} has no covering certificate`)
  }
}

/** Apply one event through the strict verification decoder and attribute failures. */
function applyChecked(
  state: VerificationFoldState,
  session: Session,
  event: SessionEvent,
  fail: InvariantFailure,
): void {
  checkGoalCompletion(state, event, fail)
  checkCertifiedRunExecuted(state, event, fail)
  checkIsolationProven(session, event, fail)
  try {
    applyVerificationEvent(state, event)
  } catch (error) {
    /* v8 ignore next -- the strict verification decoder throws Error instances */
    const message = error instanceof Error ? error.message : String(error)
    fail(`session event ${event.seq} violates the durable verification stream: ${message}`)
  }
}

/** Install an independent incremental fold over every attached session. */
// The staged session-fold scaffold deliberately mirrors every sibling companion (goal is the template).
/* jscpd:ignore-start */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const states = new WeakMap<Session, VerificationFoldState>()
  const staged = new WeakMap<SessionEvent, { session: Session; state: VerificationFoldState }>()

  const seed = (session: Session): VerificationFoldState => {
    const state = emptyVerificationFoldState()
    for (const event of session.events) applyChecked(state, session, event, fail)
    states.set(session, state)
    return state
  }
  /* v8 ignore next -- session/event always follows list() or session/created seeding */
  const stateFor = (session: Session): VerificationFoldState => states.get(session) ?? seed(session)

  for (const session of ctx.sessions.list()) seed(session)
  ctx.on('session/created', (session) => { seed(session) }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    const state = cloneState(stateFor(session))
    applyChecked(state, session, event, fail)
    staged.set(event, { session, state })
  }, { global: true })
  ctx.on('session/event', (session, event) => {
    const candidate = staged.get(event)
    /* v8 ignore next 2 -- internal/dispatch stages the exact callback arguments */
    if (candidate === undefined || candidate.session !== session) {
      return fail('session/event reached publication without matching verification-fold validation')
    }
    staged.delete(event)
    states.set(session, candidate.state)
  }, { global: true })
}, { inject: ['sessions'] })
/* jscpd:ignore-end */

/**
 * Register the verification-stream invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
