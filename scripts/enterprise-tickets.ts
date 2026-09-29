/**
 * Loader and validator for the enterprise ticket queue under
 * `data/enterprise/tickets/`. A ticket is one JSON file carrying exactly the
 * fields `data/enterprise/tickets/README.md` lists; it is real only when its
 * seat exists in the roster, its source path exists in the tree and contains
 * its anchor text, and it names a non-empty scope and acceptance. Priority `0`
 * is reserved for a ticket answering one of the owner's requests under
 * {@link REQUESTS_DIR}, which the shift's queue order then takes before every
 * untried ticket. `scripts/enterprise-tickets.spec.ts` runs the check over the
 * committed queue.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, isAbsolute, resolve } from 'node:path'

import { HARNESS_ACCEPTANCE_FORMS, OPEN_ACCEPTANCE_FORMS } from './enterprise-acceptance.ts'
import type { AcceptanceForms } from './enterprise-acceptance.ts'
import { LEDGER_PATH, readLedger } from './enterprise-ledger.ts'
import type { Roster } from './enterprise-roster.ts'

/** Queue directory, relative to the repository root. */
export const TICKETS_DIR = 'data/enterprise/tickets'

/** Directory of the owner's requests, relative to the repository root. */
export const REQUESTS_DIR = 'data/enterprise/requests'

/** The directory's own documentation, which is not a request. */
const REQUESTS_README = /^readme(?:\.zh)?\.md$/i

/**
 * Whether a repository path is one of the owner's requests: a Markdown file
 * directly under {@link REQUESTS_DIR} other than that directory's README pair.
 * @param path - a repository-relative path.
 * @returns true for a request file.
 */
export function isRequestFile(path: string): boolean {
  if (!path.startsWith(`${REQUESTS_DIR}/`)) return false
  const name = path.slice(REQUESTS_DIR.length + 1)
  return !name.includes('/') && name.toLowerCase().endsWith('.md') && !REQUESTS_README.test(name)
}

const TICKET_KEYS = ['id', 'title', 'division', 'seat', 'kind', 'source', 'task', 'scope', 'acceptance', 'budget', 'priority']
const SOURCE_KEYS = ['path', 'anchor']
const CHECK_KEYS = ['id', 'run']
const BUDGET_KEYS = ['maxTotalTokens', 'maxWallMs']
const KINDS = new Set(['fix', 'test', 'docs', 'feature', 'chore'])
const ID_PATTERN = /^T-\d{4}$/
const CHECK_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/
/** The task text cites its evidence at least once as `path:line`. */
const EVIDENCE_PATTERN = /[\w./-]+\.(?:ts|tsx|md|json|ya?ml|mjs):\d+/
const LOWEST_PRIORITY = 3
/** The priority of a ticket answering a request, before every other priority. */
export const REQUEST_PRIORITY = 0

/**
 * The acceptance commands one queue requires of every ticket, beside the
 * ticket's own. The schema, the seat, the source, the scope, and the check
 * format hold for every repository the shift engine runs over; which commands
 * a queue mandates is that queue's policy.
 */
export interface QueuePolicy {
  /** Command lines every ticket's acceptance must include verbatim. */
  readonly requiredRuns: readonly string[]
  /** Fragments at least one acceptance command must contain, each with the rule it stands for. */
  readonly requiredFragments: readonly { readonly fragment: string; readonly rule: string }[]
  /**
   * Command line the shift engine runs at the worktree root over every change
   * that touches a Markdown document, whatever the ticket's own acceptance
   * says; absent for a queue whose repository has no documentation gate.
   */
  readonly documentationRun?: string
  /**
   * Command line the shift engine runs at the worktree root with every
   * `.ts`, `.tsx` and `.mjs` file the change adds or modifies appended as
   * arguments, whatever the ticket's own acceptance says; absent for a queue
   * whose repository has no linter.
   */
  readonly lintRun?: string
  /**
   * Fragments that mark an acceptance command as a heavy run — a whole-workspace
   * typecheck, a coverage run, the documentation gates — which the shift engine
   * serializes with every other heavy run on the machine when it runs under a
   * heavy lock.
   */
  readonly heavyFragments: readonly string[]
  /**
   * Git pathspecs of the files the repository's generators write and its
   * documentation gates verify against the source — generated catalogs and
   * graphs, the pages carrying generated regions or `type-equiv` pastes, and
   * their translation pair records. Every ticket's scope includes them: a
   * change that makes one stale must regenerate it, whichever package it is in.
   */
  readonly generatedPaths: readonly string[]
  /**
   * The forms every acceptance command must take
   * ([`enterprise-acceptance.ts`](enterprise-acceptance.ts)): admission
   * refuses a proposal carrying another, and the shift engine refuses to work
   * a queued ticket carrying another.
   */
  readonly acceptanceForms: AcceptanceForms
}

