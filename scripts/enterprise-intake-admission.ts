/**
 * Admission of the tickets the Program Departments coordinators propose.
 *
 * A coordinator's department writes its proposals as one JSON array; this
 * module decides, deterministically and with no model, which of them enter
 * the queue under `data/enterprise/tickets/`. A proposal is admitted only when
 * every rule holds, checked in this order:
 *
 * 1. it is one of the first `maxTickets` entries of the array;
 * 2. it answers a request exactly when its department is that request's: the
 *    department of one of the owner's requests files a ticket carrying the
 *    request's file and title line as its source and priority `0`, and no other
 *    department takes a request as its source;
 * 3. with the next free id of the queue assigned, {@link validateTickets}
 *    accepts it beside every ticket already queued;
 * 4. its `seat` is the owner of its `scope`: a seat among the most specific
 *    roster seats whose `source` covers every scope entry;
 * 5. no open or shipped ticket, and no ticket admitted earlier in the same
 *    intake, has the same source path and anchor;
 * 6. it carries at least one check of its own, and every one of them fails on
 *    a clean checkout of the tip.
 *
 * A check of its own is every acceptance command except the queue's guards:
 * `pnpm run typecheck`, `pnpm run doc-sync`, and the package's coverage run,
 * which the queue README states pass before and after a change and which the
 * engine runs when it verifies the implemented ticket. A refused proposal takes
 * no id, so the admitted ones continue the queue's numbering without a gap.
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

import { SECRET_PATTERN_NAMES, redactText } from '../data/transcripts/tools/secret-patterns.mjs'
import type { Roster, RosterAgentDefinition } from './enterprise-roster.ts'
import { isRequestFile, loadTickets, REQUEST_PRIORITY, TICKETS_DIR, validateTickets } from './enterprise-tickets.ts'
import type { LoadedTicket } from './enterprise-tickets.ts'

/** The enterprise ledger, relative to the repository root. */
export const LEDGER_PATH = 'data/enterprise/ledger.jsonl'

/** Where each intake's record directory is written, relative to the repository root. */
export const INTAKE_DIR = 'data/enterprise/intake'

/** The division whose coordinators run the intake. */
const INTAKE_DIVISION = 'program-departments'

/** The roster role of a subsystem coordinator. */
const COORDINATOR_ROLE = 'coordinator'

/**
 * The file a department writes its proposals to, relative to its worktree
 * root.
 * @param key - the department's key: a refilling coordinator's seat id, or a request's department key.
 * @returns the path.
 */
export function proposalsPath(key: string): string {
  return `.intake/${key}.json`
}

/** One queued ticket, with exactly the fields the queue README lists. */
export interface Ticket {
  readonly id: string
  readonly title: string
  readonly division: string
  readonly seat: string
  readonly kind: string
  readonly source: { readonly path: string; readonly anchor: string }
  readonly task: string
  readonly scope: readonly string[]
  readonly acceptance: readonly TicketCheck[]
  readonly budget: { readonly maxTotalTokens: number; readonly maxWallMs: number }
  readonly priority: number
}

/** One acceptance check of a ticket. */
export interface TicketCheck {
  readonly id: string
  readonly run: string
}

/** The status the ledger gives one ticket: closed by a shipped commit, closed by a rejection, or open. */
export type TicketStatus = 'open' | 'shipped' | 'rejected'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The status of every ticket the ledger names, from each ticket's latest
 * ticket line, by the engine's rule: `shipped` when the line names a shipped
 * commit, `rejected` when its review verdict is `reject`, `open` otherwise.
 * Function lines and lines that are not JSON objects name no ticket and are
 * passed over; the engine owns the ticket line's fields.
 * @param text - the ledger file's contents, empty when the file does not exist.
 * @returns ticket id to status; a ticket the ledger does not name is open.
 */
