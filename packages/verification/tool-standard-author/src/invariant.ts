/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tool-standard-author`.
 * @module @deepseek-ai/dsh-tool-standard-author/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-standard-author'

/** Cordis companion plugin name. */
export const name = 'tool-standard-author-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the instrument owns no durable event stream. Everything it commits is
 * committed by `@deepseek-ai/dsh-verification`, whose companion checks the standard events, the
 * case references, and the runs that measure them.
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
