/** Test-only producer: one keyless task whose single check is a shell command over the workspace. */

import type { Context } from '@deepseek-ai/cordis'
import { EnvironmentId } from '@deepseek-ai/dsh-environments'
import type { EnvironmentDefinition } from '@deepseek-ai/dsh-environments'
import { CheckId } from '@deepseek-ai/dsh-verification'

declare module '@deepseek-ai/dsh-environments/types' {
  interface EnvironmentKindMap {
    /** A keyless task whose check runs one shell command; no kind-specific detail. */
    'sealed-cell-smoke': Record<string, never>
  }
}

export const name = 'register-environment'
export const inject = ['environments']

const definition: EnvironmentDefinition<'sealed-cell-smoke'> = {
  id: EnvironmentId('smoke:sealed-marker'),
  kind: 'sealed-cell-smoke',
  name: 'smoke:sealed-marker',
  description: 'The workspace holds MARKER.',
  task: {
    prompt: 'Create a file named MARKER in the workspace.',
  },
  checks: [{ id: CheckId('marker-file'), outcome: 'the workspace holds MARKER', run: 'test -f MARKER' }],
  heldOut: false,
  owner: 'headless-agent sealed-cell fixture',
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
