/**
 * Package-owned invariant: a facts record states what its own log says. Three
 * relations are recomputed from the durable events on every stamp, goal, or
 * verification change — `runsRecorded` equals the number of `verification/run`
 * events, `certified` agrees with the reward the trajectory fold decided, and
 * a certificate's isolation equals the isolation its `environment/run` stamp
 * declared, so a scoreboard row keyed by the stamp can never blend a
 * certificate earned under a different isolation level.
 *
 * @module @deepseek-ai/dsh-scorekeeper/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import { sessionEventValidator } from '@deepseek-ai/dsh-invariants'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { foldVerification } from '@deepseek-ai/dsh-verification'
import { foldSessionFactsState } from './fold.ts'
import type { SessionFacts } from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-scorekeeper'

/** Cordis companion plugin name. */
export const name = 'scorekeeper-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Event types that can change one of the checked relations. */
const DECIDING_EVENT_TYPES: ReadonlySet<string> = new Set([
  'environment/run',
  'goal/change',
  'verification/standard',
  'verification/relaxation',
  'verification/run',
  'verification/certificate',
  'verification/directive',
])

/**
 * Recompute every checked relation of one facts record against its log.
 * @param facts - the facts folded from `events`.
 * @param events - the durable events the record covers, in sequence order.
 * @returns one message per broken relation; empty when the record agrees with the log.
 */
export function factsDisagreements(facts: SessionFacts, events: readonly SessionEvent[]): string[] {
  const messages: string[] = []
  const outcome = facts.outcome
  const runs = events.filter(event => event.type === 'verification/run').length
  if (outcome.runsRecorded !== runs) {
    messages.push(`records runsRecorded ${outcome.runsRecorded} while the log holds ${runs} verification/run events`)
  }
  if (outcome.certified !== (outcome.reward === 1)) {
    messages.push(`records certified ${String(outcome.certified)} while the reward fold decided ${String(outcome.reward)}`)
  }
  const certificate = foldVerification(events).certificate
  const stamp = facts.identity.environment
  if (stamp !== undefined && certificate !== undefined && certificate.isolation !== stamp.isolation) {
    messages.push(`certifies at isolation "${certificate.isolation}" while its environment/run stamp declared "${stamp.isolation}"`)
  }
  return messages
}

/** Validate one candidate event against the durable prefix that precedes it. */
function validateEvent(prior: readonly SessionEvent[], event: SessionEvent, fail: InvariantFailure): void {
  if (!DECIDING_EVENT_TYPES.has(event.type)) return
  const events = [...prior, event]
  let facts: SessionFacts
  try {
    facts = foldSessionFactsState(events).facts
  } catch (_malformedOutcomeStream) {
    // The goal and verification companions own their own malformed streams;
    // reporting the same event here would attribute it to this package too.
    return
  }
  for (const message of factsDisagreements(facts, events)) fail(`session event ${event.seq} ${message}`)
}

/** Check existing sessions and every candidate event before Session publishes it. */
const install: InvariantInstaller = sessionEventValidator(validateEvent, ctx => ctx.sessions.list())

/**
 * Register the session-facts invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
