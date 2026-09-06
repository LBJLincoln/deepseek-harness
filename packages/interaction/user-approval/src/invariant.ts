/**
 * Package-owned approval audit-stream invariants: the turn-enclosed ask/decide
 * pairing, the closed outcome and policy vocabularies, and the two attribution
 * relations — a decision states the same `argumentsSha256` its own question
 * recorded, so no reader of a decision alone can be told about other arguments
 * than the ones decided, and a `decidedBy` names a known kind and a non-empty
 * principal.
 * @module @deepseek-ai/dsh-user-approval/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { ApprovalRequestId } from './index.ts'
import { APPROVAL_POLICIES, APPROVAL_PRINCIPAL_KINDS } from './index.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-user-approval'
const APPROVAL_OUTCOMES = ['allowed-once', 'rejected', 'cancelled', 'unavailable'] as const

/** Cordis companion plugin name. */
export const name = 'user-approval-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

type ApprovalTransition =
  | { kind: 'asked'; id: ApprovalRequestId; argumentsSha256: string | undefined }
  | { kind: 'decided'; id: ApprovalRequestId }

interface ApprovalTrace {
  openTurn: number | null
  /** Open question ids to the argument digest their ask recorded, if any. */
  pending: Map<ApprovalRequestId, string | undefined>
}

/** Validate one approval event against committed unmatched questions. */
function validateApprovalEvent(
  trace: ApprovalTrace,
  event: SessionEvent,
  fail: InvariantFailure,
): ApprovalTransition | undefined {
  if (event.type === 'approval/asked') {
    if (trace.openTurn === null) fail('approval/asked appended outside any open turn')
    if (event.data.toolName.length === 0) fail('approval/asked toolName must be non-empty')
    if (trace.pending.has(event.data.id)) fail(`approval/asked repeated open id ${JSON.stringify(event.data.id)}`)
    return { kind: 'asked', id: event.data.id, argumentsSha256: event.data.argumentsSha256 }
  }
  if (event.type === 'approval/decided') {
    if (trace.openTurn === null) fail('approval/decided appended outside any open turn')
    if (!trace.pending.has(event.data.id)) fail(`approval/decided has no matching approval/asked for id ${JSON.stringify(event.data.id)}`)
    if (!APPROVAL_OUTCOMES.includes(event.data.outcome)) {
      fail(`approval/decided carries unknown outcome ${JSON.stringify(event.data.outcome)}`)
    }
    // The decision states what it decided on, so a reader trusting the
    // decision alone learns the same arguments the question was put about.
    const asked = trace.pending.get(event.data.id)
    if (event.data.argumentsSha256 !== asked) {
      fail(`approval/decided carries argumentsSha256 ${JSON.stringify(event.data.argumentsSha256)}, which its approval/asked recorded as ${JSON.stringify(asked)}`)
    }
    const { decidedBy } = event.data
    if (decidedBy !== undefined) {
      if (!APPROVAL_PRINCIPAL_KINDS.includes(decidedBy.kind)) {
        fail(`approval/decided carries decidedBy kind ${JSON.stringify(decidedBy.kind)}`)
      }
      if (decidedBy.id.length === 0) fail('approval/decided carries an empty decidedBy id, so it names nobody')
    }
    return { kind: 'decided', id: event.data.id }
  }
  if (event.type === 'approval/policy' && !APPROVAL_POLICIES.includes(event.data.policy)) {
    fail(`approval/policy carries unknown policy ${JSON.stringify(event.data.policy)}`)
  }
  return undefined
}

/** Apply one accepted approval-pair transition. */
function applyApprovalTransition(pending: Map<ApprovalRequestId, string | undefined>, transition: ApprovalTransition): void {
  if (transition.kind === 'asked') pending.set(transition.id, transition.argumentsSha256)
  else pending.delete(transition.id)
}

/** Install audit pairing and closed-vocabulary checks. */
// Event owners keep precommit staging local so their vocabularies never move into a central helper.
/* jscpd:ignore-start */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const traces = new WeakMap<Session, ApprovalTrace>()
  const staged = new WeakMap<SessionEvent, { session: Session; transition: ApprovalTransition }>()
  const seed = (session: Session): ApprovalTrace => {
    const trace: ApprovalTrace = { openTurn: null, pending: new Map() }
    traces.set(session, trace)
    for (const event of session.events) {
      if (event.type === 'turn/start') trace.openTurn = event.data.turn
      else if (event.type === 'turn/end') trace.openTurn = null
      const transition = validateApprovalEvent(trace, event, fail)
      if (transition !== undefined) applyApprovalTransition(trace.pending, transition)
    }
    return trace
  }
  const traceFor = (session: Session): ApprovalTrace => traces.get(session) ?? seed(session)

  for (const session of ctx.sessions.list()) seed(session)
  ctx.on('session/created', (session) => { seed(session) }, { global: true })
  ctx.on('session/event', (session, event) => {
    const trace = traceFor(session)
    if (event.type === 'turn/start') {
      trace.openTurn = event.data.turn
      return
    }
    if (event.type === 'turn/end') {
      trace.openTurn = null
      return
    }
    if (event.type !== 'approval/asked' && event.type !== 'approval/decided') return
    const candidate = staged.get(event)
    /* v8 ignore next -- internal/dispatch stages every package-owned pair event */
    if (candidate === undefined || candidate.session !== session) return fail('approval audit event published without pre-commit validation')
    staged.delete(event)
    applyApprovalTransition(trace.pending, candidate.transition)
  }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    const transition = validateApprovalEvent(traceFor(session), event, fail)
    if (transition !== undefined) staged.set(event, { session, transition })
  }, { global: true })
}, { inject: ['sessions'] })
/* jscpd:ignore-end */

/**
 * Register the approval invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
