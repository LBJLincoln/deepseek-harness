/**
 * The intake's usage-limit wall: once any turn of this process ends in the
 * seam's `QUOTA` failure, no later step of any session is sent to a route.
 *
 * A `QUOTA` failure states that the route serves nothing until its own state
 * changes (`QUOTA_EXCEEDED_CODE` in `@deepseek-ai/dsh-llm`), so the first one
 * walls the process: every later step is rejected before it is assembled, and
 * the session's active goal is blocked under `route-limit`, which the program
 * records as the department's blocking code. The department the refusal cut
 * spends one more validation of what it committed; every department after it
 * is blocked on its first step without a request reaching the route.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-goal'
import { QUOTA_EXCEEDED_CODE } from '@deepseek-ai/dsh-llm'
import type { LlmFailure } from '@deepseek-ai/dsh-llm'

/** The blocking code a walled department's goal carries into the program ledger. */
export const ROUTE_LIMIT_BLOCK = 'route-limit'

export const name = 'intake-route-wall'

/**
 * Watch every session's turn ends and reject every step after the first
 * `QUOTA` one.
 * @param ctx - the plugin context the two listeners are registered on.
 */
export function apply(ctx: Context): void {
  let wall: LlmFailure | undefined
  ctx.on('session/event', (_session, event) => {
    if (wall !== undefined || event.type !== 'turn/end') return
    const { reason } = event.data
    if (reason.kind === 'error' && reason.error.code === QUOTA_EXCEEDED_CODE) wall = reason.error
  }, { global: true })
  // Prepended like the budget policy's own check, so a walled step is rejected
  // before any listener assembles context for a request that cannot be sent.
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    if (wall === undefined) return await next()
    const goals = ctx.get('goals')
    const goal = goals?.get(agent)
    if (goals !== undefined && goal?.phase === 'active') {
      goals.block(agent, { id: goal.id, revision: goal.revision }, {
        code: ROUTE_LIMIT_BLOCK,
        message: `The model route stopped at its usage limit: ${wall.message}`,
      })
    }
    return { kind: 'reject' }
  }, { prepend: true })
}
