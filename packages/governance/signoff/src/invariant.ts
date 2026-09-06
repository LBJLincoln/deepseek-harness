/**
 * Package-owned invariant over the one durable record this package writes.
 *
 * A `signoff/recorded` states a transition from the closed set, a principal a
 * reader can address, a lowercase SHA-256 digest of what was signed, and
 * evidence pointers that name something. The relation the log owns is artefact
 * stability: a session that signs one transition twice signs the same artefact
 * both times, because a second signature under a different digest would let a
 * reader of either record believe the other transition was signed on its own
 * artefact.
 *
 * What the log cannot show, and this companion therefore never claims: that the
 * principal is the person named, that the digest addresses a real artefact,
 * that the evidence refs resolve, or that the signer saw them.
 *
 * @module @deepseek-ai/dsh-signoff/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import { sessionEventValidator } from '@deepseek-ai/dsh-invariants'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { ARTEFACT_SHA256, latestSignoff, SIGNOFF_TRANSITIONS } from './index.ts'
import type { SignoffRecord } from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-signoff'

/** Cordis companion plugin name. */
export const name = 'signoff-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Report every field of one record a durable signature may not carry. */
function checkFields(record: SignoffRecord, fail: InvariantFailure): void {
  if (!SIGNOFF_TRANSITIONS.includes(record.transition)) {
    fail(`signoff/recorded carries unknown transition ${JSON.stringify(record.transition)}`)
  }
  if (!ARTEFACT_SHA256.test(record.artefactSha256)) {
    fail(`signoff/recorded carries artefactSha256 ${JSON.stringify(record.artefactSha256)}, which is not a lowercase 64-character SHA-256 hex digest`)
  }
  const { principal } = record
  // A log loaded from disk can carry any kind, so it is read widened here.
  const kind: string = principal.kind
  if (kind !== 'human') fail(`signoff/recorded carries principal kind ${JSON.stringify(kind)} rather than "human"`)
  if (principal.id.length === 0) fail('signoff/recorded carries an empty principal id, so it names nobody')
  if (principal.displayName !== undefined && principal.displayName.length === 0) {
    fail('signoff/recorded carries an empty principal displayName')
  }
  for (const evidence of record.evidence) {
    if (evidence.kind.length === 0) fail('signoff/recorded carries an evidence pointer with an empty kind')
    if (evidence.ref.length === 0) fail('signoff/recorded carries an evidence pointer with an empty ref')
  }
}

/**
 * Report one recorded signature that breaks a field rule or the artefact
 * stability of its own session.
 * @param prior - the session's committed events, oldest first.
 * @param event - the candidate session event.
 * @param fail - the reporter for a broken relation.
 */
export function checkSignoffEvent(prior: readonly SessionEvent[], event: SessionEvent, fail: InvariantFailure): void {
  if (event.type !== 'signoff/recorded') return
  const record = event.data
  checkFields(record, fail)
  const standing = latestSignoff(prior, record.transition)
  if (standing !== undefined && standing.artefactSha256 !== record.artefactSha256) {
    fail(`signoff/recorded signs "${record.transition}" on artefact ${record.artefactSha256}, which this session already signed on ${standing.artefactSha256}`)
  }
}

/** Check existing sessions and every candidate event before Session publishes it. */
const install: InvariantInstaller = sessionEventValidator(checkSignoffEvent, ctx => ctx.sessions.list())

/**
 * Register the signoff-record invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
