/** Test-only Loader plugin that arms one goal before the first budgeted step. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-goal'

export const name = 'seed-budgeted-goal'
export const inject = ['goals']

/** The objective the fixture expects to find blocked once the budget trips. */
export const OBJECTIVE = 'Prove the budget policy blocks a goal it stops'

/**
 * Arm the goal at the first real step edge, so the breach recorded at the next
 * step has an active goal to block.
 * @param ctx - plugin context carrying the goal service.
 */
export function apply(ctx: Context): void {
  ctx.on('agent/pre-step', ({ agent }, next) => {
    if (ctx.goals.get(agent) === undefined) {
      ctx.goals.create(agent, { objective: OBJECTIVE, maxGoalRounds: 9 })
    }
    return next()
  })
}