export function ticketStatuses(text: string): Map<string, TicketStatus> {
  const statuses = new Map<string, TicketStatus>()
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      // A torn or foreign line names no ticket; the ledger's readers own reporting it.
      continue
    }
    if (!isRecord(parsed) || (parsed['type'] !== undefined && parsed['type'] !== 'ticket')) continue
    const ticket = parsed['ticket']
    if (typeof ticket !== 'string') continue
    const shipped = parsed['shipped']
    const review = parsed['review']
    if (isRecord(shipped) && typeof shipped['commit'] === 'string') statuses.set(ticket, 'shipped')
    else if (isRecord(review) && review['verdict'] === 'reject') statuses.set(ticket, 'rejected')
    else statuses.set(ticket, 'open')
  }
  return statuses
}

/** The queue as one intake reads it: every ticket file and the status the ledger gives each ticket. */
export interface Queue {
  /** Every queue file, in id order, as {@link loadTickets} read it. */
  readonly loaded: readonly LoadedTicket[]
  /** The parsed tickets, in id order. */
  readonly tickets: readonly Ticket[]
  readonly statuses: ReadonlyMap<string, TicketStatus>
}

/**
 * Read the queue and the ledger of one repository.
 * @param root - the repository root holding `data/enterprise/`.
 * @returns the queue.
 * @throws when a queue file is not a JSON object carrying a string id, because
 *   the next id and the duplicate rule both read every file.
 */
export function readQueue(root: string): Queue {
  const loaded = loadTickets(root)
  const tickets = loaded.map(({ file, value }) => {
    if (!isRecord(value) || typeof value['id'] !== 'string') throw new Error(`${file} is not a ticket: the queue must be repaired before intake numbers new tickets`)
    return value as unknown as Ticket
  })
  const ledger = resolve(root, LEDGER_PATH)
  return { loaded, tickets, statuses: ticketStatuses(existsSync(ledger) ? readFileSync(ledger, 'utf8') : '') }
}

/**
 * The status one queued ticket has.
 * @param queue - the queue.
 * @param id - the ticket id.
 * @returns the ledger's status, `open` for a ticket it does not name.
 */
export function statusOf(queue: Queue, id: string): TicketStatus {
  return queue.statuses.get(id) ?? 'open'
}

/**
 * The tickets still open: queued and neither shipped nor rejected.
 * @param queue - the queue.
 * @returns the open tickets, in id order.
 */
export function openTickets(queue: Queue): Ticket[] {
  return queue.tickets.filter(ticket => statusOf(queue, ticket.id) === 'open')
}

/**
 * The path prefix a roster source covers: the directory of a `README.md`, a
 * directory itself, or exactly one file.
 * @param source - the seat's repository-relative source.
 * @param root - the tree the source is read in.
 * @returns the prefix; a directory prefix ends with `/`.
 */
export function coveredPrefix(source: string, root: string): string {
  const trimmed = source.replace(/\/+$/, '')
  const slash = trimmed.lastIndexOf('/')
  if (trimmed.slice(slash + 1).toLowerCase() === 'readme.md') return slash === -1 ? '' : `${trimmed.slice(0, slash)}/`
  const absolute = resolve(root, trimmed)
  return existsSync(absolute) && statSync(absolute).isDirectory() ? `${trimmed}/` : trimmed
}

/**
 * Whether a covered prefix contains one repository path.
 * @param prefix - a prefix from {@link coveredPrefix}.
 * @param path - a scope entry or source path, with or without a trailing `/`.
 * @returns true when the path lies at or under the prefix.
 */
export function covers(prefix: string, path: string): boolean {
  if (!prefix.endsWith('/')) return path === prefix
  return path.startsWith(prefix) || `${path.replace(/\/+$/, '')}/` === prefix
}

/**
 * The seats that own a scope: among the roster seats whose source covers every
 * scope entry, those whose covered prefix is the longest.
 * @param roster - the roster.
 * @param root - the tree the sources are read in.
 * @param scope - the scope entries.
 * @returns the owning seat ids, empty when no seat covers every entry.
 */
