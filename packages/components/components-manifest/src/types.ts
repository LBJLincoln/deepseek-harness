/**
 * Pure vocabulary of the durable composition manifest: one entry per component
 * in play, the composition hash that addresses the whole set, and the
 * `SessionEventMap` declaration that records it. Free of cordis, agent, and
 * service imports so the writer, the fold, and the invariant companion share
 * one home.
 *
 * @module @deepseek-ai/dsh-components-manifest/types
 */

import type {
  ComponentDigest,
  ComponentDigestBasis,
  ComponentId,
  ComponentKind,
  ComponentLayer,
  ComponentProvenance,
} from '@deepseek-ai/dsh-components/types'

/** Self-declared payload version of the manifest this build writes. */
export const COMPOSITION_MANIFEST_VERSION = 1

/** One component in play, as the manifest records it. */
export interface CompositionManifestEntry {
  /** Stable component identity; with {@link digest} it forms the `id@digest` address. */
  readonly id: ComponentId
  /** Content address of the generation in play. */
  readonly digest: ComponentDigest
  /** The component's declared kind. */
  readonly kind: ComponentKind
  /** Whether the digest covers the component's own bytes or only its registration. */
  readonly digestBasis: ComponentDigestBasis
  /** Whether people curated the component or an agent synthesized it. */
  readonly provenance: ComponentProvenance
  /** Component this generation derived from, absent for roots. */
  readonly lineage?: ComponentId
  /** Registry layer the winning registration sat in for the recording agent. */
  readonly layer: ComponentLayer
}

/** The durable record of every component one agent had in play at one step. */
export interface CompositionManifest {
  /** Payload version, so a later field addition is readable against a stated shape. */
  readonly version: typeof COMPOSITION_MANIFEST_VERSION
  /** Every component in play, ordered by `id@digest` address. */
  readonly components: readonly CompositionManifestEntry[]
  /** Lowercase SHA-256 hex over the ordered addresses joined by newlines. */
  readonly compositionSha256: string
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Every component one agent had in play when a step was proposed: its
     * `id@digest` address, kind, digest basis, provenance, lineage, and the
     * registry layer the winning registration sat in, ordered by address, with
     * `compositionSha256` hashing that ordered address list. Log-only, and
     * written only when the hash differs from the last manifest in the same
     * log, so a stable composition records exactly one event and a resumed
     * session re-emits nothing. Required on read: a build that cannot
     * interpret it would otherwise treat a composition it cannot name as a
     * known one.
     */
    'composition/manifest': CompositionManifest
  }
}
