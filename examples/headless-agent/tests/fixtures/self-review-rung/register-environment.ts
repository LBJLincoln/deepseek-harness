/** Test-only producer: one environment whose check reads the exact line the task specifies. */

import type { Context } from '@deepseek-ai/cordis'
import { EnvironmentId } from '@deepseek-ai/dsh-environments'
import type { EnvironmentDefinition } from '@deepseek-ai/dsh-environments'
import { CheckId } from '@deepseek-ai/dsh-verification'

declare module '@deepseek-ai/dsh-environments/types' {
  interface EnvironmentKindMap {
    /** A keyless task with one command check over the exact content of one file; no kind-specific detail. */
    'review-smoke': Record<string, never>
  }
}

export const name = 'register-environment'
export const inject = ['environments']

const definition: EnvironmentDefinition<'review-smoke'> = {
  id: EnvironmentId('smoke:ready-marker'),
  kind: 'review-smoke',
  name: 'smoke:ready-marker',
  description: 'MARKER holds the single line ready.',
  task: {
    prompt: 'Create a file named MARKER in the workspace whose only line is the word ready. The check reads the file back exactly.',
  },
  checks: [{ id: CheckId('marker-reads-ready'), outcome: 'MARKER holds the single line ready', run: 'test "$(cat MARKER)" = ready' }],
  heldOut: false,
  owner: 'headless-agent self-review-rung fixture',
  provenance: 'curated',
  detail: {},
}

/**
 * Register the environment under the producer's own fiber.
 * @param ctx - the plugin context carrying the environment registry.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.environments.register(definition))
}
