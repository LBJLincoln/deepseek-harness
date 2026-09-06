/**
 * The closed comparator vocabulary of weighted cases: the normalizer functions,
 * the canonical case-body digest, and the authoring validation every cased
 * check passes before a run can depend on it.
 */

import { createHash } from 'node:crypto'
import { isKebabCase, VerificationError } from './runtime.ts'
import type {
  AuthoredCheck,
  CheckCase,
  CheckCaseChannel,
  CheckCaseNormalizer,
  CheckCasesRef,
} from './types.ts'

/** Every comparable channel, in the order a comparator and a directive list them. */
export const CHECK_CASE_CHANNELS: readonly CheckCaseChannel[] = ['exit', 'stdout', 'stderr', 'tree']

/** Every normalizer id, in declaration order. */
export const CHECK_CASE_NORMALIZERS: readonly CheckCaseNormalizer[] = [
  'crlf',
  'trailing-whitespace',
  'blank-lines',
  'iso8601-timestamps',
  'temp-paths',
  'json-canonical',
]

/** Channel whose expected value is the digest field of the same name. */
const CHANNEL_DIGEST: Readonly<Record<CheckCaseChannel, 'exitCode' | 'stdoutSha256' | 'stderrSha256' | 'treeSha256'>> = {
  exit: 'exitCode',
  stdout: 'stdoutSha256',
  stderr: 'stderrSha256',
  tree: 'treeSha256',
}

const ISO8601 = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g
const TEMP_PREFIX
  = /(?:\/private)?\/var\/folders\/[^/\s]+\/[^/\s]+\/T|(?:\/private)?\/tmp|[A-Za-z]:\\Users\\[^\\\s]+\\AppData\\Local\\Temp/g
const TRAILING_WHITESPACE = /[ \t]+$/gm
/** A path segment usable inside a normalized workspace-relative path. */
const PATH_SEGMENT = /^[^/\\]+$/
/** A Windows drive prefix, which no workspace-relative path may carry. */
const DRIVE_LETTER = /^[A-Za-z]:/

/** Sort every object key of a parsed JSON value, so canonical output is key-order free. */
function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortJson((value as Record<string, unknown>)[key])]))
}

/** Reserialize valid JSON canonically; anything else passes through unchanged. */
function jsonCanonical(text: string): string {
  try {
    return JSON.stringify(sortJson(JSON.parse(text)))
  } catch (_notJson) {
    // A normalizer is total: bytes that are not JSON are compared as they are.
    return text
  }
}

/** Drop leading and trailing blank lines and collapse each interior run to one. */
function blankLines(text: string): string {
  const lines = text.split('\n')
  while (lines[0] === '') lines.shift()
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines.filter((line, index) => line !== '' || lines[index - 1] !== '').join('\n')
}

/** The normalizer functions themselves, each idempotent over UTF-8 text. */
const NORMALIZER_FUNCTIONS: Readonly<Record<CheckCaseNormalizer, (text: string) => string>> = {
  'crlf': text => text.replaceAll('\r\n', '\n'),
  'trailing-whitespace': text => text.replace(TRAILING_WHITESPACE, ''),
  'blank-lines': blankLines,
  'iso8601-timestamps': text => text.replace(ISO8601, '<timestamp>'),
  'temp-paths': text => text.replace(TEMP_PREFIX, '<temp>'),
  'json-canonical': jsonCanonical,
}

/**
 * Apply one normalizer to UTF-8 bytes.
 * @param bytes - the channel's captured bytes.
 * @param normalizer - the normalizer to apply.
 * @returns the normalized bytes.
 */
export function applyCaseNormalizer(bytes: Buffer, normalizer: CheckCaseNormalizer): Buffer {
  return Buffer.from(NORMALIZER_FUNCTIONS[normalizer](bytes.toString('utf8')), 'utf8')
}

/**
 * Apply a comparator's normalizers to one channel's bytes, in order.
 * @param bytes - the channel's captured bytes.
 * @param normalizers - the comparator's normalizer ids.
 * @returns the normalized bytes.
 */
export function normalizeCaseBytes(bytes: Buffer, normalizers: readonly CheckCaseNormalizer[]): Buffer {
  return normalizers.reduce((current, normalizer) => applyCaseNormalizer(current, normalizer), bytes)
}

/**
 * SHA-256 hex of one channel's bytes after its comparator's normalizers.
 * @param bytes - the channel's captured bytes.
 * @param normalizers - the comparator's normalizer ids.
 * @returns the lowercase hex digest.
 */
export function caseChannelDigest(bytes: Buffer, normalizers: readonly CheckCaseNormalizer[]): string {
  return createHash('sha256').update(normalizeCaseBytes(bytes, normalizers)).digest('hex')
}

/** Field-ordered tuple of one case, so the digest does not depend on object key order. */
function caseTuple(body: CheckCase): unknown[] {
  const files = body.input.files
  return [
    body.id,
    body.weight,
    [
      [...body.input.argv],
      body.input.stdin ?? null,
      files === undefined ? null : Object.keys(files).sort().map(path => [path, files[path]]),
    ],
    [
      body.expected.exitCode ?? null,
      body.expected.stdoutSha256 ?? null,
      body.expected.stderrSha256 ?? null,
      body.expected.treeSha256 ?? null,
    ],
    [[...body.comparator.channels], [...body.comparator.normalizers]],
  ]
}

/**
 * Canonical SHA-256 hex of one check's case bodies, which
 * {@link CheckCasesRef.sha256} must equal.
 * @param bodies - the check's cases in authored order.
 * @returns the lowercase hex digest.
 */
