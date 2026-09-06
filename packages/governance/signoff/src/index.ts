/**
 * Signoffs: the attributable human gate of the governance rollout. One
 * `signoff/recorded` event per signed transition names the principal the
 * deployment's identity provider supplied, the digest of the artefact signed,
 * and the pointers to what the signer had in view; the session log is the whole
 * record, and folding it is how a consumer learns whether a transition was
 * signed. Nothing here authenticates a principal and nothing reaches a model
 * request. The
 * [attributable-decisions Agent Note](../../../.agents/notes/proposed/architecture/2026-09-06-attributable-decisions.md)
 * owns the design rationale.
 * @module @deepseek-ai/dsh-signoff
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SignoffEvidence, SignoffRecord, SignoffTransition } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    signoffs: SignoffService
  }
}

/** Every {@link SignoffTransition}, for validation and for option advertisement. */
export const SIGNOFF_TRANSITIONS: readonly SignoffTransition[] = [
  'spec-freeze',
  'relaxation',
  'review-acceptance',
  'release',
  'training-data-release',
]

/** Digest form every `artefactSha256` must take: lowercase SHA-256 hex. */
export const ARTEFACT_SHA256 = /^[0-9a-f]{64}$/

/** Stable error code of a record this service refuses to append. */
export type SignoffErrorCode = 'SIGNOFF_INVALID_RECORD'

/** Error returned when a record cannot become a durable signature. */
export class SignoffError extends HarnessError {
  /**
   * @param message - human-readable reason, naming the field at fault.
   * @param code - stable machine-routable classification.
   */
  // Keep the constructor to narrow HarnessError's string code at this boundary.
  // oxlint-disable-next-line typescript/no-useless-constructor -- type-only narrowing
  constructor(message: string, code: SignoffErrorCode) {
    super(message, code)
  }
}

/** Deployment bounds on one durable record, validated from `cordis.yml`. */
export interface Config {
  /** Positive maximum number of evidence pointers one record may carry. */
  maxEvidence: number
  /** Positive maximum length in characters of one evidence `kind` or `ref`. */
  maxEvidenceRefChars: number
}

/**
 * The newest record of one transition in a log, or `undefined` when the log
 * holds none. The pure fold: a consumer holding persisted events needs no
 * service, and a resumed session needs no catch-up because replaying the log IS
 * the state.
 * @param events - session events in log order; other event types are skipped.
 * @param transition - the transition whose newest signature is wanted.
 * @returns the last matching record, or `undefined` without one.
 */
export function latestSignoff(
  events: readonly SessionEvent[],
  transition: SignoffTransition,
): SignoffRecord | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index] as SessionEvent
    if (event.type === 'signoff/recorded' && event.data.transition === transition) return event.data
  }
  return undefined
}

/** Signoffs (`ctx.signoffs`): attributed human decisions recorded in the session log. */
export class SignoffService extends Service {
  static Config: z<Config> = z.object({
    maxEvidence: z.natural().min(1).required(),
    maxEvidenceRefChars: z.natural().min(1).required(),
  })

  private readonly config: Config

  constructor(ctx: Context, config: Config) {
    super(ctx, 'signoffs')
    this.config = config
  }

  /**
   * Record one signature on the agent's session and return the detached record.
   * The record is validated before anything is appended, so a session log never
   * carries a signature this service refused.
   * @param agent - the agent whose session carries the transition being signed.
   * @param input - the transition, principal, artefact digest, and evidence the
   *   caller states; every field is validated before anything is appended.
   * @returns the record exactly as it was appended.
   * @throws {@link SignoffError} when a field cannot become a durable signature,
   *   or when the same session already signed this transition on another artefact.
   */
  record(agent: Agent, input: SignoffRecord): SignoffRecord {
    const record = this.validate(input)
    const standing = latestSignoff(agent.session.events, record.transition)
    if (standing !== undefined && standing.artefactSha256 !== record.artefactSha256) {
      throw new SignoffError(
        `this session signed "${record.transition}" on artefact ${standing.artefactSha256}, which ${record.artefactSha256} does not match`,
        'SIGNOFF_INVALID_RECORD',
      )
    }
    agent.session.append('signoff/recorded', record)
    return record
  }

  /**
   * The newest signature of one transition on the agent's own session.
   * @param agent - the agent whose session log is folded.
   * @param transition - the transition whose newest signature is wanted.
   * @returns the last matching record, or `undefined` without one.
   */
  latest(agent: Agent, transition: SignoffTransition): SignoffRecord | undefined {
    return latestSignoff(agent.session.events, transition)
  }

  /** Reject every field a durable record may not carry, then freeze the record. */
  private validate(input: SignoffRecord): SignoffRecord {
    if (!SIGNOFF_TRANSITIONS.includes(input.transition)) {
      throw new SignoffError(`transition ${JSON.stringify(input.transition)} is not one of ${SIGNOFF_TRANSITIONS.join(', ')}`, 'SIGNOFF_INVALID_RECORD')
    }
    if (!ARTEFACT_SHA256.test(input.artefactSha256)) {
      throw new SignoffError(`artefactSha256 ${JSON.stringify(input.artefactSha256)} is not a lowercase 64-character SHA-256 hex digest`, 'SIGNOFF_INVALID_RECORD')
    }
    const { principal } = input
    // The record becomes a durable log entry, so the kind is read widened: a
    // caller assembling one from parsed JSON can carry any string here.
    const kind: string = principal.kind
    if (kind !== 'human') {
      throw new SignoffError(`principal kind ${JSON.stringify(kind)} is not "human"; only a person signs a transition`, 'SIGNOFF_INVALID_RECORD')
    }
    if (principal.id.length === 0) throw new SignoffError('principal id is empty, so the record names nobody', 'SIGNOFF_INVALID_RECORD')
    if (principal.displayName !== undefined && principal.displayName.length === 0) {
      throw new SignoffError('principal displayName is present and empty; omit it instead', 'SIGNOFF_INVALID_RECORD')
    }
    if (input.evidence.length > this.config.maxEvidence) {
      throw new SignoffError(`the record carries ${String(input.evidence.length)} evidence pointers, above the configured maximum of ${String(this.config.maxEvidence)}`, 'SIGNOFF_INVALID_RECORD')
    }
    for (const evidence of input.evidence) this.validateEvidence(evidence)
    return {
      transition: input.transition,
      principal: {
        kind: principal.kind,
        id: principal.id,
        ...principal.displayName === undefined ? {} : { displayName: principal.displayName },
      },
      artefactSha256: input.artefactSha256,
      evidence: input.evidence.map(evidence => ({ kind: evidence.kind, ref: evidence.ref })),
    }
  }

  /** Reject one evidence pointer that names nothing or exceeds the configured length. */
  private validateEvidence(evidence: SignoffEvidence): void {
    for (const [field, value] of [['kind', evidence.kind], ['ref', evidence.ref]] as const) {
      if (value.length === 0) throw new SignoffError(`evidence ${field} is empty, so the pointer names nothing`, 'SIGNOFF_INVALID_RECORD')
      if (value.length > this.config.maxEvidenceRefChars) {
        throw new SignoffError(`evidence ${field} is ${String(value.length)} characters, above the configured maximum of ${String(this.config.maxEvidenceRefChars)}`, 'SIGNOFF_INVALID_RECORD')
      }
    }
  }
}

export default SignoffService
