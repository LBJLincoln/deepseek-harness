/**
 * Producer: the Proving Ground bench's environments, one per
 * `environments/<task>/task.json`. The task directory is the fixture: `src/`
 * is the pre-state the implementer receives, `test/` and `package.json` are
 * immutable, and `reference/` holds the solution a validator may run and an
 * implementer never sees. Tier and domain travel in the definition's detail so
 * a plan can select cells by them.
 *
 * A check may name a case file under `reference/`. Its cases are the bench's
 * differential tier: the runner appends each case's `argv` to the check's `run`
 * and compares the digested streams, the bodies stay in the validator's
 * reservation, and the implementer sees only how many failed. The case file
 * therefore lives beside the reference, which is stripped from every workspace.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { EnvironmentId } from '@deepseek-ai/dsh-environments'
import type { EnvironmentDefinition } from '@deepseek-ai/dsh-environments'
import { caseChannelDigest, CheckCaseId, checkCasesRef, CheckId } from '@deepseek-ai/dsh-verification'
import type { AuthoredCheck, CheckCase, CheckCaseChannel } from '@deepseek-ai/dsh-verification'

declare module '@deepseek-ai/dsh-environments/types' {
  interface EnvironmentKindMap {
    /** A bench task in one language, verified by its fixture's own test suite, with the bench's tier and domain. */
    bench: { readonly language: string; readonly tier: number; readonly domain: string }
  }
}

export const name = 'register-environments'
export const inject = ['environments']

/** One check as `task.json` declares it; `cases` names a case file under `reference/`. */
interface CheckFile {
  readonly id: string
  readonly outcome: string
  readonly run: string
  readonly cases?: string
}

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

/**
 * One case as its file authors it: the streams are written verbatim and the
 * registrar digests them, so a case file stays readable and regenerable by the
 * script beside it.
 */
interface CaseFile {
  readonly id: string
  readonly weight: number
  readonly argv: readonly string[]
  readonly stdin?: string
  readonly exitCode: number
  readonly stdout: string
  readonly stderr?: string
  readonly channels?: readonly CheckCaseChannel[]
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

/** The normalizers every bench case compares under, so a CRLF host and an LF host agree. */
const NORMALIZERS: readonly ['crlf'] = ['crlf']

/** Channels a case compares when its file names none. */
const DEFAULT_CHANNELS: readonly CheckCaseChannel[] = ['exit', 'stdout']

/** Channels a bench case may compare; `tree` needs a scope no bench check declares. */
const ALLOWED_CHANNELS: readonly CheckCaseChannel[] = ['exit', 'stdout', 'stderr']

/**
 * Command words a case may append. The runner joins them onto the check's `run`
 * verbatim, so a word that would need shell quoting is rejected here rather
 * than mis-split by whatever shell the composition provides.
 */
const UNQUOTED_COMMAND_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/

/** Reject one malformed case file at load, naming the task, the file, and the case. */
function reject(subject: string, reason: string): never {
  throw new Error(`proving-ground-bench: ${subject} ${reason}`)
}

/**
 * Whether a field of the parsed file arrived as an array. `Array.isArray` would
 * narrow its argument to `any[]`, losing the element type every use below
 * relies on, so the check is kept behind a predicate that narrows nothing.
 * @param value - the field as the file supplied it.
 * @returns whether it is an array.
 */
function isArray(value: unknown): boolean {
  return Array.isArray(value)
}

/** The case file's path inside the task directory, which must stay under `reference/`. */
function casePath(directory: string, check: CheckFile, relative: string): string {
  const subject = `${directory} check "${check.id}" cases "${relative}"`
  const normalized = posix.normalize(relative)
  if (normalized !== relative) reject(subject, 'is not a normalized relative path')
  if (!normalized.startsWith('reference/') || normalized.split('/').includes('..')) {
    reject(subject, 'must name a file under reference/, which no workspace receives')
  }
  const resolved = join(ROOT, directory, ...normalized.split('/'))
  if (!existsSync(resolved)) reject(subject, 'does not exist')
  return resolved
}

/** One case body, with its streams digested under the shared normalizers. */
function body(subject: string, entry: CaseFile, seen: Set<string>): CheckCase {
  if (typeof entry.id !== 'string' || entry.id === '') reject(subject, 'holds a case without an id')
  const named = `${subject} case "${entry.id}"`
  if (seen.has(entry.id)) reject(named, 'repeats an id')
  seen.add(entry.id)
  if (!Number.isSafeInteger(entry.weight) || entry.weight < 1) reject(named, 'has a weight that is not a positive integer')
  if (!isArray(entry.argv)) reject(named, 'has no argv array')
  for (const word of entry.argv) {
    if (typeof word !== 'string' || !UNQUOTED_COMMAND_WORD.test(word)) reject(named, `has an argv word "${word}" that needs shell quoting`)
  }
  if (!Number.isSafeInteger(entry.exitCode)) reject(named, 'has no integer exitCode')
  if (typeof entry.stdout !== 'string') reject(named, 'has no stdout string')
  if (entry.stderr !== undefined && typeof entry.stderr !== 'string') reject(named, 'has a stderr that is not a string')
  if (entry.stdin !== undefined && typeof entry.stdin !== 'string') reject(named, 'has a stdin that is not a string')
  const channels = entry.channels ?? DEFAULT_CHANNELS
  if (!isArray(channels) || channels.length === 0) reject(named, 'compares no channel')
  for (const channel of channels) {
    if (!ALLOWED_CHANNELS.includes(channel)) reject(named, `names channel "${channel}", which a bench case may not compare`)
  }
  if (channels.includes('stderr') && entry.stderr === undefined) reject(named, 'compares stderr without one')
  const digest = (text: string): string => caseChannelDigest(Buffer.from(text, 'utf8'), NORMALIZERS)
  return {
    id: CheckCaseId(entry.id),
    weight: entry.weight,
    input: { argv: [...entry.argv], ...entry.stdin === undefined ? {} : { stdin: entry.stdin } },
    expected: {
      ...channels.includes('exit') ? { exitCode: entry.exitCode } : {},
      ...channels.includes('stdout') ? { stdoutSha256: digest(entry.stdout) } : {},
      ...channels.includes('stderr') ? { stderrSha256: digest(entry.stderr as string) } : {},
    },
    comparator: { channels: [...channels], normalizers: NORMALIZERS },
  }
}

/** One check, carrying its case bodies and their reference when `task.json` names a case file. */
function check(directory: string, declared: CheckFile): AuthoredCheck {
  const base = { id: CheckId(declared.id), outcome: declared.outcome, run: declared.run }
  if (declared.cases === undefined) return base
  const path = casePath(directory, declared, declared.cases)
  const subject = `${directory} check "${declared.id}" cases "${declared.cases}"`
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (!Array.isArray(parsed) || parsed.length === 0) reject(subject, 'is not a non-empty array of cases')
  const seen = new Set<string>()
  const bodies = (parsed as CaseFile[]).map(entry => body(subject, entry, seen))
  return { ...base, cases: checkCasesRef(bodies), caseBodies: bodies }
}

/** One bench task, read from its directory. */
function definition(directory: string): EnvironmentDefinition<'bench'> {
  const fixture = join(ROOT, directory)
  const task = JSON.parse(readFileSync(join(fixture, 'task.json'), 'utf8')) as TaskFile
  if (task.id !== `code:${directory}`) throw new Error(`proving-ground-bench: ${directory}/task.json declares id ${task.id}`)
  const checks = task.checks.map(declared => check(directory, declared))
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
