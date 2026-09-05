/**
 * Environment registry: the composition-time inventory of tasks with
 * verifiers. Each environment declares a task, its executable checks in the
 * completion-standard vocabulary, and whether it is held out for evaluation.
 * The registry executes nothing; the
 * [trajectory-export Agent Note](../../../.agents/notes/proposed/architecture/2026-09-05-trajectory-export-and-environment-registry.md)
 * owns the design rationale.
 * @module @deepseek-ai/dsh-environments
 */

import { createHash } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-llm'
// Type-only: the durable event vocabulary this package augments.
import type {} from '@deepseek-ai/dsh-session'
import type {
  EnvironmentContentHashes,
  EnvironmentDefinition,
  EnvironmentFilter,
  EnvironmentId as EnvironmentIdType,
  EnvironmentRunStamp,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Environment run stamp: the environment, its content hashes, the
     * repetition, group, and district, the model route, and the declared
     * isolation of one run, appended once before the run's first turn.
     */
    'environment/run': EnvironmentRunStamp
  }
}

/** Self-declared payload version of the `environment/run` event. */
export const ENVIRONMENT_RUN_VERSION = 1

const ISOLATIONS = new Set(['none', 'process', 'host'])
const HEX_64 = /^[0-9a-f]{64}$/

/** SHA-256 hex digest of one UTF-8 string. */
function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/**
 * Content hashes of one environment: the prompt, the check inventory in
 * authored order, the caller-computed fixture digest, and the combined key.
 * @param environment - the task and checks to hash.
 * @param fixtureSha256 - digest of the fixture files, absent for a task without a fixture.
 * @returns the four digests; identical inputs give identical digests.
 */
