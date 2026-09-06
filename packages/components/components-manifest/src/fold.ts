/**
 * Pure derivations over the composition manifest: the address list one registry
 * reading produces, the hash that addresses the whole set, and the last
 * manifest a durable log recorded.
 *
 * @module @deepseek-ai/dsh-components-manifest/fold
 */

import { createHash } from 'node:crypto'
import { componentAddress } from '@deepseek-ai/dsh-components'
import type { ComponentView } from '@deepseek-ai/dsh-components/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { COMPOSITION_MANIFEST_VERSION } from './types.ts'
import type { CompositionManifest, CompositionManifestEntry } from './types.ts'

/** An `id@digest` address whose digest is a full lowercase SHA-256 hex. */
const ADDRESS = /^[^\n@]+@[0-9a-f]{64}$/

/**
 * Whether one `id@digest` address is well-formed: a non-empty id carrying no
 * separator and no newline, then the full 64-character lowercase digest a
 * comparison keys on.
 * @param address - the candidate address.
 * @returns whether the address can be compared against another generation's.
 */
export function isComponentAddress(address: string): boolean {
  return ADDRESS.test(address)
}

/**
 * Hash one ordered address list.
 * @param addresses - the `id@digest` addresses in manifest order.
 * @returns the lowercase SHA-256 hex over the addresses joined by newlines.
 */
export function compositionSha256(addresses: readonly string[]): string {
  return createHash('sha256').update(addresses.join('\n')).digest('hex')
}

/**
 * Project one registry reading onto the manifest entries, ordered by address so
 * two hosts that composed the same set hash it identically.
 * @param views - the components one agent sees, as `ctx.components.list()` returns them.
 * @returns one entry per component, ascending by `id@digest`.
 */
export function manifestEntries(views: readonly ComponentView[]): CompositionManifestEntry[] {
  return views
    .map((view): CompositionManifestEntry => ({
      id: view.id,
      digest: view.digest,
      kind: view.kind,
      digestBasis: view.digestBasis,
      provenance: view.provenance,
      ...view.lineage === undefined ? {} : { lineage: view.lineage },
      layer: view.layer,
    }))
    // Code-unit comparison, so the order is identical on every machine.
    .sort((left, right) => {
      const a = componentAddress(left.id, left.digest)
      const b = componentAddress(right.id, right.digest)
      return a < b ? -1 : a > b ? 1 : 0
    })
}

/**
 * Build the durable manifest of one registry reading.
 * @param views - the components one agent sees, as `ctx.components.list()` returns them.
 * @returns the payload to append, hashed over its own ordered addresses.
 */
export function buildCompositionManifest(views: readonly ComponentView[]): CompositionManifest {
  const components = manifestEntries(views)
  return {
    version: COMPOSITION_MANIFEST_VERSION,
    components,
    compositionSha256: compositionSha256(components.map(entry => componentAddress(entry.id, entry.digest))),
  }
}

/**
 * The newest manifest a durable log recorded.
 * @param events - the session's event log, oldest first.
 * @returns the last recorded manifest, or `undefined` when the log holds none.
 */
export function lastCompositionManifest(events: readonly SessionEvent[]): CompositionManifest | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'composition/manifest') return event.data
  }
  return undefined
}
