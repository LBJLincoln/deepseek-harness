/**
 * The owner's requests and what became of each.
 *
 * The owner asks the enterprise for work by committing
 * `data/enterprise/requests/<name>.md`: a first line `# <title>` and free text.
 * A ticket answers a request when its `source.path` is the request's file. The
 * coordinators' intake (`scripts/enterprise-intake.ts`) turns requests no
 * ticket answers into tickets and names every request it took up in its
 * record's `requests`.
 *
 *   pnpm run enterprise:requests -- [--json] [--root <dir>]
 *
 * prints every request's file, title and state, derived only from committed
 * files: the queue, the ledger's ticket lines and the intake records.
 *
 * - `queued`, `halted`, `shipped`, `rejected`: a ticket answers the request,
 *   and this is that ticket's status by the engine's rule: no ticket line yet;
 *   a latest line that neither shipped nor was rejected; a latest line naming a
 *   shipped commit; a latest line whose review verdict is `reject`.
 * - `refused`: no ticket answers it, and the latest intake record naming it
 *   refused it, with the reason.
 * - `waiting`: no ticket answers it, and no intake record refused it last:
 *   none names it yet, or the latest one naming it did not reach it.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { INTAKE_DIR } from './enterprise-intake-admission.ts'
import { LEDGER_PATH, readLedger, ticketStatus } from './enterprise-ledger.ts'
import type { TicketLine } from './enterprise-ledger.ts'
import { isRequestFile, loadTickets, REQUESTS_DIR } from './enterprise-tickets.ts'

/** One request file as read from the tree. */
export interface Request {
  /** Repository-relative path of the file. */
  readonly path: string
  /** What the title line names; `null` when the first non-blank line is not `# <title>`. */
  readonly title: string | null
  /** The title line with trailing whitespace removed, which the answering ticket's `source.anchor` carries; `null` with the title. */
  readonly anchor: string | null
  /** The whole file. */
  readonly text: string
}

const UNTITLED = { title: null, anchor: null } as const

/**
 * The title of a request: its first non-blank line, when that line is `#`,
 * whitespace and a title.
 * @param text - the request file.
 * @returns the title and the line itself as the anchor, or both `null`.
 */
export function requestTitle(text: string): { readonly title: string | null; readonly anchor: string | null } {
  const first = text.replace(/^﻿/, '').split('\n').map(line => line.trimEnd()).find(line => line !== '')
  if (first === undefined) return UNTITLED
  const title = /^#[ \t]+(\S.*)$/.exec(first)?.[1]
  return title === undefined ? UNTITLED : { title, anchor: first }
}

/**
 * Every request of one repository, in file-name order.
 * @param root - the repository root.
 * @returns the requests; an absent directory holds none.
 */
export function readRequests(root: string): Request[] {
  const dir = resolve(root, REQUESTS_DIR)
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && isRequestFile(`${REQUESTS_DIR}/${entry.name}`))
    .map(entry => entry.name)
    .sort()
    .map((name) => {
      const path = `${REQUESTS_DIR}/${name}`
      const text = readFileSync(resolve(root, path), 'utf8')
      return { path, ...requestTitle(text), text }
    })
}

/** What a ticket must carry for the answered check: its id and source path. */
export interface TicketSource {
  readonly id: string
  readonly source: { readonly path: string }
}

/**
 * The tickets answering one request: those whose `source.path` is its file.
 * @param request - the request.
 * @param tickets - the queue, in id order.
 * @returns the answering tickets, in id order.
 */
export function answeringTickets<T extends TicketSource>(request: Request, tickets: readonly T[]): T[] {
  return tickets.filter(ticket => ticket.source.path === request.path)
}

/**
 * The requests no ticket answers yet.
 * @param requests - the requests, in file-name order.
 * @param tickets - the queue.
 * @returns the unanswered requests, in the same order.
 */
export function unansweredRequests(requests: readonly Request[], tickets: readonly TicketSource[]): Request[] {
  return requests.filter(request => answeringTickets(request, tickets).length === 0)
}

