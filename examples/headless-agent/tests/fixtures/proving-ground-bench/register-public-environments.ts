/**
 * Producer: the public-repository family the environment factory synthesizes
 * from permissively licensed public JavaScript and TypeScript repositories.
 * `tools/synthesize-public-tasks.ts` writes `<directory>/<source>--<function>/`
 * — one module's dependency closure transpiled to plain JavaScript with one
 * exported function's body stubbed to `throw new Error('not implemented')`,
 * the source's licence text as `LICENSE`, a README that is task content, and
 * under `reference/` the untouched closure and one hidden case per test block
 * that exercises the function — and this producer only registers what
 * synthesis already admitted; it reads no source and stubs nothing.
 *
 * A public child registers under the same `bench` kind the curated tasks do,
 * in domain `public`, with `detail.public` naming the source repository, its
 * pinned commit, its licence and the licence text's digest, and the module and
 * tests the child was derived from; `detail.terms` the data-use purposes that
 * licence admits and the attribution file that must travel with the task; and
 * `detail.completion` the stubbed file and function. Its verdict rests on its
 * cased check alone: the workspace holds no test, and the cases are the
 * source's own tests, which the implementer never sees.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { EnvironmentId } from '@deepseek-ai/dsh-environments'
import type { EnvironmentDefinition } from '@deepseek-ai/dsh-environments'
import { authoredCheck } from './bench-cases.ts'
import type { CheckFile } from './bench-cases.ts'

export const name = 'register-public-environments'
export const inject = ['environments']

/** Plugin config: where the synthesized public children live. */
export interface Config {
  /** Directory holding `<source>--<function>/` children, resolved against this file's own location. */
  directory: string
}

export const Config: z<Config> = z.object({
  directory: z.string().default('./environments-public'),
})

/** The fields a public child's `task.json` carries, as the synthesizer writes them. */
interface TaskFile {
  readonly id: string
  readonly tier: number
  readonly domain: string
  readonly public: {
    readonly source: string
    readonly url: string
    readonly commit: string
    readonly license: string
    readonly licenseFile: string
    readonly licenseSha256: string
    readonly copyright?: string
    readonly module: string
    readonly tests: readonly string[]
  }
  readonly terms: { readonly purposes: readonly ('delivery' | 'training' | 'evaluation')[]; readonly attribution: string }
  readonly completion: { readonly file: string; readonly function: string }
  readonly title: string
  readonly prompt: string
  readonly heldOut: boolean
  readonly immutable: readonly string[]
  readonly checks: readonly CheckFile[]
}

const OWNER = 'headless-agent proving-ground-bench public factory'

/** The id marker the factory writes and `admit.mjs` strips: `code:<source>--implement-<function>` in `<source>--<function>/`. */
const ID_MARKER = '--implement-'

/** One public child, read from its directory under `root`. */
function definition(root: string, directory: string): EnvironmentDefinition<'bench'> {
  const fixture = join(root, directory)
  const task = JSON.parse(readFileSync(join(fixture, 'task.json'), 'utf8')) as TaskFile
  const expectedId = `code:${directory.replace('--', ID_MARKER)}`
  if (task.id !== expectedId) {
    throw new Error(`register-public-environments: ${directory}/task.json declares id ${task.id}, expected ${expectedId}`)
  }
  if (!existsSync(join(fixture, task.terms.attribution))) {
    throw new Error(`register-public-environments: ${directory} names ${task.terms.attribution} as its attribution, which the workspace lacks`)
  }
  const checks = task.checks.map(declared => authoredCheck(fixture, directory, declared))
  if (!checks.some(check => check.cases !== undefined)) {
    throw new Error(`register-public-environments: ${directory} carries no cased check, and the family is judged on its cases alone`)
  }
  return {
    id: EnvironmentId(task.id),
    kind: 'bench',
    name: task.title,
    description: `${task.domain}, tier ${task.tier}: ${task.title} — judged on the source's own test suite, which the validator holds back; ${task.public.license} licence, attribution kept`,
    task: {
      prompt: task.prompt,
      fixture,
      immutable: task.immutable,
      reference: 'reference',
    },
    checks,
    heldOut: task.heldOut,
    owner: OWNER,
    provenance: 'synthesized',
    detail: {
      language: 'javascript',
      tier: task.tier,
      domain: task.domain,
      completion: task.completion,
      public: task.public,
      terms: task.terms,
    },
  }
}

/**
 * Register every public child under `config.directory`. An absent directory
 * is a misconfiguration, not an empty composition: this producer is mounted
 * only where the public family is wanted, so nothing to register means the
 * factory has not run there yet, or `directory` names the wrong path, and
 * either fails the boot rather than silently shipping zero children.
 * @param ctx - the plugin context carrying the environment registry.
 * @param config - validated plugin config.
 */
export function apply(ctx: Context, config: Config): void {
  const root = fileURLToPath(new URL(`${config.directory}/`, import.meta.url))
  const directories = existsSync(root)
    ? readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && existsSync(join(root, entry.name, 'task.json')))
      .map(entry => entry.name)
      .sort()
    : []
  if (directories.length === 0) throw new Error(`register-public-environments: no <source>--<function>/task.json under ${root}`)
  for (const directory of directories) ctx.effect(() => ctx.environments.register(definition(root, directory)))
}
