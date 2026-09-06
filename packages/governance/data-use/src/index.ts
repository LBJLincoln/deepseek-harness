/**
 * Data-use terms: the contract a session's transcript is held under, pinned to
 * the session log at creation so every later reader — an export, a curator, a
 * client auditor — learns from the log alone what the transcript may serve.
 * A pin may narrow the terms and never widen their purposes, so a session
 * created for delivery cannot become training data after the fact. Nothing here
 * reaches a model request. The
 * [attributable-decisions Agent Note](../../../.agents/notes/proposed/architecture/2026-09-06-attributable-decisions.md)
 * owns the design rationale.
 * @module @deepseek-ai/dsh-data-use
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
// Type-only: resolves the `agent/session-start` event this service pins on.
import type {} from '@deepseek-ai/dsh-agent'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { DataUsePurpose, DataUseTerms } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    dataUse: DataUseService
  }
}

/** Every {@link DataUsePurpose}, for validation and for option advertisement. */
export const DATA_USE_PURPOSES: readonly DataUsePurpose[] = ['delivery', 'training', 'evaluation']

/** Stable error codes of terms this service refuses. */
export type DataUseErrorCode = 'DATA_USE_INVALID_CONFIG' | 'DATA_USE_INVALID_TERMS' | 'DATA_USE_TERMS_PINNED'

/** Error returned when configured or pinned terms cannot hold a session. */
export class DataUseError extends HarnessError {
  /**
   * @param message - human-readable reason, naming the field at fault.
   * @param code - stable machine-routable classification.
   */
  // Keep the constructor to narrow HarnessError's string code at this boundary.
  // oxlint-disable-next-line typescript/no-useless-constructor -- type-only narrowing
  constructor(message: string, code: DataUseErrorCode) {
    super(message, code)
  }
}

/** The deployment's default terms, validated from `cordis.yml`. */
export interface Config {
  /** The client every session of this deployment belongs to. */
  clientId: string
  /** The agreement the terms come from. */
  agreementId: string
  /** Non-empty subset of {@link DATA_USE_PURPOSES}, each named once. */
  purposes: DataUsePurpose[]
  /** Region the transcripts may live in. */
  residency: string
  /** Positive number of days a transcript is kept. */
  retentionDays: number
  /** Versioned redaction profile an export applies. */
  redactionProfile: string
}

/**
 * The terms currently pinned to a log, or `undefined` when it carries none.
 * The pure fold — a consumer holding persisted events needs no service, and a
 * resumed session needs no catch-up because replaying the log IS the state.
 * @param events - session events in log order; other event types are skipped.
 * @returns the newest pinned terms, or `undefined` without any.
 */
export function termsOf(events: readonly SessionEvent[]): DataUseTerms | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index] as SessionEvent
    if (event.type === 'dataUse/terms') return event.data
  }
  return undefined
}

/**
 * Whether `candidate` admits a purpose `standing` does not, which is the one
 * change a pin may never make.
 * @param standing - the terms the log already carries.
 * @param candidate - the terms a pin proposes.
 * @returns the purposes the candidate adds, empty when it only narrows.
 */
export function widenedPurposes(
  standing: DataUseTerms,
  candidate: DataUseTerms,
): readonly DataUsePurpose[] {
  return candidate.purposes.filter(purpose => !standing.purposes.includes(purpose))
}

/** Data use (`ctx.dataUse`): the contract terms every session log states about itself. */
export class DataUseService extends Service {
  static Config: z<Config> = z.object({
    clientId: z.string().required(),
    agreementId: z.string().required(),
    purposes: z.array(z.union(['delivery', 'training', 'evaluation'] as const)).required(),
    residency: z.string().required(),
    retentionDays: z.natural().min(1).required(),
    redactionProfile: z.string().required(),
  })

  private readonly defaults: DataUseTerms

  constructor(ctx: Context, config: Config) {
    super(ctx, 'dataUse')
    this.defaults = validateTerms(
      {
        clientId: config.clientId,
        agreementId: config.agreementId,
        purposes: config.purposes,
        residency: config.residency,
        retentionDays: config.retentionDays,
        redactionProfile: config.redactionProfile,
      },
      'DATA_USE_INVALID_CONFIG',
    )
    ctx.on('agent/session-start', ({ agent }) => {
      // A resumed session keeps the terms it was created under; only a session
      // that carries none is pinned, so the record states creation-time terms.
      if (termsOf(agent.session.events) === undefined) {
        agent.session.append('dataUse/terms', this.defaults)
      }
    })
  }

  /** The deployment's configured default terms, as every fresh session is pinned with. */
  get defaultTerms(): DataUseTerms {
    return this.defaults
  }

  /**
   * Pin narrower terms to one session and return the record as it was appended.
   * @param agent - the agent whose session the terms hold.
   * @param terms - the terms to record; their purposes may not exceed the session's.
   * @returns the terms exactly as they were appended.
   * @throws {@link DataUseError} when a field is unusable, or when the pin would
   *   admit a purpose the session's standing terms do not.
   */
  pin(agent: Agent, terms: DataUseTerms): DataUseTerms {
    const validated = validateTerms(terms, 'DATA_USE_INVALID_TERMS')
    const standing = termsOf(agent.session.events)
    if (standing !== undefined) {
      const widened = widenedPurposes(standing, validated)
      if (widened.length > 0) {
        throw new DataUseError(
          `this session is pinned to purposes ${standing.purposes.join(', ')}, which the pin widens with ${widened.join(', ')}`,
          'DATA_USE_TERMS_PINNED',
        )
      }
    }
    agent.session.append('dataUse/terms', validated)
    return validated
  }
}

/**
 * Reject every field a durable record may not carry, then freeze the record.
 * @param terms - the candidate terms, from configuration or from a pin.
 * @param code - the classification a rejection carries.
 * @returns the terms as a detached record.
 */
function validateTerms(terms: DataUseTerms, code: DataUseErrorCode): DataUseTerms {
  for (const [field, value] of [
    ['clientId', terms.clientId],
    ['agreementId', terms.agreementId],
    ['residency', terms.residency],
    ['redactionProfile', terms.redactionProfile],
  ] as const) {
    if (value.length === 0) throw new DataUseError(`${field} is empty, so the terms state no ${field}`, code)
  }
  if (terms.purposes.length === 0) throw new DataUseError('purposes is empty, so the terms admit nothing at all', code)
  const seen = new Set<DataUsePurpose>()
  for (const purpose of terms.purposes) {
    if (!DATA_USE_PURPOSES.includes(purpose)) {
      throw new DataUseError(`purpose ${JSON.stringify(purpose)} is not one of ${DATA_USE_PURPOSES.join(', ')}`, code)
    }
    if (seen.has(purpose)) throw new DataUseError(`purpose ${JSON.stringify(purpose)} is listed twice`, code)
    seen.add(purpose)
  }
  if (!Number.isInteger(terms.retentionDays) || terms.retentionDays < 1) {
    throw new DataUseError(`retentionDays ${String(terms.retentionDays)} is not a positive whole number of days`, code)
  }
  return {
    clientId: terms.clientId,
    agreementId: terms.agreementId,
    purposes: [...terms.purposes],
    residency: terms.residency,
    retentionDays: terms.retentionDays,
    redactionProfile: terms.redactionProfile,
  }
}

export default DataUseService
