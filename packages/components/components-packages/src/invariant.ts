/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-components-packages`.
 * @module @deepseek-ai/dsh-components-packages/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-components-packages'

/** Cordis companion plugin name. */
export const name = 'components-packages-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the adapter mirrors the Loader's own entry tree and the dynamic runner's
 * own inventory through effect-bound registrations and owns no durable event stream; the manifest
 * writer owns the relation between a recorded component and the log, and the mirror's correctness
 * is covered by package tests.
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
