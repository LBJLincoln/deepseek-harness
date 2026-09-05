/** Test-only producer: three environments the runner e2e drives, one passing, one unsatisfiable, one held out. */

import type { Context } from '@deepseek-ai/cordis'
import { EnvironmentId } from '@deepseek-ai/dsh-environments'
import type { EnvironmentDefinition } from '@deepseek-ai/dsh-environments'
import { CheckId } from '@deepseek-ai/dsh-verification'

declare module '@deepseek-ai/dsh-environments/types' {
  interface EnvironmentKindMap {
    /** A keyless smoke task with one command check and no kind-specific detail. */
    smoke: Record<string, never>
  }
}

export const name = 'register-environments'
export const inject = ['environments']

const OWNER = 'headless-agent environment-run fixture'

function smoke(id: string, description: string, check: EnvironmentDefinition['checks'][number], heldOut: boolean): EnvironmentDefinition {
  return {
    id: EnvironmentId(id),
    kind: 'smoke',
    name: id,
    description,
    task: { prompt: 'Prove the CLI tool round trip.' },
    checks: [check],
    heldOut,
    owner: OWNER,
    provenance: 'curated',
    detail: {},
  }
}

export function apply(ctx: Context): void {
  const definitions = [
    smoke('smoke:round-trip', 'The bash round trip prints its marker.', { id: CheckId('round-trip-prints'), outcome: 'the bash round trip prints CLI_TOOL_ROUND_TRIP', run: 'printf CLI_TOOL_ROUND_TRIP' }, false),
    smoke('smoke:unsatisfiable', 'The workspace never holds MARKER.', { id: CheckId('marker-file'), outcome: 'the workspace holds MARKER', run: 'test -f MARKER' }, false),
    smoke('smoke:reserved', 'Held out for evaluation.', { id: CheckId('round-trip-prints'), outcome: 'the bash round trip prints CLI_TOOL_ROUND_TRIP', run: 'printf CLI_TOOL_ROUND_TRIP' }, true),
  ]
  for (const definition of definitions) ctx.effect(() => ctx.environments.register(definition))
}
