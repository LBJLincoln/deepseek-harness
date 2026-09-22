/**
 * Producer: the Proving Ground bench's environments, one per
 * `environments/<task>/task.json`. The task directory is the fixture: `src/`
 * is the pre-state the implementer receives, `test/` and `package.json` are
 * immutable, and `reference/` holds the solution a validator may run and an
 * implementer never sees. Tier and domain travel in the definition's detail so
 * a plan can select cells by them.
 *
 * A check may name a case file under `reference/`; `bench-cases.ts` reads it
 * into the check's case bodies and refuses one anywhere else.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { EnvironmentId } from '@deepseek-ai/dsh-environments'
import type { EnvironmentDefinition } from '@deepseek-ai/dsh-environments'
import { authoredCheck } from './bench-cases.ts'
import type { CheckFile } from './bench-cases.ts'

declare module '@deepseek-ai/dsh-environments/types' {
  interface EnvironmentKindMap {
    /**
     * A bench task in one language, verified by its fixture's own test suite.
     * The in-house bench's tasks carry its tier and domain; an external suite's
     * tasks carry neither. `family` and `completion` are absent on a curated task
     * and present on a completion child `register-completion-environments.ts`
     * synthesizes from one: they name the parent task and the one function its
     * workspace stubs out. `repository` and `completion` are present on a child
     * `register-repository-environments.ts` registers from one of this
     * repository's own packages: the package, module, and spec the child was
     * derived from, and the one function its workspace stubs out.
     */
    bench: {
      readonly language: string
      readonly tier?: number
      readonly domain?: string
      readonly family?: string
      readonly completion?: { readonly file: string; readonly function: string }
      readonly repository?: { readonly package: string; readonly module: string; readonly spec: string }
    }
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
  readonly checks: readonly CheckFile[]
}

const ROOT = fileURLToPath(new URL('./environments/', import.meta.url))
const OWNER = 'headless-agent proving-ground-bench fixture'

/** The rules every task shares: only `src/` changes, the tests and the manifest stay, nothing gets installed. */
const SHARED_RULES = 'Change only files under src/. Do not modify anything under test/ or package.json, and add no dependencies: node_modules must not exist. The standard is `node --test test/*.test.js` passing in the workspace root.'

/**
 * The extra rule a task with hidden cases carries. Its verdict comes mostly
 * from inputs the implementer never sees, so a program tuned to the visible
 * suite fails; only the written specification predicts those inputs. Tasks
 * without hidden cases do not carry it, because for them it would be false.
 */
const HIDDEN_CASE_RULE = 'This task is also judged on inputs you do not see: a validator runs your program on its own held-back cases and compares the exit code and output byte for byte. The visible tests cover the main paths only. Implement the written specification, including every corner it states, rather than the behaviour the visible tests happen to pin down.'

/** One bench task, read from its directory. */
function definition(directory: string): EnvironmentDefinition<'bench'> {
  const fixture = join(ROOT, directory)
  const task = JSON.parse(readFileSync(join(fixture, 'task.json'), 'utf8')) as TaskFile
  if (task.id !== `code:${directory}`) throw new Error(`proving-ground-bench: ${directory}/task.json declares id ${task.id}`)
  const checks = task.checks.map(declared => authoredCheck(fixture, directory, declared))
  const hidden = checks.some(one => one.cases !== undefined)
  return {
    id: EnvironmentId(task.id),
    kind: 'bench',
    name: task.title,
    description: `${task.domain}, tier ${task.tier}: ${task.title}`,
    task: {
      prompt: `${task.prompt} ${SHARED_RULES}${hidden ? ` ${HIDDEN_CASE_RULE}` : ''}`,
      fixture,
      immutable: task.immutable,
      ...(existsSync(join(fixture, 'reference')) ? { reference: 'reference' } : {}),
    },
    checks,
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