export function owningSeats(roster: Roster, root: string, scope: readonly string[]): string[] {
  let best = -1
  let owners: string[] = []
  for (const agent of roster.agents) {
    const prefix = coveredPrefix(agent.source, root)
    if (scope.length === 0 || !scope.every(entry => covers(prefix, entry))) continue
    if (prefix.length > best) {
      best = prefix.length
      owners = [agent.id]
    } else if (prefix.length === best) {
      owners.push(agent.id)
    }
  }
  return owners
}

/** A subsystem coordinator with the directory its source covers and the open tickets there. */
export interface Coordinator {
  readonly seat: RosterAgentDefinition
  /** The covered prefix of the coordinator's source, such as `packages/goal/`. */
  readonly subsystem: string
  /** Open tickets the coordinator owns or whose scope or source lies in its subsystem. */
  readonly open: readonly Ticket[]
}

/**
 * Every Program Departments coordinator with its subsystem and open tickets.
 * @param roster - the roster.
 * @param root - the tree the sources are read in.
 * @param open - the open tickets.
 * @returns the coordinators, in roster order.
 */
export function coordinators(roster: Roster, root: string, open: readonly Ticket[]): Coordinator[] {
  return roster.agents
    .filter(agent => agent.role === COORDINATOR_ROLE && agent.division === INTAKE_DIVISION)
    .map((seat) => {
      const subsystem = coveredPrefix(seat.source, root)
      const mine = open.filter(ticket => ticket.seat === seat.id
        || covers(subsystem, ticket.source.path)
        || ticket.scope.some(entry => covers(subsystem, entry)))
      return { seat, subsystem, open: mine }
    })
}

/**
 * The coordinators one intake runs: the named ones, or the `count` with the
 * fewest open tickets; either way ordered by open tickets, then roster order.
 * @param all - every coordinator, in roster order.
 * @param named - the seat ids `--coordinators` named, or undefined.
 * @param count - how many to take when none is named.
 * @returns the selected coordinators.
 * @throws when a named seat is not a Program Departments coordinator.
 */
export function selectCoordinators(all: readonly Coordinator[], named: readonly string[] | undefined, count: number): Coordinator[] {
  const ranked = all.map((coordinator, index) => ({ coordinator, index }))
    .sort((left, right) => left.coordinator.open.length - right.coordinator.open.length || left.index - right.index)
    .map(entry => entry.coordinator)
  if (named === undefined) return ranked.slice(0, count)
  for (const seat of named) {
    if (!all.some(coordinator => coordinator.seat.id === seat)) throw new Error(`--coordinators names ${seat}, which is not a ${INTAKE_DIVISION} coordinator of the roster`)
  }
  return ranked.filter(coordinator => named.includes(coordinator.seat.id))
}

/** What an acceptance command is to admission: a repository gate, the package's coverage run, or a check of the ticket's own. */
export type CheckRole = 'gate' | 'coverage' | 'own'

/** The repository-wide gates the queue mandates, which pass on every tip the queue is filed against. */
const REPOSITORY_GATES: ReadonlySet<string> = new Set(['pnpm run typecheck', 'pnpm run doc-sync'])

/**
 * Classify one acceptance command.
 * @param run - the command line.
 * @returns `gate` for `pnpm run typecheck` and `pnpm run doc-sync`, `coverage`
 *   for a run carrying `--coverage`, and `own` for everything else.
 */
export function checkRole(run: string): CheckRole {
  if (REPOSITORY_GATES.has(run.trim())) return 'gate'
  if (run.includes('--coverage')) return 'coverage'
  return 'own'
}

/** One acceptance command admission ran on the clean tip. */
export interface CheckRun {
  readonly id: string
  readonly run: string
  /** The exit code, or `null` for a command a signal or the timeout ended. */
  readonly exitCode: number | null
  readonly signal: string | null
  readonly timedOut: boolean
  readonly seconds: number
  /** The tail of the combined output, with credential-shaped strings and e-mail addresses masked. */
  readonly output: string
  /** Paths the command left changed in the tip, which admission reset before the next command. */
  readonly dirtied: readonly string[]
}

