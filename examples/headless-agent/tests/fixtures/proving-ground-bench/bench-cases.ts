/**
 * The case-file reading the bench's registrars share. A check in a task's
 * `task.json` may name a case file under `reference/`; its cases are the
 * bench's differential tier: the runner appends each case's `argv` to the
 * check's `run`, feeds its `stdin`, and compares the digested streams, the
 * bodies stay in the validator's reservation, and the implementer sees only
 * how many failed. The case file therefore lives beside the reference, which
 * is stripped from every workspace, and this module refuses one anywhere else.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join, posix } from 'node:path'
import { caseChannelDigest, CheckCaseId, checkCasesRef, CheckId } from '@deepseek-ai/dsh-verification'
import type { AuthoredCheck, CheckCase, CheckCaseChannel } from '@deepseek-ai/dsh-verification'

/** One check as `task.json` declares it; `cases` names a case file under `reference/`. */
export interface CheckFile {
  readonly id: string
  readonly outcome: string
  readonly run: string
  readonly cases?: string
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
function casePath(fixture: string, subject: string, relative: string): string {
  const normalized = posix.normalize(relative)
  if (normalized !== relative) reject(subject, 'is not a normalized relative path')
  if (!normalized.startsWith('reference/') || normalized.split('/').includes('..')) {
    reject(subject, 'must name a file under reference/, which no workspace receives')
  }
  const resolved = join(fixture, ...normalized.split('/'))
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

/**
 * One check, carrying its case bodies and their reference when `task.json`
 * names a case file.
 * @param fixture - the task directory the case file is resolved under.
 * @param directory - the task directory's name, which a rejection names.
 * @param declared - the check as `task.json` declares it.
 * @returns the authored check.
 * @throws when the case file lies outside `reference/`, is missing, or holds a malformed case.
 */
export function authoredCheck(fixture: string, directory: string, declared: CheckFile): AuthoredCheck {
  const base = { id: CheckId(declared.id), outcome: declared.outcome, run: declared.run }
  if (declared.cases === undefined) return base
  const subject = `${directory} check "${declared.id}" cases "${declared.cases}"`
  const path = casePath(fixture, subject, declared.cases)
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (!Array.isArray(parsed) || parsed.length === 0) reject(subject, 'is not a non-empty array of cases')
  const seen = new Set<string>()
  const bodies = (parsed as CaseFile[]).map(entry => body(subject, entry, seen))
  return { ...base, cases: checkCasesRef(bodies), caseBodies: bodies }
}
