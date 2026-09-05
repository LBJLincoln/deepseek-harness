/**
 * The certificate precondition over recorded enforcement: what one session's
 * durable record proves about the isolation a certificate may claim.
 *
 * Decided over the session log alone, so the live refusal in `recordRun` and
 * the replay refusal in the `./invariant` companion are the same rule applied
 * to the same evidence. A live barrier would add nothing: everything it knows
 * about a session is already in the `read-barrier/scope` census it appended
 * before that session's first request.
 * @module @deepseek-ai/dsh-verification/isolation
 */

import { assertNever } from '@deepseek-ai/dsh-llm'
// Type-only: resolves the read-barrier members of the session event vocabulary.
import type {} from '@deepseek-ai/dsh-read-barrier'
import type { ReadBarrierScope } from '@deepseek-ai/dsh-read-barrier/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { CertificateIsolation, RunExecutor } from './types.ts'

/**
 * The census the barrier recorded for one session, absent when no barrier is
 * composed. Read newest-first; the barrier's own companion rejects a session
 * that records a second one.
 * @param events - the session log, oldest first.
 * @returns the recorded census, or undefined when the session has none.
 */
export function recordedScope(events: readonly SessionEvent[]): ReadBarrierScope | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'read-barrier/scope') return event.data
  }
  return undefined
}

/**
 * Why the recorded census cannot back any certificate, or undefined when it
 * can. Applied at every level: composing a tool that carries an authority
 * forfeits the certificate even at `none`, and a tool assembled into a request
 * the census does not cover means the census stopped describing the session.
 * @param events - the session log, oldest first.
 * @param scope - the census recorded for that session.
 * @returns the reason, or undefined when the census holds.
 */
function censusProblem(events: readonly SessionEvent[], scope: ReadBarrierScope): string | undefined {
  for (const entry of scope.census) {
    const [authority] = entry.authority
    if (authority !== undefined) {
      return `the session composed "${entry.name}", which carries the "${authority}" authority`
    }
  }
  const covered = new Set(scope.census.map(entry => entry.name))
  for (const event of events) {
    if (event.type !== 'request/header') continue
    for (const tool of event.data.header.tools ?? []) {
      if (!covered.has(tool.name)) {
        return `request/header at event ${String(event.seq)} assembled "${tool.name}", which the scope census does not cover`
      }
    }
  }
  return undefined
}

/**
 * Why the record does not prove that no executor of this session opened a
 * denied path, or undefined when it does.
 * @param scope - the census recorded for the session, absent when none is.
 * @returns the reason, or undefined when process-level isolation is proved.
 */
function executorProblem(scope: ReadBarrierScope | undefined): string | undefined {
  if (scope === undefined) return 'no read-barrier/scope records what this session composed'
  if (scope.role !== 'implementer') {
    return `the session held role "${scope.role}", so no executor denied it a read`
  }
  for (const entry of scope.enforcement) {
    if (entry.state === 'unenforced') {
      return `capability "${entry.capability}" is composed without read-barrier enforcement`
    }
  }
  return undefined
}

/**
 * Why the record does not prove the checks are outside this account's write
 * reach, or undefined when it does.
 * @param events - the session log, oldest first.
 * @returns the reason, or undefined when a verified attestation is recorded.
 */
function attestationProblem(events: readonly SessionEvent[]): string | undefined {
  if (events.some(event => event.type === 'read-barrier/attestation')) return undefined
  return 'no verified read-barrier/attestation places the standard outside this account'
}

/**
 * Why the run's executor cannot support a claim above `none`, or undefined when
 * it can. An `agent-reported` run is the implementer's own account of its
 * checks: it is admissible evidence only at the level that asserts nothing.
 * @param executor - the executor of the run the certificate cites.
 * @returns the reason, or undefined when a validator executed the checks.
 */
function reportedProblem(executor: RunExecutor): string | undefined {
  if (executor === 'runner') return undefined
  return 'the run was agent-reported, so no validator executed its checks'
}

/**
 * Why the session's durable record does not support `isolation`, or undefined
 * when it does. A session with no census may still certify at `none`, which is
 * exactly what that level asserts: nothing.
 * @param events - the session log, oldest first.
 * @param isolation - the level the caller wants the certificate to claim.
 * @param executor - the executor of the run the certificate would cite.
 * @returns the reason to refuse, or undefined when the claim is supported.
 */
export function isolationProblem(
  events: readonly SessionEvent[],
  isolation: CertificateIsolation,
  executor: RunExecutor,
): string | undefined {
  const scope = recordedScope(events)
  const census = scope === undefined ? undefined : censusProblem(events, scope)
  if (census !== undefined) return census
  switch (isolation) {
    case 'none':
      return undefined
    case 'process':
      return reportedProblem(executor) ?? executorProblem(scope)
    case 'host':
      return reportedProblem(executor) ?? executorProblem(scope) ?? attestationProblem(events)
    default:
      return assertNever(isolation)
  }
}