/** Run one acceptance command on the clean tip. */
export type RunCheck = (check: TicketCheck) => Promise<CheckRun>

/**
 * Mask every credential-shaped string and e-mail address the shared patterns
 * of `data/transcripts/tools/secret-patterns.mjs` recognise, as
 * `[REDACTED-<PATTERN>]`. The mask carries no quote or backslash and never
 * splits a JSON escape, so masking a JSON document keeps it JSON.
 * @param text - the text to scan.
 * @returns the masked text and the number of strings masked per pattern.
 */
export function maskCredentials(text: string): { text: string; hits: Record<string, number> } {
  const { text: masked, counts } = redactText(text, SECRET_PATTERN_NAMES)
  return { text: masked, hits: counts }
}

/** Environment variable names a spawned acceptance command never receives. */
const SECRET_NAME = /KEY|SECRET|TOKEN|PASSWORD/i

/**
 * The environment an acceptance command runs with: this process's, without any
 * variable whose name marks a credential, so a check can neither read one nor
 * print one into the evidence, and without the whole `GIT_CONFIG_*` family: git
 * refuses every invocation when a `GIT_CONFIG_COUNT` names a key the
 * environment no longer carries, and the host configures its credential
 * helpers there, which no check of a local checkout needs.
 * @param env - the environment to scrub.
 * @returns the scrubbed copy.
 */
export function scrubbedEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !SECRET_NAME.test(name) && !name.startsWith('GIT_CONFIG_')))
}

/** Options of {@link shellCheckRunner}. */
export interface ShellCheckOptions {
  /** The clean checkout every command runs in. */
  readonly tip: string
  /** The commit the tip is reset to after a command changed it. */
  readonly commit: string
  /** Wall-clock bound of one command; a command still running then is killed and counts as neither passing nor failing. */
  readonly timeoutMs: number
  /** Characters of combined output kept as evidence, from the end. */
  readonly outputChars: number
}

/**
 * Run acceptance commands with `bash -c` in the tip, one at a time, each in its
 * own process group so the timeout ends every process it started. A command
 * that leaves the tip changed is recorded and the tip is reset to `commit`
 * before the next one, keeping ignored files such as installed dependencies.
 * @param options - where and how long each command runs.
 * @returns the runner.
 */
export function shellCheckRunner(options: ShellCheckOptions): RunCheck {
  const git = (args: readonly string[]): string => spawnSync('git', args, { cwd: options.tip, encoding: 'utf8' }).stdout
  return async (check) => {
    const started = performance.now()
    const settled = await new Promise<SettledCommand>((resolveRun, reject) => {
      const child = spawn('bash', ['-c', check.run], {
        cwd: options.tip,
        env: scrubbedEnvironment(process.env),
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      })
      let output = ''
      const append = (chunk: Buffer): void => {
        output = (output + chunk.toString('utf8')).slice(-options.outputChars * 2)
      }
      child.stdout.on('data', append)
      child.stderr.on('data', append)
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        if (child.pid === undefined) return
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {
          // The group already exited between the deadline and the kill; close still follows.
        }
      }, options.timeoutMs)
      child.on('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.on('close', (exitCode, signal) => {
        clearTimeout(timer)
        resolveRun({ exitCode, signal, timedOut, output })
      })
    })
    const status = git(['status', '--porcelain']).split('\n').filter(line => line !== '')
    const head = git(['rev-parse', 'HEAD']).trim()
    if (status.length > 0 || head !== options.commit) {
      git(['reset', '--quiet', '--hard', options.commit])
      git(['clean', '-fdq'])
    }
    return {
      id: check.id,
      run: check.run,
      exitCode: settled.exitCode,
      signal: settled.signal,
      timedOut: settled.timedOut,
      seconds: Math.round((performance.now() - started) / 100) / 10,
      output: maskCredentials(settled.output.slice(-options.outputChars)).text,
      dirtied: head === options.commit ? status : [...status, `HEAD moved to ${head}`],
    }
  }
}