/**
 * One request as an intake record's `requests` names it, with the fields the
 * status reads: the intake admitted a ticket answering it, refused it for the
 * reason stated, or never reached it because the route stopped first.
 */
export type IntakeRequestEntry =
  | { readonly path: string; readonly result: 'refused'; readonly reason: string }
  | { readonly path: string; readonly result: 'admitted' | 'not-reached' }

/** The requests one intake record names. */
export interface IntakeRecordRequests {
  /** The record's directory, relative to the repository root. */
  readonly record: string
  /** When the intake started, as an ISO instant. */
  readonly at: string
  readonly requests: readonly IntakeRequestEntry[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requestEntry(value: unknown): IntakeRequestEntry | undefined {
  if (!isRecord(value)) return undefined
  const { path, result, reason } = value
  if (typeof path !== 'string') return undefined
  if (result === 'refused') return typeof reason === 'string' ? { path, result, reason } : undefined
  return result === 'admitted' || result === 'not-reached' ? { path, result } : undefined
}

/**
 * The requests every intake record names, oldest record first. A record whose
 * `result.json` is missing, is not JSON, or carries no `at` is passed over, and
 * so is an entry lacking a path, a known result, or a refusal's reason: the
 * records are written by the intake, and one damaged record must not hide the
 * others.
 * @param root - the repository root.
 * @returns one entry per readable record, ordered by `at`, then by directory.
 */
export function readIntakeRequests(root: string): IntakeRecordRequests[] {
  const dir = resolve(root, INTAKE_DIR)
  if (!existsSync(dir)) return []
  const records: IntakeRecordRequests[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name, 'result.json')
    if (!entry.isDirectory() || !existsSync(file)) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      // A torn record names no request; the other records still count.
      continue
    }
    if (!isRecord(parsed) || typeof parsed['at'] !== 'string') continue
    const requests = Array.isArray(parsed['requests']) ? parsed['requests'] : []
    records.push({
      record: `${INTAKE_DIR}/${entry.name}`,
      at: parsed['at'],
      requests: requests.flatMap((value: unknown) => requestEntry(value) ?? []),
    })
  }
  return records.sort((left, right) => {
    if (left.at !== right.at) return left.at < right.at ? -1 : 1
    return left.record < right.record ? -1 : 1
  })
}

/** The state of one request. */
export type RequestState = 'waiting' | 'refused' | 'queued' | 'halted' | 'shipped' | 'rejected'

/** One request's status, as `pnpm run enterprise:requests` prints it. */
export interface RequestStatus {
  readonly file: string
  readonly title: string | null
  readonly state: RequestState
  /** The ticket answering the request; the newest one when several do. */
  readonly ticket?: string
  /** The commit the ticket shipped as, for `shipped`. */
  readonly commit?: string
  /** Why the intake refused the request, for `refused`; the ticket line's reason, for `halted` and `rejected`. */
  readonly reason?: string
  /** The intake record that refused the request, for `refused`. */
  readonly intake?: string
}

/**
 * Derive every request's state.
 * @param requests - the requests, in file-name order.
 * @param tickets - the queue, in id order.
 * @param lines - the ledger's ticket lines, in file order.
 * @param records - the intake records' requests, oldest first.
 * @returns one status per request, in the same order.
 */
export function requestStatuses(
  requests: readonly Request[],
  tickets: readonly TicketSource[],
  lines: readonly TicketLine[],
  records: readonly IntakeRecordRequests[],
): RequestStatus[] {
  const latestLine = new Map<string, TicketLine>()
  for (const line of lines) latestLine.set(line.ticket, line)
  const latestEntry = new Map<string, { readonly entry: IntakeRequestEntry; readonly record: string }>()
  for (const { record, requests: entries } of records) {
    for (const entry of entries) latestEntry.set(entry.path, { entry, record })
  }
  return requests.map((request): RequestStatus => {
    const named = { file: request.path, title: request.title }
    const ticket = answeringTickets(request, tickets).at(-1)?.id
    if (ticket !== undefined) {
      const line = latestLine.get(ticket)
      if (line === undefined) return { ...named, state: 'queued', ticket }
      if (line.shipped !== null) return { ...named, state: 'shipped', ticket, commit: line.shipped.commit }
      const reason = line.reason === undefined ? {} : { reason: line.reason }
      return { ...named, state: ticketStatus(line) === 'rejected' ? 'rejected' : 'halted', ticket, ...reason }
    }
    const latest = latestEntry.get(request.path)
    if (latest === undefined || latest.entry.result !== 'refused') return { ...named, state: 'waiting' }
    return { ...named, state: 'refused', reason: latest.entry.reason, intake: latest.record }
  })
}

