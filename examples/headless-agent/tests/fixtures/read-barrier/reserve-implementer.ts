/**
 * Test-only validator stand-in: seed one validator-owned file under the barrier
 * root and reserve the run directory of every agent the composition creates, so
 * the snapshot's single session holds the implementer role from its first turn.
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-read-barrier'

export const name = 'reserve-implementer'
export const inject = ['agents', 'readBarrier']

/** The standard a validator would place under its own root before the run starts. */
const STANDARD = '{\n  "checks": [\n    { "id": "marker", "run": "test -f MARKER" }\n  ]\n}\n'

/**
 * Seed the validator-owned standard and reserve every agent. Loader siblings
 * mount concurrently, so the sweep covers an agent the spine created before this
 * plugin's listener existed.
 * @param ctx - the plugin context carrying the agent registry and the barrier.
 */
export function apply(ctx: Context): void {
  writeFileSync(join(ctx.readBarrier.root, 'standard.json'), STANDARD, { mode: 0o600 })
  for (const agent of ctx.agents.list()) ctx.readBarrier.reserve(agent)
  ctx.on('agent/created', ({ agent }) => { ctx.readBarrier.reserve(agent) })
}
