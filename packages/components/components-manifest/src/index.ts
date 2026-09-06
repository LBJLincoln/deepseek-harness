/**
 * Composition manifest writer. Before every proposed step it recomputes the
 * components the calling agent has in play, addresses the whole set with one
 * `compositionSha256`, and appends a `composition/manifest` event only when
 * that hash differs from the last one the session log recorded.
 *
 * Recomputing rather than tracking incrementally is what keeps the record
 * correct across a producer's HMR disposal, a preset mounted after creation,
 * and scope shadowing: the writer holds no subscription state any of those
 * orderings could invalidate.
 *
 * @module @deepseek-ai/dsh-components-manifest
 */

import type { Context } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
// Type-only: resolves ctx.components and the registry's read options.
import type {} from '@deepseek-ai/dsh-components'
import { buildCompositionManifest, lastCompositionManifest } from './fold.ts'

// The pure payload outlet (./types.ts, the ONE home of the
// `composition/manifest` declaration) re-exported onto the package root keeps
// the module edge in the emitted index.d.ts, so aggregate programs consuming
// the declaration still receive the SessionEventMap merge.
export type * from './types.ts'
export { COMPOSITION_MANIFEST_VERSION } from './types.ts'
export {
  buildCompositionManifest, compositionSha256, isComponentAddress, lastCompositionManifest, manifestEntries,
} from './fold.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'components-manifest'

/** The agent registry that owns pre-step processing, and the inventory the manifest records. */
export const inject = ['agents', 'components']

/**
 * Record the composition before every proposed step.
 *
 * `next()` runs first so the reading covers what the whole pre-step chain
 * settled on, and the manifest is written for the step that was proposed even
 * when a later policy rejected it: the composition was in play either way, and
 * the deduplication key keeps a stable one to exactly one event.
 * @param ctx - plugin context; the listener is disposed with it.
 */
export function apply(ctx: Context): void {
  ctx.on('agent/pre-step', async ({ agent }, next): Promise<PreStepDecision> => {
    const decision = await next()
    const manifest = buildCompositionManifest(ctx.components.list({ scope: agent }))
    if (lastCompositionManifest(agent.session.events)?.compositionSha256 !== manifest.compositionSha256) {
      agent.session.append('composition/manifest', manifest)
    }
    return decision
  })
}
