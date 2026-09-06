/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-curator`.
 * @module @deepseek-ai/dsh-curator/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-curator'

/** Cordis companion plugin name. */
export const name = 'curator-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: a curated export is a read over persisted logs that appends no session event and
 * owns no mutable relation; its durable output is the manifest file, and the data-use companion already
 * checks the pinned terms the export gates on.
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