/** How one acceptance command ended, before the tip is inspected. */
interface SettledCommand {
  readonly exitCode: number | null
  readonly signal: string | null
  readonly timedOut: boolean
  readonly output: string
}

/** Why a proposal was refused. */
type RefusalCode =
  | 'over-limit'
  | 'request'
  | 'invalid'
  | 'owner'
  | 'duplicate'
  | 'no-own-check'
  | 'passes-before'
  | 'timeout'
  | 'not-certified'

/** What admission decided about one proposal. */
export interface Verdict {
  /** Zero-based position in the coordinator's file. */
  readonly index: number
  /** The id the coordinator wrote, when it wrote a string. */
  readonly proposedId: string | null
  readonly title: string | null
  readonly admitted: boolean
  /** The id the admitted ticket takes in the queue. */
  readonly id?: string
  readonly code?: RefusalCode
  /** One line naming why the proposal was refused. */
  readonly reason?: string
  /** The checks of its own that ran on the clean tip, with their output. */
  readonly checks: readonly CheckRun[]
  /** The admitted ticket, as it is written to the queue. */
  readonly ticket?: Ticket
}

/** The source every ticket answering one request carries: the request's file and its title line. */
export interface RequestSource {
  readonly path: string
  readonly anchor: string
}

/** What admission reads besides the proposals. */
export interface AdmissionContext {
  readonly roster: Roster
  /** The clean checkout of the tip: sources and scopes are validated there and checks run there. */
  readonly tip: string
  readonly queue: Queue
  /** Tickets admitted earlier in the same intake, from other departments; they take ids before this batch. */
  readonly admitted: readonly Ticket[]
  readonly runCheck: RunCheck
  /** The request the proposals answer, for a request's department; absent for a refilling coordinator's. */
  readonly request?: RequestSource
}

/** Admission's result for one coordinator's file. */
export interface Admission {
  readonly verdicts: readonly Verdict[]
  /** Why the file as a whole could not be read, when it could not. */
  readonly error?: string
}

/** The fields of a ticket, in the order the queue README lists them. */
const TICKET_FIELDS = ['id', 'title', 'division', 'seat', 'kind', 'source', 'task', 'scope', 'acceptance', 'budget', 'priority'] as const

/**
 * A queue id.
 * @param position - one-based position in the queue.
 * @returns `T-` and four digits.
 */
export function ticketId(position: number): string {
  return `T-${String(position).padStart(4, '0')}`
}

/** A candidate with its id replaced and its fields in the queue's order; unknown fields are kept so the validator names them. */
function withId(candidate: Record<string, unknown>, id: string): Record<string, unknown> {
  const fields: Record<string, unknown> = { ...candidate, id }
  const known: readonly string[] = TICKET_FIELDS
  const order = [...known.filter(key => key in fields), ...Object.keys(fields).filter(key => !known.includes(key))]
  return Object.fromEntries(order.map(key => [key, fields[key]]))
}

function refuse(
  index: number,
  proposal: Record<string, unknown> | undefined,
  code: RefusalCode,
  reason: string,
  checks: readonly CheckRun[] = [],
): Verdict {
  return {
    index,
    proposedId: typeof proposal?.['id'] === 'string' ? proposal['id'] : null,
    title: typeof proposal?.['title'] === 'string' ? proposal['title'] : null,
    admitted: false,
    code,
    reason,
    checks,
  }
}

/**
 * Decide every proposal of one coordinator's file, in file order.
 * @param proposals - the parsed file.
 * @param maxTickets - how many proposals one coordinator may file; later ones are refused unread.
 * @param context - the roster, the tip, the queue, earlier admissions and the check runner.
 * @returns one verdict per proposal, or the reason the file cannot be read.
 */
