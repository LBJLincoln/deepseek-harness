/**
 * Producer: the completion family the environment factory synthesizes from
 * the bench's own reference programs. `tools/synthesize-completion-tasks.mjs`
 * writes `<directory>/<parent>--<function>/` — the reference solution with
 * one top-level function's body stubbed to `throw new Error('not implemented')`,
 * the parent's `test/` and `package.json` unchanged, and the parent's
 * `reference/` kept so admission can run — and this producer only registers
 * what synthesis already admitted; it reads no source and stubs nothing.
 *
 * A completion child registers under the same `bench` kind its parent does,
 * distinguished by `detail.family` (the parent's environment id, so a family
 * never straddles the held-out split: every child inherits its parent's
 * `heldOut`) and `detail.completion` (the stubbed file and function). Its
 * `checks` never carry a hidden case: the certificate it earns says the
 * function passes the suite an implementer can read, nothing about a
 * validator's held-back corpus.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { EnvironmentId } from '@deepseek-ai/dsh-environments'
import type { EnvironmentDefinition } from '@deepseek-ai/dsh-environments'
import { CheckId } from '@deepseek-ai/dsh-verification'
import type { AuthoredCheck } from '@deepseek-ai/dsh-verification'

export const name = 'register-completion-environments'
export const inject = ['environments']

/** Plugin config: where the synthesized completion children live. */
export interface Config {
  /** Directory holding `<parent>--<function>/` children, resolved against this file's own location. */
  directory: string
}

export const Config: z<Config> = z.object({
  directory: z.string().default('./environments-completion'),
})

/** One check as a completion child's `task.json` declares it. Never carries `cases`: see the module doc. */
interface CheckFile {
  readonly id: string
  readonly outcome: string
  readonly run: string
}

/** The fields a completion child's `task.json` carries, as the synthesizer writes them. */
interface TaskFile {
  readonly id: string
  readonly tier: number
  readonly domain: string
  readonly family: string
  readonly completion: { readonly file: string; readonly function: string }
  readonly title: string
  readonly prompt: string
  readonly heldOut: boolean
  readonly immutable: readonly string[]
  readonly checks: readonly CheckFile[]
}

const OWNER = 'headless-agent proving-ground-bench completion factory'

/** One completion child, read from its directory under `root`. */
function definition(root: string, directory: string): EnvironmentDefinition<'bench'> {
  const fixture = join(root, directory)
  const task = JSON.parse(readFileSync(join(fixture, 'task.json'), 'utf8')) as TaskFile
  const expectedId = `code:${directory.replace('--', '--complete-')}`
  if (task.id !== expectedId) {
    throw new Error(`register-completion-environments: ${directory}/task.json declares id ${task.id}, expected ${expectedId}`)
  }
  const checks: AuthoredCheck[] = task.checks.map(check => ({ id: CheckId(check.id), outcome: check.outcome, run: check.run }))
  return {
    id: EnvironmentId(task.id),
    kind: 'bench',
    name: task.title,
    description: `${task.domain}, tier ${task.tier}: ${task.title} — visible-test tier, no hidden cases`,
    task: {
      prompt: task.prompt,
      fixture,
      immutable: task.immutable,
      ...(existsSync(join(fixture, 'reference')) ? { reference: 'reference' } : {}),
    },
    checks,
    heldOut: task.heldOut,
    owner: OWNER,
    provenance: 'synthesized',
    lineage: EnvironmentId(task.family),
    detail: {
      language: 'javascript',
      tier: task.tier,
      domain: task.domain,
      family: task.family,
      completion: task.completion,
    },
  }
}

/**
 * Register every completion child under `config.directory`. An absent
 * directory is a misconfiguration, not an empty composition: this producer is
 * mounted only where the completion family is wanted, so nothing to register
 * means the factory has not run there yet, or `directory` names the wrong
 * path, and either fails the boot rather than silently shipping zero children.
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
  if (directories.length === 0) throw new Error(`register-completion-environments: no <parent>--<function>/task.json under ${root}`)
  for (const directory of directories) ctx.effect(() => ctx.environments.register(definition(root, directory)))
}
