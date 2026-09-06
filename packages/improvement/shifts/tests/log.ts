/** Stub session logs the shift specs fold: the ledger events and the run stamps a shift's cells leave behind. */

import { EnvironmentId } from '@deepseek-ai/dsh-environments'
import type { FleetCell } from '@deepseek-ai/dsh-fleet/types'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import type { ShiftPlan } from '@deepseek-ai/dsh-shifts'

const HEX = 'd'.repeat(64)

/** Training-eligible smoke environments the specs plan over. */
export const ROUND_TRIP = EnvironmentId('smoke:round-trip')
/** The second training-eligible environment, used to make a plan of more than one cell. */
export const UNSATISFIABLE = EnvironmentId('smoke:unsatisfiable')
/** The held-out environment a `heldOut: false` filter must leave out. */
export const RESERVED = EnvironmentId('smoke:reserved')
/** The single model route the specs run. */
export const ROUTE = { provider: 'mock', model: 'a' }
/** The district every spec plans under. */
export const DISTRICT = 'workshop'

/**
 * One cell of the specs' plans.
 * @param environment - the environment the cell runs.
 * @param repetition - the zero-based repetition index.
 * @returns the cell on the specs' single route.
 */
export function cell(environment: string, repetition = 0): FleetCell {
  return { environment: EnvironmentId(environment), model: ROUTE, repetition }
}

/**
 * The stored header of one session.
 * @param id - the session identity.
 * @param createdAt - epoch milliseconds the header records.
 * @returns the header a backend stores.
 */
export function header(id: string, createdAt: number): SessionHeader {
  return { version: SESSION_FORMAT_VERSION, id: SessionId(id), createdAt }
}

/** Append-only event builder over a contiguous seq counter. */
export class Log {
  readonly events: SessionEvent[] = []

  /**
   * Push one event past the typed event map, so a spec can write a payload the
   * live API would refuse.
   * @param type - session event type.
   * @param data - the durable payload.
   * @param time - epoch milliseconds of the event.
   * @returns this builder.
   */
  push(type: string, data: unknown, time = 1_000 + this.events.length): this {
    this.events.push({ type, seq: this.events.length, time, data } as unknown as SessionEvent)
    return this
  }
}

/**
 * One cell session's log: the grouped run stamp, then one accounted assistant
 * message when the cell spent anything.
 * @param target - the cell the session ran.
 * @param group - the batch identity the stamp carries.
 * @param district - the district the stamp carries, absent for an undistricted run.
 * @param tokens - input tokens the single assistant message accounts for; `0` writes none.
 * @returns the contiguous events of that session.
 */
export function cellLog(target: FleetCell, group: string, district: string | undefined, tokens: number): SessionEvent[] {
  const log = new Log().push('environment/run', {
    kind: 'environment/run',
    version: 1,
    environmentId: target.environment,
    environmentKind: 'smoke',
    heldOut: false,
    promptSha256: HEX,
    checksSha256: HEX,
    contentSha256: HEX,
    repetition: target.repetition,
    group,
    ...district === undefined ? {} : { district },
    model: target.model,
    isolation: 'none',
  })
  if (tokens > 0) {
    const message = createAssistantMessage({
      content: [{ type: 'text', text: 'ok' }],
      source: { provider: target.model.provider, model: target.model.model },
    })
    log.events.push({
      type: 'assistant/message',
      seq: 1,
      time: 1_001,
      surfaceOp: 'append',
      sourceEventSeqs: [],
      data: { turn: 1, step: 1, message, usage: { inputTokens: tokens, outputTokens: 0 } },
    } as unknown as SessionEvent)
  }
  return log.events
}

/**
 * The plan the specs freeze, over the two training-eligible environments.
 * @param overrides - fields replacing the defaults.
 * @returns the frozen plan.
 */
export function plan(overrides: Partial<ShiftPlan> = {}): ShiftPlan {
  return {
    district: DISTRICT,
    environments: [ROUND_TRIP, UNSATISFIABLE],
    models: [ROUTE],
    repetitions: 1,
    ...overrides,
  }
}
