/**
 * Loader and validator for the enterprise ticket queue under
 * `data/enterprise/tickets/`. A ticket is one JSON file carrying exactly the
 * fields `data/enterprise/tickets/README.md` lists; it is real only when its
 * seat exists in the roster, its source path exists in the tree and contains
 * its anchor text, and it names a non-empty scope and acceptance.
 * `scripts/enterprise-tickets.spec.ts` runs the check over the committed queue.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, isAbsolute, resolve } from 'node:path'

import type { Roster } from './enterprise-roster.ts'

/** Queue directory, relative to the repository root. */
export const TICKETS_DIR = 'data/enterprise/tickets'

const TICKET_KEYS = ['id', 'title', 'division', 'seat', 'kind', 'source', 'task', 'scope', 'acceptance', 'budget', 'priority']
const SOURCE_KEYS = ['path', 'anchor']
const CHECK_KEYS = ['id', 'run']
const BUDGET_KEYS = ['maxTotalTokens', 'maxWallMs']
const KINDS = new Set(['fix', 'test', 'docs', 'feature', 'chore'])
const ID_PATTERN = /^T-\d{4}$/
const CHECK_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/
/** The task text cites its evidence at least once as `path:line`. */
const EVIDENCE_PATTERN = /[\w./-]+\.(?:ts|tsx|md|json|ya?ml|mjs):\d+/
const TYPECHECK_RUN = 'pnpm run typecheck'
const COVERAGE_FLAG = '--coverage'
const LOWEST_PRIORITY = 3

/** One queue file as read from disk, before validation. */
export interface LoadedTicket {
  /** Path relative to the repository root. */
  readonly file: string
  /** Parsed JSON, or the parse failure when the file is not JSON. */
  readonly value: unknown
}

/**
 * Read every `T-*.json` under the queue directory in name order.
 * @param root - repository root.
 * @returns the parsed files; a file that is not valid JSON carries its Error as `value`.
 */
