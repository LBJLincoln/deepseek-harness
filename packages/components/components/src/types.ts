/**
 * Pure types of the component domain: identities, the merge-extensible kind
 * map, descriptors, and the invoke pointer, free of host-side imports.
 *
 * @module @deepseek-ai/dsh-components/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies one component; derived from its kind and the owning seam's stable name, never from mount order. */
export type ComponentId = Branded<'ComponentId'>

/**
 * Merge-extensible map from component kind to that kind's detail type. Each
 * producer package declares its kind by declaration merging; the registry
 * itself ships no kind.
 */
export interface ComponentKindMap {}

/** Every declared component kind; `string` while no producer has merged a kind into the program. */
export type ComponentKind = [keyof ComponentKindMap] extends [never] ? string : Extract<keyof ComponentKindMap, string>

/** Kind-specific detail declared by the kind's producer; `unknown` for kinds outside this program. */
export type ComponentDetail<K extends string> = K extends keyof ComponentKindMap ? ComponentKindMap[K] : unknown

/** Whether people curated a component or an agent synthesized it. */
export type ComponentProvenance = 'curated' | 'synthesized'

/** The existing tool a model calls, with fixed arguments, to reach a component. */
export interface ComponentInvoke {
  /** Registered tool name. */
  readonly tool: string
  /** Arguments fixed by the component; the model supplies the rest. */
  readonly arguments?: Readonly<Record<string, string>>
}

/** One addressable unit of a composition. */
export interface ComponentDescriptor<K extends ComponentKind = ComponentKind> {
  /** Stable identity across compositions. */
  readonly id: ComponentId
  /** Declared kind. */
  readonly kind: K
  /** Human-readable name. */
  readonly name: string
  /** What the component does, stated for people and models. */
  readonly description: string
  /** Package that produced the registration. */
  readonly owner: string
  /** Curated by people or synthesized by an agent. */
  readonly provenance: ComponentProvenance
  /** Component this one derived from, absent for roots. */
  readonly lineage?: ComponentId
  /** Child components of a composition, absent for leaves. */
  readonly members?: readonly ComponentId[]
  /** How a model reaches the component, absent for kinds without a callable route. */
  readonly invoke?: ComponentInvoke
  /** Kind-specific detail. */
  readonly detail: ComponentDetail<K>
}
