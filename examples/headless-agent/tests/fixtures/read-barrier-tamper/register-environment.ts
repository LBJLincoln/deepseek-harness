/** Test-only producer: one environment whose fixture supplies the test file the implementer must not author. */

import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { EnvironmentId } from '@deepseek-ai/dsh-environments'
import type { EnvironmentDefinition } from '@deepseek-ai/dsh-environments'
import { CheckId } from '@deepseek-ai/dsh-verification'

declare module '@deepseek-ai/dsh-environments/types' {
  interface EnvironmentKindMap {
    /** A keyless task whose fixture supplies its own test file; no kind-specific detail. */
    'tamper-smoke': Record<string, never>
  }
}

export const name = 'register-environment'
export const inject = ['environments']

const definition: EnvironmentDefinition<'tamper-smoke'> = {
  id: EnvironmentId('smoke:immutable-test'),
  kind: 'tamper-smoke',
  name: 'smoke:immutable-test',
  description: 'The workspace holds MARKER, which the fixture test checks for.',
  task: {
    prompt: 'Create a file named MARKER in the workspace so that tests/check.sh passes. tests/check.sh is the validator\'s file: never edit it.',
    fixture: fileURLToPath(new URL('./fixture', import.meta.url)),
    immutable: ['tests/check.sh'],
  },
  checks: [{ id: CheckId('marker-file'), outcome: 'the workspace holds MARKER', run: 'sh tests/check.sh' }],
  heldOut: false,
  owner: 'headless-agent read-barrier-tamper fixture',
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
