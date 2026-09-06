/**
 * Pure types of the component domain: identities, content addresses, the
 * merge-extensible kind map, descriptors, read options, and the invoke
 * pointer, free of host-side imports.
 *
 * @module @deepseek-ai/dsh-components/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { ScopeKey } from '@deepseek-ai/dsh-scope'

/** Identifies one component; derived from its kind and the owning seam's stable name, never from mount order. */
export type ComponentId = Branded<'ComponentId'>

/**
 * Lowercase 64-character SHA-256 hex over one component's kind and canonical
 * value. Stored and compared at full length; truncating it for a card or a
 * table is a presentation choice that never enters a log.
 */
export type ComponentDigest = Branded<'ComponentDigest'>

/**
 * JSON value a producer reduces its component to before hashing. Every field
 * a digest must cover appears here; a value a registry computes per assembly —
 * the viewing scope, the working directory, a wall clock, an absolute path, a
 * discovery source or rank — must not, so two hosts that composed the same
 * bytes address identically.
 */
export type ComponentCanonical =
  | null
  | boolean
  | number
  | string
  | readonly ComponentCanonical[]
  | { readonly [key: string]: ComponentCanonical }

/**
 * Whether a digest addresses the component's own bytes (`content`) or only the
 * fact of its registration (`registration`). A `registration` basis is the
 * honest statement for a component whose model-visible text is a function of
 * the assembly rather than of stored bytes.
 */
export type ComponentDigestBasis = 'content' | 'registration'

/**
 * Registry layer holding the winning registration of a component read through
 * a viewing scope: `global` for the context-global layer, `agent` for any
 * layer on that agent's scope chain.
 */
export type ComponentLayer = 'global' | 'agent'

/**
 * Merge-extensible map from component kind to that kind's detail type. Each
 * producer package declares its kind by declaration merging and owns that
 * kind's canonical value beside the declaration; the registry itself ships no
 * kind and never switches on one.
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
  /** Content address of what this registration holds, computed by the producer that owns the kind. */
  readonly digest: ComponentDigest
  /** What the digest covers. */
  readonly digestBasis: ComponentDigestBasis
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

/** One descriptor read back through a viewing scope, carrying the layer its winning registration sits in. */
export interface ComponentView<K extends ComponentKind = ComponentKind> extends ComponentDescriptor<K> {
  /** Layer the winning registration under this id sits in for the reading scope. */
  readonly layer: ComponentLayer
}

/** Read options shared by every scope-aware registry read. */
export interface ComponentViewOptions {
  /** Viewing scope (the calling agent); omitted reads the global layer alone. */
  readonly scope?: ScopeKey | undefined
}

/** List options: the viewing scope plus an optional kind filter. */
export interface ComponentListOptions extends ComponentViewOptions {
  /** When given, only components of this kind. */
  readonly kind?: ComponentKind | undefined
}
