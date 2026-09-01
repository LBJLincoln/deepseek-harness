/**
 * Component registry: identity, kind, provenance, lineage, membership, and the
 * callable route of every addressable unit in a composition. The registry
 * executes nothing and holds composition-time state only. The
 * [component-registry Agent Note](../../../.agents/notes/proposed/architecture/2026-09-01-component-registry-seam.md)
 * owns the design rationale.
 * @module @deepseek-ai/dsh-components
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { ComponentDescriptor, ComponentId as ComponentIdType, ComponentKind } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    components: ComponentRegistry
  }
}

/** Stable error codes for rejected component registrations. */
export type ComponentErrorCode = 'COMPONENT_DUPLICATE_ID'

/** Error returned by the component registry boundary. */
export class ComponentError extends HarnessError {
  /**
   * @param message - human-readable rejection reason.
   * @param code - stable machine-routable classification.
   */
  // Keep the constructor to narrow HarnessError's string code at this boundary.
  // oxlint-disable-next-line typescript/no-useless-constructor -- type-only narrowing
  constructor(message: string, code: ComponentErrorCode) {
    super(message, code)
  }
}

/**
 * Brand a string as a component id.
 * @param id - raw component identifier.
 * @returns the same string with the compile-time brand.
 */
export function ComponentId(id: string): ComponentIdType {
  return id as ComponentIdType
}

/** Copy a descriptor so callers never share the registry's stored arrays. */
function detach(descriptor: ComponentDescriptor): ComponentDescriptor {
  return {
    ...descriptor,
    ...descriptor.members === undefined ? {} : { members: [...descriptor.members] },
  }
}

/** Component registry (`ctx.components`): the composition-time inventory mirrored from live seams. */
export class ComponentRegistry extends Service {
  private readonly components = new Map<ComponentIdType, ComponentDescriptor>()

  constructor(ctx: Context) {
    super(ctx, 'components')
  }

  /**
   * Register one component. Registrations are effects: the producer keeps the
   * returned disposer under its own fiber so disposal removes the component.
   * @param descriptor - complete component description.
   * @returns the exact disposer that removes this registration and no later one under the same id.
   * @throws {@link ComponentError} when the id is already registered.
   */
  register(descriptor: ComponentDescriptor): () => void {
    if (this.components.has(descriptor.id)) {
      throw new ComponentError(`component "${descriptor.id}" is already registered`, 'COMPONENT_DUPLICATE_ID')
    }
    const stored = detach(descriptor)
    this.components.set(stored.id, stored)
    return () => {
      if (this.components.get(stored.id) === stored) this.components.delete(stored.id)
    }
  }

  /**
   * Read one component.
   * @param id - component identity.
   * @returns a detached descriptor, or `undefined` when nothing is registered under the id.
   */
  get(id: ComponentIdType): ComponentDescriptor | undefined {
    const stored = this.components.get(id)
    return stored === undefined ? undefined : detach(stored)
  }

  /**
   * List components in registration order.
   * @param kind - when given, only components of this kind.
   * @returns detached descriptors.
   */
  list(kind?: ComponentKind): ComponentDescriptor[] {
    return [...this.components.values()]
      .filter(component => kind === undefined || component.kind === kind)
      .map(detach)
  }
}

export default ComponentRegistry
