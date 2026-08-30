/**
 * Human-facing read-only `/verification` command over the completion-standard domain.
 * @module @deepseek-ai/dsh-command-verification
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { StandardView } from '@deepseek-ai/dsh-verification'

export const name = 'command-verification'
export const inject = ['commands', 'completionStandards']

const USAGE = 'Usage: /verification'

/** Render the session's whole evidence ledger without exposing compare-and-set internals. */
function renderLedger(view: StandardView): CommandResult {
  const certificate = view.certificate
  const status = certificate === undefined
    ? 'not certified'
    : `certified (isolation: ${certificate.isolation}, ${certificate.results.length} checks passed)`
  const evidenceByCheck = new Map(certificate?.results.map(result => [result.checkId, result.evidence]) ?? [])
  const checks = view.checks.map((check) => {
    const evidence = evidenceByCheck.get(check.id)
    return evidence === undefined
      ? `- ${check.id}: ${check.outcome}`
      : `- ${check.id}: ${check.outcome} — pass: ${evidence}`
  })
  const relaxed = view.relaxed.map(entry => `- ${entry.check.id}: ${entry.evidence}`)
  return {
    kind: 'success',
    text: [
      'Completion standard',
      `Goal: ${view.goalId}`,
      `Revision: ${view.revision}`,
      `Status: ${status}`,
      `Checks (${view.checks.length}):`,
      ...checks,
      ...relaxed.length === 0 ? [] : [`Relaxed (${relaxed.length}):`, ...relaxed],
      `Directives issued: ${view.directivesIssued}`,
    ].join('\n'),
  }
}

/** Execute the read-only ledger view through the domain that owns persistence. */
function executeVerificationCommand(ctx: Context, invocation: CommandInvocation): CommandResult {
  if (invocation.rawInput.trim().length !== 0) {
    return { kind: 'error', text: `The verification command takes no arguments. ${USAGE}` }
  }
  const view = ctx.completionStandards.get(invocation.agent)
  return view === undefined
    ? { kind: 'success', text: `No completion standard is set for this session.\n${USAGE}` }
    : renderLedger(view)
}

/** Register the read-only `/verification` ledger command for every composed command adapter. */
export function apply(ctx: Context): void {
  ctx.commands.register({
    name: 'verification',
    description: 'view the completion standard, certificate, and directives for this session',
    handler: invocation => executeVerificationCommand(ctx, invocation),
  })
}