/** The commands this repository's heavy runs contain: the typecheck, a coverage run, and the documentation gates. */
const HEAVY_FRAGMENTS = ['pnpm run typecheck', '--coverage', 'pnpm run doc-sync']

/**
 * This repository's queue: every ticket runs the typecheck and the package's
 * per-file coverage, a change to any Markdown document passes the bilingual
 * pairing gate, which a department editing a README pair without re-recording
 * it would otherwise ship past the ticket's acceptance, and every changed
 * TypeScript or ES module file passes the repository's oxlint, which neither a
 * ticket's acceptance nor the reviewer ran before `T-0007` shipped three lint
 * errors. The
 * generated paths are the outputs of the `gen-*` scripts `pnpm run doc-sync`
 * checks, with their Chinese sides and pair records, and the subsystem pages
 * whose `type-equiv` pastes `verify-type-equiv` compares with the source.
 */
export const HARNESS_QUEUE_POLICY: QueuePolicy = {
  requiredRuns: ['pnpm run typecheck'],
  requiredFragments: [{ fragment: '--coverage', rule: "the package's per-file coverage run" }],
  documentationRun: 'pnpm run verify-translation-pairing',
  lintRun: 'node_modules/.bin/tsx scripts/run-oxlint.ts',
  heavyFragments: HEAVY_FRAGMENTS,
  generatedPaths: [
    'docs/subsystems/',
    'docs/cordis-api/',
    'docs/graph-atlas.*',
    'docs/capability-seams.*',
    'docs/event-producer-consumer.*',
    'docs/agent-lifecycle.*',
    'docs/tool-execution-pipeline.*',
    'docs/tool-catalog.*',
    'docs/config-catalog.*',
    'docs/persistence-catalog.*',
    'docs/module-graph.*',
    'apps/cli/composition.*',
    'examples/headless-agent/composition.*',
    'examples/acp-agent/composition.*',
    'packages/extensions/tool-cordis/src/api-catalog.ts',
    'packages/extensions/cordis-client-runner/src/client/api-catalog.ts',
    'packages/extensions/cordis-client-runner/src/client/slot-catalog.ts',
    'packages/core/session/src/known-event-types.ts',
    'packages/core/scope/src/scoped-events.generated.ts',
  ],
  acceptanceForms: HARNESS_ACCEPTANCE_FORMS,
}

/**
 * A queue that mandates nothing beyond the ticket's own checks and owns no
 * generated file, for a repository without this one's gates. Its heavy runs
 * are marked by the same fragments, which name what a command does rather than
 * what a queue requires; its acceptance commands run a repository file with
 * `node` or `sh` where this repository's name a root script.
 */
export const OPEN_QUEUE_POLICY: QueuePolicy = {
  requiredRuns: [],
  requiredFragments: [],
  heavyFragments: HEAVY_FRAGMENTS,
  generatedPaths: [],
  acceptanceForms: OPEN_ACCEPTANCE_FORMS,
}

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

/**
 * @param root - repository root holding the ledger.
 * @returns the tickets a ledger line records as shipped.
 */
