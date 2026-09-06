/**
 * Test-only producer: one `recreation` environment whose fixture carries the
 * reference program the validator samples and the implementer never sees.
 *
 * Its single registered check is the admission one — the candidate exists and
 * runs. Every weighted check comes from the validator, which is what the
 * driver's derived registration carries.
 */

import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { EnvironmentId } from '@deepseek-ai/dsh-environments'
import type { EnvironmentDefinition } from '@deepseek-ai/dsh-environments'
// Type-only: declares the `recreation` kind this environment registers under.
import type {} from '@deepseek-ai/dsh-tool-standard-author'
import { CheckId } from '@deepseek-ai/dsh-verification'

export const name = 'register-environment'
export const inject = ['environments']

/** Identity of the task the validator samples the reference of. */
export const RECREATION_ENVIRONMENT = EnvironmentId('smoke:tally')

/** Absolute fixture directory; its `reference/` subtree never reaches the workspace. */
const FIXTURE = fileURLToPath(new URL('./fixture', import.meta.url))

/** What the implementer is asked for, and the only description of the reference it ever gets. */
export const TASK_PROMPT = 'Write a program at ./run in the workspace, run as `. ./run`, so that `. ./run WORD` prints WORD, '
  + '`. ./run -c WORD` prints the number of characters in WORD, and running it with no argument prints '
  + '"usage: run [-c WORD] WORD" on stderr and exits 2.'

/** The admission check every candidate faces before the validator's weighted cases. */
const ADMISSION_CHECK = CheckId('program-exists')

const definition: EnvironmentDefinition<'recreation'> = {
  id: RECREATION_ENVIRONMENT,
  kind: 'recreation',
  name: 'smoke:tally',
  description: 'A one-file program whose completion standard is derived from the reference under the barrier root.',
  task: {
    prompt: TASK_PROMPT,
    fixture: FIXTURE,
    reference: 'reference',
  },
  checks: [{
    id: ADMISSION_CHECK,
    outcome: 'the workspace holds a program at ./run',
    run: 'test -f run',
  }],
  heldOut: false,
  owner: 'headless-agent recreation-instrument fixture',
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
