/** Package-owned durable judge invariants. @module @deepseek-ai/dsh-judge/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { JudgeVerdictRecord } from './types.ts'
import { JUDGE_OPENING_MESSAGES, JUDGE_VERDICTS } from './index.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-judge'

/** Cordis companion plugin name. */
export const name = 'judge-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Messages the judge session's derived history holds before its first assistant
 * turn. A judge that answered nothing yet has produced no assistant message, so
 * the whole history is its opening.
 */
function openingMessageCount(session: Session): number {
  const messages = session.deriveMessages()
  const firstAssistant = messages.findIndex(message => message.role === 'assistant')
  return firstAssistant === -1 ? messages.length : firstAssistant
}

/**
 * Reject a verdict from a session that is not a blind judge: one continuing
 * another session's lineage through a fork parent or an inherited seed, one
 * nothing established as a judge, and one whose model read more than the three
 * messages an audit is allowed to carry.
 */
function checkVerdict(session: Session, verdict: JudgeVerdictRecord, seq: number, fail: InvariantFailure): void {
  if (!JUDGE_VERDICTS.includes(verdict.verdict)) {
    fail(`session event ${seq} records a judge/verdict of unknown verdict ${JSON.stringify(verdict.verdict)}`)
  }
  const { parentSession, seedLength } = session.header
  if (parentSession !== undefined) {
    fail(`session event ${seq} records a judge/verdict in a session forked from ${JSON.stringify(parentSession)}; a judge session carries no lineage`)
  }
  if (seedLength !== undefined && seedLength > 0) {
    fail(`session event ${seq} records a judge/verdict in a session seeded with ${seedLength} inherited event(s); a judge session carries no lineage`)
  }
  if (!session.events.some(event => event.type === 'judge/session')) {
    fail(`session event ${seq} records a judge/verdict with no judge/session; nothing established this session as a judge`)
  }
  const opening = openingMessageCount(session)
  if (opening !== JUDGE_OPENING_MESSAGES) {
    fail(`session event ${seq} records a judge/verdict from a history opening with ${opening} message(s); a judge reads exactly ${JUDGE_OPENING_MESSAGES}`)
  }
}

/** Validate the package-owned records and ignore unrelated events. */
function validateEvent(session: Session, event: SessionEvent, fail: InvariantFailure): void {
  if (event.type !== 'judge/verdict') return
  checkVerdict(session, event.data, event.seq, fail)
}

/* jscpd:ignore-start -- package companions share replay and dispatch plumbing */
/** Install validation for loaded and newly appended verdict records. */
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
