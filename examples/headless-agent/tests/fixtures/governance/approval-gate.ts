/**
 * Test-only Loader plugin that puts every `bash` call to the approval seam, so
 * the fixture's turn produces one real `approval/asked` + `approval/decided`
 * pair over real tool arguments. Which answerer settles it is the composition's
 * business; this row only asks.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'

export const name = 'approval-gate'
export const inject = ['tools']

/** The reason the audit pair records for every gated command. */
export const GATE_REASON = 'this district decides every command through the approval seam'

/**
 * Ask before every `bash` call and delegate every other tool.
 * @param ctx - plugin context carrying the tool runtime.
 */
export function apply(ctx: Context): void {
  ctx.on('tools/pre-execute', (exec, next) => {
    if (exec.name !== 'bash') return next()
    return Promise.resolve<PreToolDecision>({ kind: 'ask', reason: GATE_REASON })
  })
}
