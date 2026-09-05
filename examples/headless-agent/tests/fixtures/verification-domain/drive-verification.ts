/** Test-only Loader plugin that drives the certificate-gated completion lifecycle at the first real step edge. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-goal'
import { CheckId, VerificationError } from '@deepseek-ai/dsh-verification'

export const name = 'drive-verification'
export const inject = ['goals', 'completionStandards']

/** Reject a lifecycle deviation fail-loud so the smoke's zero-exit contract catches it. */
function requireStep(condition: boolean, step: string): void {
  if (!condition) throw new Error(`verification-domain fixture: ${step}`)
}

export function apply(ctx: Context): void {
  ctx.on('agent/pre-step', ({ agent }, next) => {
    if (ctx.goals.get(agent) !== undefined) return next()

    const goal = ctx.goals.create(agent, {
      objective: 'Prove certificate-gated completion in the assembled application',
      maxGoalRounds: 7,
    })
    const standard = ctx.completionStandards.author(agent, {
      goalId: goal.id,
      checks: [
        { id: CheckId('round-trip-prints'), outcome: 'the bash round trip prints CLI_TOOL_ROUND_TRIP', run: 'printf CLI_TOOL_ROUND_TRIP' },
        { id: CheckId('final-answer-quotes'), outcome: 'the final answer quotes the tool output', run: 'inspect the assistant text' },
      ],
    })

    let refusal: VerificationError | undefined
    try {
      ctx.goals.complete(agent, { id: goal.id, revision: goal.revision })
    } catch (error) {
      if (!(error instanceof VerificationError)) throw error
      refusal = error
    }
    requireStep(refusal?.code === 'VERIFICATION_NOT_CERTIFIED', 'expected the uncertified completion to be refused')
    ctx.completionStandards.issueDirective(agent, { id: standard.id, revision: standard.revision }, {
      rootCause: 'uncertified completion refused',
      detail: (refusal as VerificationError).message,
    })

    const failing = ctx.completionStandards.recordRun(agent, { id: standard.id, revision: standard.revision }, 'process', [
      { checkId: CheckId('round-trip-prints'), status: 'pass', evidence: 'printf CLI_TOOL_ROUND_TRIP exited 0' },
      { checkId: CheckId('final-answer-quotes'), status: 'fail', evidence: 'no assistant text exists yet' },
    ], { executor: 'agent-reported' })
    requireStep(!failing.certified, 'expected the first run to fail')

    const passing = ctx.completionStandards.recordRun(agent, { id: standard.id, revision: standard.revision }, 'process', [
      { checkId: CheckId('round-trip-prints'), status: 'pass', evidence: 'printf CLI_TOOL_ROUND_TRIP exited 0' },
      { checkId: CheckId('final-answer-quotes'), status: 'pass', evidence: 'assistant text repeats CLI_TOOL_ROUND_TRIP' },
    ], { executor: 'agent-reported' })
    requireStep(passing.certified, 'expected the second run to certify')

    const completed = ctx.goals.complete(agent, { id: goal.id, revision: goal.revision })
    requireStep(completed.phase === 'complete', 'expected the certified completion to be admitted')
    return next()
  })
}
