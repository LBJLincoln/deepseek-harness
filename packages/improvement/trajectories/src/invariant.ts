/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-trajectories`.
 * @module @deepseek-ai/dsh-trajectories/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-trajectories'

/** Cordis companion plugin name. */
export const name = 'trajectories-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: export is a read over persisted logs that writes no session event and owns
 * no mutable relation; the goal and verification companions already check the streams the fold reads.
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
