/** Stub session logs the scorekeeper specs fold: an append-only builder plus the durable payloads it writes. */

import type { BudgetRoutePricing } from '@deepseek-ai/dsh-budget-policy'
import { GoalId } from '@deepseek-ai/dsh-goal'
import type { GoalPhase } from '@deepseek-ai/dsh-goal/types'
import { CallId, createAssistantMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { CheckId } from '@deepseek-ai/dsh-verification'
import type { CertificateIsolation, RunExecutor } from '@deepseek-ai/dsh-verification/types'

/** One durable payload as the log carries it, before the fold's decoders narrow it. */
export type Raw = Record<string, unknown>

/** One provider route, as an assistant message's provenance and a price record both name it. */
export interface Route {
  readonly provider: string
  readonly model: string
}

/** The route every stub session runs on unless a case names another. */
export const MOCK_ROUTE: Route = { provider: 'cli-mock', model: 'cli-mock' }

/** The single check every stub standard measures. */
const CHECK = { id: CheckId('round-trip'), outcome: 'the round trip prints', run: 'printf X' }

const HEX = 'c'.repeat(64)

/** Append-only event builder over a contiguous seq counter. */
export class Log {
  readonly events: SessionEvent[] = []
  private time = 1_000

  /**
   * Push one event.
   * @param type - session event type.
   * @param data - the durable payload.
   * @param extra - surface intent of a message event.
   * @returns the pushed event.
   */
  push(type: string, data: unknown, extra: Raw = {}): SessionEvent {
    const event = { type, seq: this.events.length, time: this.time += 1, data, ...extra } as unknown as SessionEvent
    this.events.push(event)
    return event
  }

  /**
   * Push one assistant message.
   * @param usage - provider accounting of the step, absent when the adapter reported none.
   * @param step - the step within turn one the message answers.
   * @param route - the provider route that served it.
   * @returns the pushed event.
   */
  assistant(usage?: TokenUsage, step = 1, route: Route = MOCK_ROUTE): SessionEvent {
    const message = createAssistantMessage({
      content: [{ type: 'text', text: 'ok' }],
      source: { ...route },
    })
    return this.push('assistant/message', { turn: 1, step, message, ...usage === undefined ? {} : { usage } }, {
      surfaceOp: 'append',
      sourceEventSeqs: [],
    })
  }

  /**
   * Push the durable price the budget policy records for one served step.
   * @param options - the priced step, its billed tokens, the rates applied, the digest of the table they came from, and the route served.
   * @returns the pushed event.
   */
  priced(options: {
    readonly step?: number
    readonly inputTokens: number
    readonly outputTokens: number
    readonly rates: BudgetRoutePricing
    readonly digest: string
    readonly route?: Route
  }): SessionEvent {
    const { inputTokens, outputTokens, rates } = options
    return this.push('usage/priced', {
      turn: 1,
      step: options.step ?? 1,
      ...options.route ?? MOCK_ROUTE,
      inputTokens,
      outputTokens,
      ...rates,
      // The one expression the budget policy prices with; the invariant it owns recomputes it.
      costEur: (inputTokens * rates.inputEurPerMillionTokens + outputTokens * rates.outputEurPerMillionTokens) / 1_000_000,
      pricingDigest: options.digest,
    })
  }

  /**
   * Push one tool result.
   * @param callId - the call the result answers.
   * @param isError - whether the model-facing block reported an error.
   * @param code - the recorded internal failure code, absent when the runtime recorded none.
   * @returns the pushed event.
   */
  toolResult(callId: string, isError: boolean, code?: string): SessionEvent {
    const message = createToolResultMessage({ callId: CallId(callId), content: [{ type: 'text', text: 'out' }], isError })
    return this.push('tool/result', {
      turn: 1,
      step: 1,
      message,
      ...code === undefined ? {} : { error: { name: 'ToolError', code } },
    }, { surfaceOp: 'append' })
  }

  /**
   * Push one admitted goal continuation round.
   * @param round - the one-based round number.
   * @param revision - the goal revision the round continues.
   * @returns the pushed event.
   */
  goalRound(round: number, revision: number): SessionEvent {
    return this.push('user/message', createUserMessage({
      content: [{ type: 'text', text: 'continue' }],
      source: { kind: 'goal', goalId: GoalId('goal-1'), revision, round },
    }), { surfaceOp: 'append' })
  }
}

/**
 * Append one builder payload under its own event type, past the typed event map.
 * @param session - the live session that records it.
 * @param type - session event type.
 * @param data - the durable payload.
 */
export function append(session: Session, type: string, data: Raw): void {
  ;(session.append as unknown as (eventType: string, eventData: unknown) => unknown)(type, data)
}

/**
 * The stored header the facts record's identity comes from.
 * @param id - the session identity.
 * @returns the stored header.
 */
export function header(id: string): SessionHeader {
  return { version: SESSION_FORMAT_VERSION, id: SessionId(id), createdAt: 500 }
}

/**
 * The runner's `environment/run` stamp.
 * @param overrides - fields replacing the defaults of a training-eligible smoke run.
 * @returns the durable stamp payload.
 */
export function stamp(overrides: Raw = {}): Raw {
  return {
    kind: 'environment/run',
    version: 1,
    environmentId: 'smoke:round-trip',
    environmentKind: 'smoke',
    heldOut: false,
    promptSha256: HEX,
    checksSha256: HEX,
    contentSha256: HEX,
    repetition: 0,
    model: { ...MOCK_ROUTE },
    isolation: 'none',
    ...overrides,
  }
}

/**
 * One goal mutation.
 * @param operation - the durable goal verb.
 * @param phase - the phase the mutation leaves the goal in.
 * @param revision - the revision the mutation writes.
 * @param roundsStarted - admitted rounds at the time of the mutation.
 * @returns the durable goal change payload.
 */
export function goalChange(operation: string, phase: GoalPhase, revision: number, roundsStarted = 0): Raw {
  return {
    kind: 'goal/change',
    version: 1,
    operation,
    goal: { id: GoalId('goal-1'), revision, objective: 'Prove the fold', phase, maxGoalRounds: 7 },
    roundsStarted,
    createdAt: 10,
    updatedAt: 10 + revision,
  }
}

/**
 * The authored completion standard.
 * @returns the durable standard change payload.
 */
export function standard(): Raw {
  return {
    kind: 'verification/standard',
    version: 1,
    operation: 'author',
    standard: { id: 'standard-1', revision: 1, goalId: 'goal-1', checks: [CHECK], relaxed: [] },
    createdAt: 11,
    updatedAt: 11,
  }
}

/**
 * One recorded run of the standard.
 * @param attempt - the one-based attempt number inside the standard.
 * @param status - the verdict of the single check.
 * @param isolation - the isolation the run executed under.
 * @returns the durable run payload.
 */
export function runRecord(attempt: number, status: 'pass' | 'fail', isolation: CertificateIsolation = 'none'): Raw {
  return {
    kind: 'verification/run',
    version: 1,
    standard: { id: 'standard-1', revision: 1 },
    attempt,
    isolation,
    executor: 'runner',
    results: [{ checkId: CHECK.id, status, evidence: `${status} round-trip` }],
    recordedAt: 20 + attempt,
  }
}

/**
 * The certificate of a fully passing run.
 * @param isolation - the isolation the certified run executed under.
 * @param executor - the executor of the run the certificate cites.
 * @returns the durable certificate payload.
 */
export function certificate(isolation: CertificateIsolation = 'none', executor: RunExecutor = 'runner'): Raw {
  return {
    kind: 'verification/certificate',
    version: 1,
    certificate: {
      standard: { id: 'standard-1', revision: 1 },
      goalId: 'goal-1',
      isolation,
      executor,
      results: [{ checkId: CHECK.id, status: 'pass', evidence: 'pass round-trip' }],
      recordedAt: 30,
    },
  }
}

/**
 * One directive the validator issued.
 * @returns the durable directive payload.
 */
export function directive(): Raw {
  return {
    kind: 'verification/directive',
    version: 1,
    standard: { id: 'standard-1', revision: 1 },
    rootCause: 'one check failed',
    detail: 'the round trip printed nothing',
    issuedAt: 25,
  }
}

/**
 * A whole session log for one cell.
 * @param options - the cell's stamp overrides, whether it certified, how many
 *   runs it recorded, its usage, and the rates that priced its one step.
 * @returns the contiguous events of that session.
 */
export function cellLog(options: {
  readonly stamp?: Raw
  readonly certified: boolean
  readonly runs: number
  readonly usage?: TokenUsage
  readonly pricing?: { readonly rates: BudgetRoutePricing; readonly digest: string }
}): SessionEvent[] {
  const log = new Log()
  if (options.stamp !== undefined) log.push('environment/run', options.stamp)
  log.push('turn/start', { turn: 1 })
  log.push('step/start', { turn: 1, step: 1 })
  log.push('request/header', { header: { config: { ...MOCK_ROUTE } }, reason: 'initial' })
  log.push('goal/change', goalChange('create', 'active', 1))
  log.push('verification/standard', standard())
  const usage = options.usage ?? { inputTokens: 12, outputTokens: 3 }
  log.assistant(usage)
  if (options.pricing !== undefined) {
    log.priced({ inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, ...options.pricing })
  }
  for (let attempt = 1; attempt <= options.runs; attempt += 1) {
    log.push('verification/run', runRecord(attempt, options.certified && attempt === options.runs ? 'pass' : 'fail'))
  }
  if (options.certified) {
    log.push('verification/certificate', certificate())
    log.push('goal/change', goalChange('complete', 'complete', 2))
  }
  log.push('step/end', { turn: 1, step: 1 })
  log.push('turn/end', { turn: 1, reason: { kind: 'completed' } })
  return log.events
}