export async function admitProposals(proposals: unknown, maxTickets: number, context: AdmissionContext): Promise<Admission> {
  if (!Array.isArray(proposals)) return { verdicts: [], error: 'the proposals file must hold one JSON array of tickets' }
  const batch: Ticket[] = []
  const verdicts: Verdict[] = []
  for (const [index, entry] of (proposals as unknown[]).entries()) {
    const proposal = isRecord(entry) ? entry : undefined
    if (index >= maxTickets) {
      verdicts.push(refuse(index, proposal, 'over-limit', `only the first ${maxTickets} proposals of a coordinator are admitted`))
      continue
    }
    if (proposal === undefined) {
      verdicts.push(refuse(index, proposal, 'invalid', 'a proposal must be a JSON object'))
      continue
    }
    const verdict = await admitOne(index, proposal, batch, context)
    verdicts.push(verdict)
    if (verdict.ticket !== undefined) batch.push(verdict.ticket)
  }
  return { verdicts }
}

/**
 * Why a proposal breaks the request rule: a request's department files only a
 * ticket carrying the request's source and priority `0`, and no other
 * department takes a request as its source.
 * @param proposal - the proposal as the department wrote it.
 * @param request - the request the department answers, if it answers one.
 * @returns the reason, or undefined when the rule holds.
 */
function requestRefusal(proposal: Record<string, unknown>, request: RequestSource | undefined): string | undefined {
  const source = isRecord(proposal['source']) ? proposal['source'] : {}
  if (request === undefined) {
    const path = source['path']
    return typeof path === 'string' && isRequestFile(path) ? `${path} is one of the owner's requests, which only its own department answers` : undefined
  }
  if (source['path'] !== request.path || source['anchor'] !== request.anchor) {
    const expected = JSON.stringify({ path: request.path, anchor: request.anchor })
    return `a ticket answering ${request.path} carries the source ${expected}: the request's file and its title line`
  }
  if (proposal['priority'] !== REQUEST_PRIORITY) return `a ticket answering a request takes priority ${REQUEST_PRIORITY}`
  return undefined
}

async function admitOne(
  index: number,
  proposal: Record<string, unknown>,
  batch: readonly Ticket[],
  context: AdmissionContext,
): Promise<Verdict> {
  const answering = requestRefusal(proposal, context.request)
  if (answering !== undefined) return refuse(index, proposal, 'request', answering)
  const earlier = [...context.admitted, ...batch]
  const id = ticketId(context.queue.tickets.length + earlier.length + 1)
  const candidate = withId(proposal, id)
  const file = `${TICKETS_DIR}/${id}.json`
  const loaded: LoadedTicket[] = [
    ...context.queue.loaded,
    ...earlier.map(ticket => ({ file: `${TICKETS_DIR}/${ticket.id}.json`, value: ticket })),
    { file, value: candidate },
  ]
  const errors = validateTickets(loaded, context.roster, context.tip)
    .filter(error => error.startsWith(`${file}: `) || error.includes('numbered without gaps'))
    .map(error => error.startsWith(`${file}: `) ? error.slice(file.length + 2) : error)
  if (errors.length > 0) return refuse(index, proposal, 'invalid', errors.join('; '))
  const ticket = candidate as unknown as Ticket
  const owners = owningSeats(context.roster, context.tip, ticket.scope)
  if (!owners.includes(ticket.seat)) {
    const named = owners.length === 0 ? 'no roster seat covers every scope entry' : `its scope is owned by ${owners.join(' or ')}`
    return refuse(index, proposal, 'owner', `seat ${ticket.seat} does not own the scope: ${named}`)
  }
  const duplicate = [
    ...context.queue.tickets.filter(queued => statusOf(context.queue, queued.id) !== 'rejected'),
    ...earlier,
  ].find(other => other.source.path === ticket.source.path && other.source.anchor === ticket.source.anchor)
  if (duplicate !== undefined) {
    return refuse(index, proposal, 'duplicate', `${duplicate.id} already carries the source ${ticket.source.path} and its anchor`)
  }
  const own = ticket.acceptance.filter(check => checkRole(check.run) === 'own')
  if (own.length === 0) return refuse(index, proposal, 'no-own-check', 'every acceptance command is a guard that passes before the change; a ticket needs a check of its own that fails before it')
  const checks: CheckRun[] = []
  for (const check of own) checks.push(await context.runCheck(check))
  const timedOut = checks.find(run => run.timedOut)
  if (timedOut !== undefined) return refuse(index, proposal, 'timeout', `check ${timedOut.id} did not finish on the clean tip; acceptance must be fast`, checks)
  const passing = checks.find(run => run.exitCode === 0)
  if (passing !== undefined) return refuse(index, proposal, 'passes-before', `check ${passing.id} already passes on the clean tip, so it certifies nothing`, checks)
  return { index, proposedId: typeof proposal['id'] === 'string' ? proposal['id'] : null, title: ticket.title, admitted: true, id, checks, ticket }
}

