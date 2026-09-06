/**
 * Package-owned invariant over the durable record this package writes.
 *
 * Two manifests in a row that state the same `compositionSha256` would mean the
 * writer appended a record no composition change produced, which is exactly the
 * deduplication a consumer folding the log relies on. Every entry must also
 * carry a comparable address: an id with no separator and no newline, and the
 * full 64-character lowercase digest, because a truncated or malformed one
 * silently fails every generation comparison keyed on it.
 *
 * @module @deepseek-ai/dsh-components-manifest/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import { componentAddress } from '@deepseek-ai/dsh-components'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { isComponentAddress, lastCompositionManifest } from './fold.ts'
import type { CompositionManifest } from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-components-manifest'

/** Cordis companion plugin name. */
export const name = 'components-manifest-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Validate one recorded manifest against the durable prefix that precedes it. */
function validateManifest(
  prior: readonly SessionEvent[],
  manifest: CompositionManifest,
  fail: InvariantFailure,
): void {
  const previous = lastCompositionManifest(prior)
  if (previous?.compositionSha256 === manifest.compositionSha256) {
    fail(`composition/manifest repeats compositionSha256 ${manifest.compositionSha256}, which the preceding manifest already recorded`)
  }
  for (const entry of manifest.components) {
    const address = componentAddress(entry.id, entry.digest)
    if (isComponentAddress(address)) continue
    fail(`composition/manifest lists component address ${JSON.stringify(address)}, which no generation comparison can key on`)
  }
}

/** Validate one candidate event against the durable prefix that precedes it. */
function validateEvent(
  prior: readonly SessionEvent[],
  event: SessionEvent,
  fail: InvariantFailure,
): void {
  if (event.type === 'composition/manifest') validateManifest(prior, event.data, fail)
}

/** Check existing sessions and every candidate event before Session publishes it. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  for (const session of ctx.sessions.list()) {
    const prior: SessionEvent[] = []
    for (const event of session.events) {
      validateEvent(prior, event, fail)
      prior.push(event)
    }
  }
  /* jscpd:ignore-start -- package companions share dispatch and registration plumbing */
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    validateEvent(session.events, event, fail)
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register the composition-manifest invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
