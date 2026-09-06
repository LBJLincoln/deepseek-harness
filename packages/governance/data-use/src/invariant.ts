/**
 * Package-owned invariant over the one durable record this package writes.
 *
 * The relation the log owns is monotone purposes: a session's terms may be
 * re-pinned, but never to admit a purpose the session's standing terms do not,
 * because widening after the fact turns a transcript recorded under one
 * agreement into material for another. Every record also states usable fields:
 * a client, an agreement, a residency, a redaction profile, a positive
 * retention, and a non-empty set of known purposes each named once.
 *
 * What the log cannot show, and this companion therefore never claims: that the
 * client and agreement exist, that the residency is where the transcript
 * actually lives, or that any export applied the redaction profile named.
 *
 * @module @deepseek-ai/dsh-data-use/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import { sessionEventValidator } from '@deepseek-ai/dsh-invariants'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { DATA_USE_PURPOSES, termsOf, widenedPurposes } from './index.ts'
import type { DataUsePurpose, DataUseTerms } from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-data-use'

/** Cordis companion plugin name. */
export const name = 'data-use-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Report every field of one record a durable pin may not carry. */
function checkFields(terms: DataUseTerms, fail: InvariantFailure): void {
  for (const [field, value] of [
    ['clientId', terms.clientId],
    ['agreementId', terms.agreementId],
    ['residency', terms.residency],
    ['redactionProfile', terms.redactionProfile],
  ] as const) {
    if (value.length === 0) fail(`dataUse/terms carries an empty ${field}`)
  }
  if (terms.purposes.length === 0) fail('dataUse/terms carries no purpose, so it admits nothing at all')
  const seen = new Set<DataUsePurpose>()
  for (const purpose of terms.purposes) {
    if (!DATA_USE_PURPOSES.includes(purpose)) fail(`dataUse/terms carries unknown purpose ${JSON.stringify(purpose)}`)
    if (seen.has(purpose)) fail(`dataUse/terms lists purpose ${JSON.stringify(purpose)} twice`)
    seen.add(purpose)
  }
  if (!Number.isInteger(terms.retentionDays) || terms.retentionDays < 1) {
    fail(`dataUse/terms carries retentionDays ${String(terms.retentionDays)}, which is not a positive whole number of days`)
  }
}

/**
 * Report one pinned record that breaks a field rule or widens the purposes its
 * own session already carries.
 * @param prior - the session's committed events, oldest first.
 * @param event - the candidate session event.
 * @param fail - the reporter for a broken relation.
 */
export function checkDataUseEvent(prior: readonly SessionEvent[], event: SessionEvent, fail: InvariantFailure): void {
  if (event.type !== 'dataUse/terms') return
  const terms = event.data
  checkFields(terms, fail)
  const standing = termsOf(prior)
  if (standing === undefined) return
  const widened = widenedPurposes(standing, terms)
  if (widened.length > 0) {
    fail(`dataUse/terms widens this session's purposes ${standing.purposes.join(', ')} with ${widened.join(', ')}`)
  }
}

/** Check existing sessions and every candidate event before Session publishes it. */
const install: InvariantInstaller = sessionEventValidator(checkDataUseEvent, ctx => ctx.sessions.list())

/**
 * Register the data-use invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