/**
 * Refuse, as not certified, every proposal a department's verifier did not
 * certify. The other refusals keep their own reason, which is what the
 * department's attempts were told.
 * @param admission - the admission of an uncertified department's last committed file.
 * @returns the admission with no proposal admitted.
 */
export function uncertified(admission: Admission): Admission {
  return {
    ...admission,
    verdicts: admission.verdicts.map(verdict => verdict.admitted
      ? {
        index: verdict.index,
        proposedId: verdict.proposedId,
        title: verdict.title,
        admitted: false,
        code: 'not-certified' as const,
        reason: 'the department did not certify, so none of its proposals is admitted',
        checks: verdict.checks,
      }
      : verdict),
  }
}

/**
 * One ticket file's text in the queue's layout: one field per line, each
 * acceptance check and the budget on a single line.
 * @param ticket - the ticket.
 * @returns the file's contents, ending with one newline.
 */
export function formatTicket(ticket: Ticket): string {
  const field = (name: string, value: unknown): string => `  ${JSON.stringify(name)}: ${JSON.stringify(value)}`
  const lines = [
    field('id', ticket.id),
    field('title', ticket.title),
    field('division', ticket.division),
    field('seat', ticket.seat),
    field('kind', ticket.kind),
    `  "source": {\n    "path": ${JSON.stringify(ticket.source.path)},\n    "anchor": ${JSON.stringify(ticket.source.anchor)}\n  }`,
    field('task', ticket.task),
    `  "scope": [\n${ticket.scope.map(entry => `    ${JSON.stringify(entry)}`).join(',\n')}\n  ]`,
    `  "acceptance": [\n${ticket.acceptance.map(check => `    { "id": ${JSON.stringify(check.id)}, "run": ${JSON.stringify(check.run)} }`).join(',\n')}\n  ]`,
    `  "budget": { "maxTotalTokens": ${ticket.budget.maxTotalTokens}, "maxWallMs": ${ticket.budget.maxWallMs} }`,
    field('priority', ticket.priority),
  ]
  return `{\n${lines.join(',\n')}\n}\n`
}

/**
 * One verdict as the department's verifier prints it: short enough that the
 * evidence bound carries every line into the department's next turn.
 * @param verdict - the verdict.
 * @returns one line.
 */
export function describeVerdict(verdict: Verdict): string {
  const label = `proposal ${verdict.index + 1}${verdict.title === null ? '' : ` (${JSON.stringify(verdict.title)})`}`
  if (verdict.admitted) return `ADMITTED ${label} as ${verdict.id ?? ''}: every check of its own fails on the clean tip`
  return `REFUSED ${label} [${verdict.code ?? ''}]: ${verdict.reason ?? ''}`
}
