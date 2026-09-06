/**
 * Component registry: identity, content address, kind, provenance, lineage,
 * membership, and the callable route of every addressable unit in a
 * composition. The registry executes nothing and holds composition-time state
 * only. The
 * [component-registry Agent Note](../../../.agents/notes/proposed/architecture/2026-09-01-component-registry-seam.md)
 * owns the registry design; the
 * [composition-manifest Agent Note](../../../.agents/notes/proposed/architecture/2026-09-05-composition-manifest.md)
 * owns content addressing and the layering.
 * @module @deepseek-ai/dsh-components
 */

import { createHash } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { NamedEntries, ScopedLayers } from '@deepseek-ai/dsh-scope'
import type { ScopeKey, ScopeLayer } from '@deepseek-ai/dsh-scope'
import type {
  ComponentCanonical,
  ComponentDescriptor,
  ComponentDigest as ComponentDigestType,
  ComponentId as ComponentIdType,
  ComponentKind,
  ComponentLayer,
  ComponentListOptions,
  ComponentView,
  ComponentViewOptions,
} from './types.ts'

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

/**
 * Content address of one component: the lowercase SHA-256 hex of the kind, a
 * newline, and the JSON encoding of the producer's canonical value. The kind
 * is inside the hashed bytes, so two kinds whose canonical values coincide
 * never share an address.
 * @param kind - the declared kind, owner of the canonical value's field order.
 * @param canonical - the producer's canonical value for this component.
 * @returns the 64-character lowercase hex digest.
 */
export function componentDigest(kind: ComponentKind, canonical: ComponentCanonical): ComponentDigestType {
  return createHash('sha256').update(`${kind}\n${JSON.stringify(canonical)}`).digest('hex') as ComponentDigestType
}

/**
 * Address one generation of a component: its stable id and the digest of the
 * bytes that generation holds. Consumers that compare generations key on this
 * string; the digest stays at full length.
 * @param id - stable component identity.
 * @param digest - digest of this generation.
 * @returns `id@digest`.
 */
export function componentAddress(id: ComponentIdType, digest: ComponentDigestType): string {
  return `${id}@${digest}`
}

/** One registration plus the layer name every read reports for it. */
interface StoredComponent {
  readonly descriptor: ComponentDescriptor
  readonly layer: ComponentLayer
}

/** Copy a descriptor so callers never share the registry's stored arrays. */
function detach(descriptor: ComponentDescriptor): ComponentDescriptor {
  return {
    ...descriptor,
    ...descriptor.members === undefined ? {} : { members: [...descriptor.members] },
  }
}

/** Detach one stored registration into the view a caller reads. */
function viewOf(stored: StoredComponent): ComponentView {
  return { ...detach(stored.descriptor), layer: stored.layer }
}

/**
 * One scope's component registrations. The context-global layer reports
 * `global` and every scoped overlay reports `agent`: a deeper chain still
 * reads as `agent`, because a subagent records its own composition.
 */
class ComponentScopeLayer implements ScopeLayer {
  readonly components: NamedEntries<StoredComponent>
  /** Layer name reported for every registration filed here. */
  readonly name: ComponentLayer

  constructor(scope: ScopeKey | undefined) {
    this.name = scope === undefined ? 'global' : 'agent'
    this.components = new NamedEntries(id => new ComponentError(
      scope === undefined
        ? `component "${id}" is already registered`
        : `component "${id}" is already registered in this scope`,
      'COMPONENT_DUPLICATE_ID',
    ))
  }

  /** Whether this aggregate layer holds no registration. */
  isEmpty(): boolean {
    return this.components.isEmpty()
  }
}

/** Component registry (`ctx.components`): the composition-time inventory mirrored from live seams. */
export class ComponentRegistry extends Service {
  private readonly layers = new ScopedLayers<ComponentScopeLayer>(
    scope => new ComponentScopeLayer(scope),
    // No change notification: nothing follows registry edges, and a consumer
    // that needs the current inventory reads it. The event belongs with its
    // first subscriber.
    () => {},
  )

  constructor(ctx: Context) {
    super(ctx, 'components')
  }

  /**
   * Register one component into the calling context's layer: an unscoped
   * context (a host row or repository plugin) registers globally, while a
   * scoped context (an agent preset's standing mount) registers for that
   * scope alone. Registrations are effects: the producer keeps the returned
   * disposer under its own fiber so disposal removes the component.
   * @param descriptor - complete component description, including the digest its producer computed.
   * @returns the exact disposer that removes this registration and no later one under the same id.
   * @throws {@link ComponentError} when the id is already registered in the same layer.
   */
  register(descriptor: ComponentDescriptor): () => void {
    const stored = detach(descriptor)
    return this.layers.effect(
      this.ctx,
      layer => layer.components.insert(stored.id, { descriptor: stored, layer: layer.name }),
      { label: 'components.register()' },
    )
  }

  /**
   * Read one component as a scope sees it.
   * @param id - component identity.
   * @param options - read options; `scope` selects the viewing agent's layers.
   * @returns a detached view carrying its winning layer, or `undefined` when the id is absent.
   */
  get(id: ComponentIdType, options: ComponentViewOptions = {}): ComponentView | undefined {
    const stored = this.view(options.scope).get(id)
    return stored === undefined ? undefined : viewOf(stored)
  }

  /**
   * List components as a scope sees them, in registration order with the
   * global layer first.
   * @param options - read options; `scope` selects the viewing agent's layers and `kind` filters by kind.
   * @returns detached views carrying their winning layer.
   */
  list(options: ComponentListOptions = {}): ComponentView[] {
    const kind = options.kind
    return [...this.view(options.scope).values()]
      .filter(stored => kind === undefined || stored.descriptor.kind === kind)
      .map(viewOf)
  }

  /**
   * Effective registrations for one viewing scope: the global layer followed
   * by the scope chain farthest ancestor first, so the nearest layer's entry
   * wins a duplicate id.
   */
  private view(scope: ScopeKey | undefined): Map<string, StoredComponent> {
    return this.layers.merge(scope, layer => layer.components)
  }
}

export default ComponentRegistry