export function loadTickets(root: string): LoadedTicket[] {
  const dir = resolve(root, TICKETS_DIR)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(name => /^T-\d{4}\.json$/.test(name))
    .sort()
    .map((name) => {
      const file = `${TICKETS_DIR}/${name}`
      try {
        return { file, value: JSON.parse(readFileSync(resolve(root, file), 'utf8')) as unknown }
      } catch (error: unknown) {
        return { file, value: error instanceof Error ? error : new Error(String(error)) }
      }
    })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** A repository-relative path: not absolute, no parent traversal, no leading `./`. */
function isRelativePath(value: string): boolean {
  return !isAbsolute(value) && !value.startsWith('./') && !value.split('/').includes('..')
}

function keyErrors(record: Record<string, unknown>, expected: readonly string[], what: string): string[] {
  const errors: string[] = []
  for (const key of expected) if (!(key in record)) errors.push(`${what} is missing "${key}"`)
  for (const key of Object.keys(record)) if (!expected.includes(key)) errors.push(`${what} carries an unknown field "${key}"`)
  return errors
}

function validateSource(source: unknown, root: string): string[] {
  if (!isRecord(source)) return ['source must be an object']
  const errors = keyErrors(source, SOURCE_KEYS, 'source')
  if (errors.length > 0) return errors
  const { path, anchor } = source
  if (!isNonEmptyString(path) || !isRelativePath(path)) return ['source.path must be a repository-relative path']
  const absolute = resolve(root, path)
  if (!existsSync(absolute) || !statSync(absolute).isFile()) return [`source.path "${path}" does not exist in the tree`]
  if (!isNonEmptyString(anchor)) return ['source.anchor must be a non-empty string']
  if (!readFileSync(absolute, 'utf8').includes(anchor)) return [`source.anchor ${JSON.stringify(anchor)} does not occur in "${path}"`]
  return []
}

function validateScope(scope: unknown, root: string): string[] {
  if (!Array.isArray(scope) || scope.length === 0) return ['scope must be a non-empty array']
  const errors: string[] = []
  const seen = new Set<string>()
  for (const entry of scope) {
    if (!isNonEmptyString(entry) || !isRelativePath(entry)) {
      errors.push(`scope entry ${JSON.stringify(entry)} must be a repository-relative path`)
      continue
    }
    if (seen.has(entry)) errors.push(`scope repeats "${entry}"`)
    seen.add(entry)
    if (!existsSync(resolve(root, entry))) errors.push(`scope prefix "${entry}" does not exist in the tree`)
  }
  return errors
}

function validateAcceptance(acceptance: unknown): string[] {
  if (!Array.isArray(acceptance) || acceptance.length === 0) return ['acceptance must be a non-empty array']
  const errors: string[] = []
  const ids = new Set<string>()
  const runs: string[] = []
  acceptance.forEach((check: unknown, index) => {
    if (!isRecord(check)) {
      errors.push(`acceptance[${index}] must be an object`)
      return
    }
    errors.push(...keyErrors(check, CHECK_KEYS, `acceptance[${index}]`))
    const { id, run } = check
    if (typeof id !== 'string' || !CHECK_ID_PATTERN.test(id)) errors.push(`acceptance[${index}].id must be a lower-case slug`)
    else if (ids.has(id)) errors.push(`acceptance repeats the check id "${id}"`)
    else ids.add(id)
    if (!isNonEmptyString(run) || run.includes('\n')) errors.push(`acceptance[${index}].run must be one non-empty command line`)
    else runs.push(run)
  })
  if (!runs.includes(TYPECHECK_RUN)) errors.push(`acceptance must include "${TYPECHECK_RUN}"`)
  if (!runs.some(run => run.includes(COVERAGE_FLAG))) errors.push("acceptance must include the package's per-file coverage run")
  return errors
}

function validateBudget(budget: unknown): string[] {
  if (!isRecord(budget)) return ['budget must be an object']
  const errors = keyErrors(budget, BUDGET_KEYS, 'budget')
  for (const key of BUDGET_KEYS) {
    const value = budget[key]
    if (!Number.isSafeInteger(value) || (value as number) <= 0) errors.push(`budget.${key} must be a positive integer`)
  }
  return errors
}

function validateTicket(loaded: LoadedTicket, roster: Roster, root: string): string[] {
  const { file, value } = loaded
  if (value instanceof Error) return [`not valid JSON: ${value.message}`]
  if (!isRecord(value)) return ['a ticket must be a JSON object']
  const errors = keyErrors(value, TICKET_KEYS, 'ticket')
  const { id, title, division, seat, kind, source, task, scope, acceptance, budget, priority } = value
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) errors.push('id must match T-NNNN')
  else if (id !== basename(file, '.json')) errors.push(`id "${id}" does not match the file name`)
  if (!isNonEmptyString(title)) errors.push('title must be a non-empty string')
  const knownDivision = typeof division === 'string' && roster.divisions.some(entry => entry.id === division)
  if (!knownDivision) errors.push(`division ${JSON.stringify(division)} is not in the roster`)
  const agent = typeof seat === 'string' ? roster.agents.find(entry => entry.id === seat) : undefined
  if (agent === undefined) errors.push(`seat ${JSON.stringify(seat)} is not in the roster`)
  else if (agent.division !== division) errors.push(`seat "${agent.id}" belongs to division "${agent.division}", not ${JSON.stringify(division)}`)
  if (typeof kind !== 'string' || !KINDS.has(kind)) errors.push(`kind ${JSON.stringify(kind)} is not one of ${[...KINDS].join('|')}`)
  errors.push(...validateSource(source, root))
  if (!isNonEmptyString(task)) errors.push('task must be a non-empty string')
  else if (!EVIDENCE_PATTERN.test(task)) errors.push('task must cite its evidence as path:line at least once')
  errors.push(...validateScope(scope, root))
  errors.push(...validateAcceptance(acceptance))
  errors.push(...validateBudget(budget))
  if (!Number.isInteger(priority) || (priority as number) < 1 || (priority as number) > LOWEST_PRIORITY) {
    errors.push(`priority must be an integer from 1 to ${LOWEST_PRIORITY}`)
  }
  return errors
}

/**
 * Validate the loaded queue against the roster and the tree.
 * @param loaded - the queue files.
 * @param roster - the committed roster, for divisions and seats.
 * @param root - repository root, for source and scope existence checks.
 * @returns every violation as `<file>: <message>`; empty when the queue is valid.
 */
export function validateTickets(loaded: readonly LoadedTicket[], roster: Roster, root: string): string[] {
  const errors: string[] = []
  const ids: string[] = []
  for (const ticket of loaded) {
    for (const message of validateTicket(ticket, roster, root)) errors.push(`${ticket.file}: ${message}`)
    if (isRecord(ticket.value) && typeof ticket.value['id'] === 'string') ids.push(ticket.value['id'])
  }
  const sorted = [...ids].sort()
  sorted.forEach((id, index) => {
    const expected = `T-${String(index + 1).padStart(4, '0')}`
    if (id !== expected && !errors.some(error => error.includes('numbered without gaps'))) {
      errors.push(`${TICKETS_DIR}: ids must be numbered without gaps from T-0001; found "${id}" where "${expected}" was expected`)
    }
  })
  return errors
}