export function caseBodiesSha256(bodies: readonly CheckCase[]): string {
  return createHash('sha256').update(JSON.stringify(bodies.map(caseTuple))).digest('hex')
}

/**
 * The durable reference one case-body list requires.
 * @param bodies - the check's cases in authored order.
 * @returns the count, the summed weight, and the canonical digest.
 */
export function checkCasesRef(bodies: readonly CheckCase[]): CheckCasesRef {
  return {
    count: bodies.length,
    weightTotal: bodies.reduce((sum, body) => sum + body.weight, 0),
    sha256: caseBodiesSha256(bodies),
  }
}

/** Reject one authoring problem with the case error code. */
function reject(subject: string, reason: string): never {
  throw new VerificationError(`${subject} ${reason}`, 'VERIFICATION_INVALID_CASE')
}

/** Require one normalized workspace-relative path the runner can resolve under the workspace. */
function requireRelativePath(path: string, subject: string): void {
  if (path === '') reject(subject, 'is empty')
  if (path.startsWith('/') || DRIVE_LETTER.test(path)) reject(subject, `"${path}" is not workspace-relative`)
  if (path.includes('\\')) reject(subject, `"${path}" uses a backslash; workspace-relative paths separate segments with "/"`)
  for (const segment of path.split('/')) {
    if (!PATH_SEGMENT.test(segment) || segment === '.' || segment === '..') {
      reject(subject, `"${path}" is not normalized: it holds a "${segment}" segment`)
    }
  }
}

/**
 * Characters an appended command word may contain. A case's `argv` words are
 * appended to the check's run instruction verbatim, so a word must need no
 * shell quoting: quoting is dialect-specific and the composed shell's dialect
 * is not known where the standard is authored.
 */
const UNQUOTED_COMMAND_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/

/** Validate one case body against the closed comparator vocabulary. */
function assertCase(body: CheckCase, subject: string, seen: Set<string>): void {
  if (!isKebabCase(body.id)) reject(subject, `id "${body.id}" must be lower-kebab-case`)
  if (seen.has(body.id)) reject(subject, `repeats case id "${body.id}"`)
  seen.add(body.id)
  if (!Number.isSafeInteger(body.weight) || body.weight < 1) {
    reject(subject, `weight of case "${body.id}" must be a positive safe integer`)
  }
  for (const word of body.input.argv) {
    if (!UNQUOTED_COMMAND_WORD.test(word)) {
      reject(subject, `case "${body.id}" argv word "${word}" needs shell quoting`)
    }
  }
  for (const path of Object.keys(body.input.files ?? {})) {
    requireRelativePath(path, `${subject} case "${body.id}" staged file`)
  }
  const channels = body.comparator.channels
  if (channels.length === 0) reject(subject, `case "${body.id}" compares no channel`)
  const declared = new Set<string>()
  for (const channel of channels) {
    if (!CHECK_CASE_CHANNELS.includes(channel)) reject(subject, `case "${body.id}" names unknown channel "${channel}"`)
    if (declared.has(channel)) reject(subject, `case "${body.id}" repeats channel "${channel}"`)
    declared.add(channel)
    if (body.expected[CHANNEL_DIGEST[channel]] === undefined) {
      reject(subject, `case "${body.id}" compares "${channel}" without an expected value`)
    }
  }
  for (const normalizer of body.comparator.normalizers) {
    if (!CHECK_CASE_NORMALIZERS.includes(normalizer)) {
      reject(subject, `case "${body.id}" names unknown normalizer "${normalizer}"`)
    }
  }
}

/**
 * Validate one authored check's cases before any run depends on them: the
 * reference must match the bodies handed in, every case must name known
 * channels and normalizers with an expected value per channel, weights must be
 * positive, ids unique, and `treeScope` present exactly when a case compares
 * the work tree.
 * @param check - the check as its author handed it in.
 * @returns the case bodies, or `undefined` for a check without cases.
 * @throws {@link VerificationError} with `VERIFICATION_INVALID_CASE` for any of those.
 */
export function resolveAuthoredCases(check: AuthoredCheck): readonly CheckCase[] | undefined {
  const subject = `check "${check.id}"`
  const { cases, caseBodies } = check
  if (cases === undefined) {
    if (caseBodies !== undefined) reject(subject, 'carries case bodies without a cases reference')
    if (check.treeScope !== undefined) reject(subject, 'declares a treeScope without cases')
    return undefined
  }
  if (caseBodies === undefined) reject(subject, 'references cases without handing in their bodies')
  if (caseBodies.length === 0) reject(subject, 'references cases but hands in none')
  const seen = new Set<string>()
  for (const body of caseBodies) assertCase(body, subject, seen)
  const derived = checkCasesRef(caseBodies)
  if (cases.count !== derived.count || cases.weightTotal !== derived.weightTotal || cases.sha256 !== derived.sha256) {
    reject(subject, `cases reference does not describe the bodies handed in: expected count ${derived.count}, weightTotal ${derived.weightTotal}, sha256 ${derived.sha256}`)
  }
  const comparesTree = caseBodies.some(body => body.comparator.channels.includes('tree'))
  if (comparesTree && check.treeScope === undefined) reject(subject, 'compares the work tree without a treeScope')
  if (!comparesTree && check.treeScope !== undefined) reject(subject, 'declares a treeScope no case compares')
  if (check.treeScope !== undefined) requireRelativePath(check.treeScope, `${subject} treeScope`)
  return caseBodies
}