/**
 * Every request's status in one repository, read from its committed files.
 * @param root - the repository root.
 * @returns one status per request, in file-name order.
 */
export function readRequestStatuses(root: string): RequestStatus[] {
  const tickets = loadTickets(root).flatMap(({ value }): TicketSource[] => {
    if (!isRecord(value) || typeof value['id'] !== 'string' || !isRecord(value['source'])) return []
    const path = value['source']['path']
    return typeof path === 'string' ? [{ id: value['id'], source: { path } }] : []
  })
  const lines = readLedger(resolve(root, LEDGER_PATH)).lines.filter((line): line is TicketLine => line.type === 'ticket')
  return requestStatuses(readRequests(root), tickets, lines, readIntakeRequests(root))
}

/**
 * One status as a line of text: the state, the file, the title, and what the
 * state rests on.
 * @param status - the status.
 * @returns the line, without a newline.
 */
export function formatStatus(status: RequestStatus): string {
  const title = status.title === null ? '(no title line)' : JSON.stringify(status.title)
  const because = status.reason === undefined ? '' : `: ${status.reason}`
  return [status.state.padEnd(8), status.file, title, statusDetail(status, because)].filter(part => part !== '').join('  ')
}

function statusDetail(status: RequestStatus, because: string): string {
  switch (status.state) {
    case 'waiting':
      return ''
    case 'refused':
      return `${status.intake ?? ''}${because}`
    case 'shipped':
      return `${status.ticket ?? ''} in commit ${status.commit ?? ''}`
    case 'queued':
    case 'halted':
    case 'rejected':
      return `${status.ticket ?? ''}${because}`
    default:
      throw new TypeError(`unhandled request state ${JSON.stringify(status.state satisfies never)}`)
  }
}

/** One parsed invocation of `pnpm run enterprise:requests`. */
export type RequestsCommand =
  | { readonly kind: 'help' }
  | { readonly kind: 'status'; readonly json: boolean; readonly root: string }

/** The command's usage text. */
export const REQUESTS_USAGE = `Usage: pnpm run enterprise:requests -- [--json] [--root <dir>]

  --json        print the statuses as one JSON array
  --root <dir>  the repository whose requests are read (default: this repository)
`

/**
 * Parse `pnpm run enterprise:requests -- …`, dropping pnpm's own separator.
 * @param argv - `process.argv.slice(2)`.
 * @returns the parsed command.
 * @throws when a flag is unknown or a positional is given.
 */
export function parseRequestsCommand(argv: readonly string[]): RequestsCommand {
  const args = argv[0] === '--' ? argv.slice(1) : [...argv]
  const { values } = parseArgs({
    args,
    options: {
      json: { type: 'boolean', default: false },
      root: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })
  if (values.help) return { kind: 'help' }
  return { kind: 'status', json: values.json, root: resolve(values.root ?? join(import.meta.dirname, '..')) }
}

if (import.meta.main) {
  try {
    const command = parseRequestsCommand(process.argv.slice(2))
    if (command.kind === 'help') {
      process.stdout.write(REQUESTS_USAGE)
    } else {
      const statuses = readRequestStatuses(command.root)
      if (command.json) process.stdout.write(`${JSON.stringify(statuses, null, 2)}\n`)
      else if (statuses.length === 0) process.stdout.write(`no request under ${REQUESTS_DIR}/\n`)
      else process.stdout.write(`${statuses.map(formatStatus).join('\n')}\n`)
    }
  } catch (error: unknown) {
    process.stderr.write(`enterprise-requests: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
