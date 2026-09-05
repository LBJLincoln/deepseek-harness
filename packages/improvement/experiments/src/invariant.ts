/**
 * Package-owned invariant: this package owns the `experiment-` stamp `group`
 * namespace, and a fold finds an experiment's sessions by parsing that group
 * back into a digest and an arm role. Every `environment/run` stamp whose
 * group starts with the prefix must therefore parse, so a session stamped with
 * a lookalike group can never be silently attributed to an arm or silently
 * dropped from one.
 *
 * @module @deepseek-ai/dsh-experiments/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import { decodeEnvironmentRun } from '@deepseek-ai/dsh-environments'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { EXPERIMENT_GROUP_PREFIX, parseExperimentGroup } from './plan.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-experiments'

/** Cordis companion plugin name. */
export const name = 'experiments-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Report a stamp that claims this package's group namespace without naming an
 * arm of a frozen plan.
 * @param event - the candidate session event.
 * @param fail - the reporter for a broken relation.
 */
export function checkStampGroup(event: SessionEvent, fail: InvariantFailure): void {
  if (event.type !== 'environment/run') return
  let group: string | undefined
  try {
    group = decodeEnvironmentRun(event.data)?.group
  } catch (_malformedStamp) {
    // The environments package owns the stamp payload at the durable boundary;
    // reporting its malformed events here would attribute them to this package.
    return
  }
  if (group === undefined || !group.startsWith(EXPERIMENT_GROUP_PREFIX)) return
  if (parseExperimentGroup(group) === undefined) {
    fail(`session event ${event.seq} stamps group "${group}" in the experiment namespace without a frozen digest and arm role`)
  }
}

/** Check existing sessions and every candidate event before Session publishes it. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  for (const session of ctx.sessions.list()) {
    for (const event of session.events) checkStampGroup(event, fail)
  }
  /* jscpd:ignore-start -- package companions share dispatch and registration plumbing */
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [, event] = args as [Session, SessionEvent]
    checkStampGroup(event, fail)
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register the experiment-group invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
