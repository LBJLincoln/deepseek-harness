/**
 * Producer: the Proving Ground bench's environments, one per
 * `environments/<task>/task.json`. The task directory is the fixture: `src/`
 * is the pre-state the implementer receives, `test/` and `package.json` are
 * immutable, and `reference/` holds the solution a validator may run and an
 * implementer never sees. Tier and domain travel in the definition's detail so
 * a plan can select cells by them.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { EnvironmentId } from '@deepseek-ai/dsh-environments'
import type { EnvironmentDefinition } from '@deepseek-ai/dsh-environments'
import { CheckId } from '@deepseek-ai/dsh-verification'

declare module '@deepseek-ai/dsh-environments/types' {
  interface EnvironmentKindMap {
    /** A bench task in one language, verified by its fixture's own test suite, with the bench's tier and domain. */
    bench: { readonly language: string; readonly tier: number; readonly domain: string }
  }
}

export const name = 'register-environments'
export const inject = ['environments']

/** The fields `task.json` carries, as the authoring specification defines them. */
interface TaskFile {
  readonly id: string
  readonly tier: number
  readonly domain: string
  readonly title: string
  readonly prompt: string
  readonly heldOut: boolean
  readonly immutable: readonly string[]
  readonly checks: readonly { readonly id: string; readonly outcome: string; readonly run: string }[]
}

const ROOT = fileURLToPath(new URL('./environments/', import.meta.url))
const OWNER = 'headless-agent proving-ground-bench fixture'

/** The rules every task shares: only `src/` changes, the tests and the manifest stay, nothing gets installed. */
const SHARED_RULES = 'Change only files under src/. Do not modify anything under test/ or package.json, and add no dependencies: node_modules must not exist. The standard is `node --test test/*.test.js` passing in the workspace root.'

/** One bench task, read from its directory. */
function definition(directory: string): EnvironmentDefinition<'bench'> {
  const fixture = join(ROOT, directory)
  const task = JSON.parse(readFileSync(join(fixture, 'task.json'), 'utf8')) as TaskFile
  if (task.id !== `code:${directory}`) throw new Error(`proving-ground-bench: ${directory}/task.json declares id ${task.id}`)
  return {
    id: EnvironmentId(task.id),
    kind: 'bench',
    name: task.title,
    description: `${task.domain}, tier ${task.tier}: ${task.title}`,
    task: {
      prompt: `${task.prompt} ${SHARED_RULES}`,
      fixture,
      immutable: task.immutable,
      ...(existsSync(join(fixture, 'reference')) ? { reference: 'reference' } : {}),
    },
    checks: task.checks.map(check => ({ id: CheckId(check.id), outcome: check.outcome, run: check.run })),
    heldOut: task.heldOut,
    owner: OWNER,
    provenance: 'curated',
    detail: { language: 'javascript', tier: task.tier, domain: task.domain },
  }
}

/**
 * Register every task directory under the producer's own fiber; a bench with no
 * task is a misconfiguration and fails the boot.
 * @param ctx - the plugin context carrying the environment registry.
 */
export function apply(ctx: Context): void {
  const directories = existsSync(ROOT)
    ? readdirSync(ROOT, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && existsSync(join(ROOT, entry.name, 'task.json')))
      .map(entry => entry.name)
      .sort()
    : []
  if (directories.length === 0) throw new Error(`proving-ground-bench: no environments/<task>/task.json under ${ROOT}`)
  for (const directory of directories) ctx.effect(() => ctx.environments.register(definition(directory)))
}
