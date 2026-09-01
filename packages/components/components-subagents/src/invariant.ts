/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-components-subagents`.
 * @module @deepseek-ai/dsh-components-subagents/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-components-subagents'

/** Cordis companion plugin name. */
export const name = 'components-subagents-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the adapter mirrors the subagent seam's provider registry through effect-bound
 * registrations and owns no durable event stream; the mirror's correctness is covered by package tests.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