function shippedTickets(root: string): Set<string> {
  return new Set(readLedger(resolve(root, LEDGER_PATH)).lines.flatMap(line => (line.type === 'ticket' && line.shipped !== null ? [line.ticket] : [])))
}

/**
 * @param source - the ticket's `source`.
 * @param root - repository root.
 * @param shipped - whether the ledger records the ticket as shipped: its own change may have rewritten the text its anchor
 * quotes, so a shipped ticket's anchor need no longer occur in the tree.
 * @returns the violations.
 */
function validateSource(source: unknown, root: string, shipped: boolean): string[] {
  if (!isRecord(source)) return ['source must be an object']
  const errors = keyErrors(source, SOURCE_KEYS, 'source')
  if (errors.length > 0) return errors
  const { path, anchor } = source
  if (!isNonEmptyString(path) || !isRelativePath(path)) return ['source.path must be a repository-relative path']
  const absolute = resolve(root, path)
  if (!existsSync(absolute) || !statSync(absolute).isFile()) return [`source.path "${path}" does not exist in the tree`]
  if (!isNonEmptyString(anchor)) return ['source.anchor must be a non-empty string']
  if (!shipped && !readFileSync(absolute, 'utf8').includes(anchor)) return [`source.anchor ${JSON.stringify(anchor)} does not occur in "${path}"`]
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

function validateAcceptance(acceptance: unknown, policy: QueuePolicy): string[] {
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
  for (const required of policy.requiredRuns) {
    if (!runs.includes(required)) errors.push(`acceptance must include "${required}"`)
  }
  for (const { fragment, rule } of policy.requiredFragments) {
    if (!runs.some(run => run.includes(fragment))) errors.push(`acceptance must include ${rule}`)
  }
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

function validateTicket(loaded: LoadedTicket, roster: Roster, root: string, policy: QueuePolicy, shipped: ReadonlySet<string>): string[] {
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
  errors.push(...validateSource(source, root, typeof id === 'string' && shipped.has(id)))
  if (!isNonEmptyString(task)) errors.push('task must be a non-empty string')
  else if (!EVIDENCE_PATTERN.test(task)) errors.push('task must cite its evidence as path:line at least once')
  errors.push(...validateScope(scope, root))
  errors.push(...validateAcceptance(acceptance, policy))
  errors.push(...validateBudget(budget))
  errors.push(...validatePriority(priority, source))
  return errors
}

function validatePriority(priority: unknown, source: unknown): string[] {
  if (!Number.isInteger(priority) || (priority as number) < REQUEST_PRIORITY || (priority as number) > LOWEST_PRIORITY) {
    return [`priority must be an integer from 1 to ${LOWEST_PRIORITY}, or ${REQUEST_PRIORITY} for a ticket answering a request`]
  }
  const answersRequest = isRecord(source) && typeof source['path'] === 'string' && isRequestFile(source['path'])
  if (priority === REQUEST_PRIORITY && !answersRequest) {
    return [`priority ${REQUEST_PRIORITY} is reserved for a ticket whose source.path is a request under ${REQUESTS_DIR}/`]
  }
  return []
}

/**
 * Validate the loaded queue against the roster and the tree.
 * @param loaded - the queue files.
 * @param roster - the committed roster, for divisions and seats.
 * @param root - repository root, for source and scope existence checks; a ticket its ledger records as shipped is not
 * held to its source anchor, which its own change may have rewritten.
 * @param policy - the acceptance commands this queue mandates; this repository's by default.
 * @returns every violation as `<file>: <message>`; empty when the queue is valid.
 */
export function validateTickets(
  loaded: readonly LoadedTicket[],
  roster: Roster,
  root: string,
  policy: QueuePolicy = HARNESS_QUEUE_POLICY,
): string[] {
  const errors: string[] = []
  const ids: string[] = []
  const shipped = shippedTickets(root)
  for (const ticket of loaded) {
    for (const message of validateTicket(ticket, roster, root, policy, shipped)) errors.push(`${ticket.file}: ${message}`)
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
