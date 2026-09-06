/** Test-only producer: one environment whose fixture satisfies one of its two checks. */

import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { EnvironmentId } from '@deepseek-ai/dsh-environments'
import type { EnvironmentDefinition } from '@deepseek-ai/dsh-environments'
import { CheckId } from '@deepseek-ai/dsh-verification'

declare module '@deepseek-ai/dsh-environments/types' {
  interface EnvironmentKindMap {
    /** A keyless task an implementer with no tools cannot finish; no kind-specific detail. */
    'judge-smoke': Record<string, never>
  }
}

export const name = 'register-environment'
export const inject = ['environments']

const definition: EnvironmentDefinition<'judge-smoke'> = {
  id: EnvironmentId('smoke:blind-judge'),
  kind: 'judge-smoke',
  name: 'smoke:blind-judge',
  description: 'The fixture supplies SPEC.txt; the task also asks for MARKER, which this implementer cannot write.',
  task: {
    prompt: 'The workspace must hold both SPEC.txt and a file named MARKER. Report when it does.',
    fixture: fileURLToPath(new URL('./fixture', import.meta.url)),
  },
  // Both checks only test for a file, so validation leaves the workspace exactly
  // as the attempt's `treeHash` recorded it and the judge's copy reproduces it.
  checks: [
    { id: CheckId('spec-present'), outcome: 'the workspace holds SPEC.txt', run: 'test -f SPEC.txt' },
    { id: CheckId('marker-present'), outcome: 'the workspace holds MARKER', run: 'test -f MARKER' },
  ],
  heldOut: false,
  owner: 'headless-agent blind-judge fixture',
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