export function environmentContentHashes(
  environment: Pick<EnvironmentDefinition, 'task' | 'checks'>,
  fixtureSha256?: string,
): EnvironmentContentHashes {
  const promptSha256 = sha256(environment.task.prompt)
  const checksSha256 = sha256(JSON.stringify(environment.checks.map(check => [check.id, check.outcome, check.run])))
  const contentSha256 = sha256([promptSha256, fixtureSha256 ?? '', checksSha256].join('\n'))
  return { promptSha256, checksSha256, ...fixtureSha256 === undefined ? {} : { fixtureSha256 }, contentSha256 }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Require one non-empty string field of a durable stamp. */
function stampText(value: Record<string, unknown>, key: string): string {
  const field = value[key]
  if (typeof field !== 'string' || field === '') throw new Error(`environment/run ${key} must be a non-empty string`)
  return field
}

/** Require one SHA-256 hex field of a durable stamp. */
function stampHex(value: Record<string, unknown>, key: string): string {
  const field = stampText(value, key)
  if (!HEX_64.test(field)) throw new Error(`environment/run ${key} must be a SHA-256 hex digest`)
  return field
}

/**
 * Decode a value that declares itself as an environment run stamp. Unrelated
 * values return `undefined`; a malformed stamp fails replay loudly, as every
 * durable payload does at the log boundary.
 * @param value - candidate durable payload.
 * @returns the validated stamp, or `undefined` for another value kind.
 */
export function decodeEnvironmentRun(value: unknown): EnvironmentRunStamp | undefined {
  if (!isRecord(value) || value['kind'] !== 'environment/run') return undefined
  if (value['version'] !== ENVIRONMENT_RUN_VERSION) {
    throw new Error(`unsupported environment/run version ${String(value['version'])}`)
  }
  const heldOut = value['heldOut']
  if (typeof heldOut !== 'boolean') throw new Error('environment/run heldOut must be a boolean')
  const repetition = value['repetition']
  if (typeof repetition !== 'number' || !Number.isSafeInteger(repetition) || repetition < 0) {
    throw new Error('environment/run repetition must be a non-negative integer')
  }
  const model = value['model']
  if (!isRecord(model)) throw new Error('environment/run model must be a record')
  const isolation = value['isolation']
  if (typeof isolation !== 'string' || !ISOLATIONS.has(isolation)) {
    throw new Error('environment/run isolation must be none, process, or host')
  }
  const fixture = value['fixtureSha256'] === undefined ? {} : { fixtureSha256: stampHex(value, 'fixtureSha256') }
  const group = value['group'] === undefined ? {} : { group: stampText(value, 'group') }
  const district = value['district'] === undefined ? {} : { district: stampText(value, 'district') }
  return {
    kind: 'environment/run',
    version: ENVIRONMENT_RUN_VERSION,
    environmentId: EnvironmentId(stampText(value, 'environmentId')),
    environmentKind: stampText(value, 'environmentKind'),
    heldOut,
    promptSha256: stampHex(value, 'promptSha256'),
    checksSha256: stampHex(value, 'checksSha256'),
    ...fixture,
    contentSha256: stampHex(value, 'contentSha256'),
    repetition,
    ...group,
    ...district,
    model: { provider: stampText(model, 'provider'), model: stampText(model, 'model') },
    isolation: isolation as EnvironmentRunStamp['isolation'],
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    environments: EnvironmentRegistry
  }
}

/** Stable error codes for rejected environment registrations. */
export type EnvironmentErrorCode =
  | 'ENVIRONMENT_DUPLICATE_ID'
  | 'ENVIRONMENT_NO_CHECKS'
  | 'ENVIRONMENT_DUPLICATE_CHECK'

/** Error returned by the environment registry boundary. */
export class EnvironmentError extends HarnessError {
  /**
   * @param message - human-readable rejection reason.
   * @param code - stable machine-routable classification.
   */
  // Keep the constructor to narrow HarnessError's string code at this boundary.
  // oxlint-disable-next-line typescript/no-useless-constructor -- type-only narrowing
  constructor(message: string, code: EnvironmentErrorCode) {
    super(message, code)
  }
}

/**
 * Brand a string as an environment id.
 * @param id - raw environment identifier.
 * @returns the same string with the compile-time brand.
 */
export function EnvironmentId(id: string): EnvironmentIdType {
  return id as EnvironmentIdType
}

/** Copy a definition so callers never share the registry's stored check list. */
function detach(definition: EnvironmentDefinition): EnvironmentDefinition {
  return { ...definition, checks: definition.checks.map(check => ({ ...check })) }
}

/** Reject a definition whose verifiers cannot author a completion standard. */
function assertChecks(definition: EnvironmentDefinition): void {
  if (definition.checks.length === 0) {
    throw new EnvironmentError(`environment "${definition.id}" declares no checks`, 'ENVIRONMENT_NO_CHECKS')
  }
  const seen = new Set<string>()
  for (const check of definition.checks) {
    if (seen.has(check.id)) {
      throw new EnvironmentError(`environment "${definition.id}" declares check "${check.id}" twice`, 'ENVIRONMENT_DUPLICATE_CHECK')
    }
    seen.add(check.id)
  }
}

/** Environment registry (`ctx.environments`): tasks with verifiers, held at composition time. */
export class EnvironmentRegistry extends Service {
  private readonly environments = new Map<EnvironmentIdType, EnvironmentDefinition>()

  constructor(ctx: Context) {
    super(ctx, 'environments')
  }

  /**
   * Register one environment. Registrations are effects: the producer keeps
   * the returned disposer under its own fiber so disposal removes the entry.
   * @param definition - complete environment definition.
   * @returns the exact disposer that removes this registration and no later one under the same id.
   * @throws {@link EnvironmentError} when the id is already registered, the
   *   definition declares no checks, or two checks share an id.
   */
  register(definition: EnvironmentDefinition): () => void {
    if (this.environments.has(definition.id)) {
      throw new EnvironmentError(`environment "${definition.id}" is already registered`, 'ENVIRONMENT_DUPLICATE_ID')
    }
    assertChecks(definition)
    const stored = detach(definition)
    this.environments.set(stored.id, stored)
    return () => {
      if (this.environments.get(stored.id) === stored) this.environments.delete(stored.id)
    }
  }

  /**
   * Read one environment.
   * @param id - environment identity.
   * @returns a detached definition, or `undefined` when nothing is registered under the id.
   */
  get(id: EnvironmentIdType): EnvironmentDefinition | undefined {
    const stored = this.environments.get(id)
    return stored === undefined ? undefined : detach(stored)
  }

  /**
   * List environments in registration order.
   * @param filter - kind and held-out selection; absent fields match everything.
   * @returns detached definitions.
   */
  list(filter: EnvironmentFilter = {}): EnvironmentDefinition[] {
    return [...this.environments.values()]
      .filter(environment => filter.kind === undefined || environment.kind === filter.kind)
      .filter(environment => filter.heldOut === undefined || environment.heldOut === filter.heldOut)
      .map(detach)
  }
}

export default EnvironmentRegistry
