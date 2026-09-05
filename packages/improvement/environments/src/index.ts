/**
 * Environment registry: the composition-time inventory of tasks with
 * verifiers. Each environment declares a task, its executable checks in the
 * completion-standard vocabulary, and whether it is held out for evaluation.
 * The registry executes nothing; the
 * [trajectory-export Agent Note](../../../.agents/notes/proposed/architecture/2026-09-05-trajectory-export-and-environment-registry.md)
 * owns the design rationale.
 * @module @deepseek-ai/dsh-environments
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { EnvironmentDefinition, EnvironmentFilter, EnvironmentId as EnvironmentIdType } from './types.ts'

export type * from './types.ts'

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
