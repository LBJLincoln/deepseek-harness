/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-mcp-tool-server`.
 * @module @deepseek-ai/dsh-mcp-tool-server/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-mcp-tool-server'

/** Cordis companion plugin name. */
export const name = 'mcp-tool-server-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the served run's own relation — every `tool/call` and
 * `tool/result` inside one open turn and step — is the session log's turn
 * relation, which `@deepseek-ai/dsh-session`'s companion already validates over
 * the same events, and this package holds no second stream to cross-check.
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
