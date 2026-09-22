/**
 * Producer: one environment per admitted exercise of the aider polyglot
 * benchmark, read from the checkout the composition names and staged into a
 * directory this plugin owns. The checkout must be at the revision
 * `admission.json` records, unchanged; the exercises admission refused are not
 * registered.
 *
 * A staged fixture is the exercise directory without its dot-directories, with
 * `.meta` kept as the task reference the runner withholds from every
 * workspace. With a read barrier composed, the checkout and the staging
 * directory are denied to every implementer, since both hold every reference
 * solution.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { EnvironmentId } from '@deepseek-ai/dsh-environments'
import type { EnvironmentDefinition } from '@deepseek-ai/dsh-environments'
import type {} from '@deepseek-ai/dsh-read-barrier'
import { CheckId } from '@deepseek-ai/dsh-verification'
import {
  admittedExercises, exercisePrompt, heldOutIds, POLYGLOT_TEST_COMMANDS, readAdmission, REFERENCE_DIRECTORY, stageExercise,
} from './polyglot.ts'
import type { PolyglotExercise } from './polyglot.ts'

declare module '@deepseek-ai/dsh-environments/types' {
  interface EnvironmentKindMap {
    /**
     * A bench task in one language, verified by its fixture's own test suite.
     * The in-house bench's tasks carry its tier and domain; an external suite's
     * tasks carry neither. `family` and `completion` are absent on a curated task
     * and present on a completion child `register-completion-environments.ts`
     * synthesizes from one: they name the parent task and the one function its
     * workspace stubs out. The declaration is repeated verbatim from the in-house
     * bench's registrar, as declaration merging requires.
     */
    bench: {
      readonly language: string
      readonly tier?: number
      readonly domain?: string
      readonly family?: string
      readonly completion?: { readonly file: string; readonly function: string }
    }
  }
}

export const name = 'register-environments'
export const inject = ['environments']

/** The registrar's configuration. */
export interface RegistrarConfig {
  /** Absolute path of a polyglot-benchmark checkout; the fixture's compositions read it from `POLYGLOT_BENCH_DIR`. */
  readonly checkout?: string
}

/** The admission record the registrar obeys, beside it. */
const ADMISSION_PATH = fileURLToPath(new URL('./admission.json', import.meta.url))
const OWNER = 'headless-agent polyglot-bench fixture'

/** One environment definition for one staged exercise. */
function definition(exercise: PolyglotExercise, fixture: string, immutable: readonly string[], heldOut: boolean, revision: string): EnvironmentDefinition<'bench'> {
  return {
    id: EnvironmentId(exercise.id),
    kind: 'bench',
    name: `${exercise.name} (${exercise.language})`,
    description: `The Exercism ${exercise.language} exercise ${exercise.name}, as the aider polyglot benchmark ships it at ${revision.slice(0, 12)}`,
    task: { prompt: exercisePrompt(exercise), fixture, immutable, reference: REFERENCE_DIRECTORY },
    checks: [{ id: CheckId('tests-pass'), outcome: 'the exercise test suite passes', run: POLYGLOT_TEST_COMMANDS[exercise.language] }],
    heldOut,
    owner: OWNER,
    provenance: 'curated',
    detail: { language: exercise.language },
  }
}

/**
 * Verify the checkout, stage every admitted exercise, and register one
 * environment each under the producer's own fiber. A checkout that is missing,
 * at another revision, or changed fails the boot.
 * @param ctx - the plugin context carrying the environment registry.
 * @param config - the registrar configuration naming the checkout.
 */
export function apply(ctx: Context, config: RegistrarConfig): void {
  const { checkout } = config
  if (checkout === undefined || checkout === '' || !isAbsolute(checkout)) {
    throw new Error(`polyglot-bench: register-environments needs checkout, the absolute path of a polyglot-benchmark checkout (POLYGLOT_BENCH_DIR in this fixture's compositions), got ${JSON.stringify(checkout)}`)
  }
  const admission = readAdmission(ADMISSION_PATH)
  const exercises = admittedExercises(checkout, admission)
  const heldOut = heldOutIds(admission.admitted)
  const staging = mkdtempSync(join(tmpdir(), 'polyglot-bench-'))
  ctx.effect(() => () => { rmSync(staging, { recursive: true, force: true }) }, `polyglot-bench staging ${staging}`)
  const definitions = exercises.map((exercise) => {
    const fixture = join(staging, exercise.language, exercise.name)
    return definition(exercise, fixture, stageExercise(exercise, fixture), heldOut.has(exercise.id), admission.revision)
  })
  for (const entry of definitions) ctx.effect(() => ctx.environments.register(entry))
  ctx.inject(['readBarrier'], (barrierCtx) => {
    barrierCtx.effect(() => barrierCtx.readBarrier.protect(checkout))
    barrierCtx.effect(() => barrierCtx.readBarrier.protect(staging))
  })
}
