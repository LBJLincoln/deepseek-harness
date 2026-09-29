/**
 * The pure half of one enterprise shift: which tickets a shift takes, the
 * standard a ticket's department is certified against, the text a department
 * and its reviewer read, the ledger line a ticket ends the shift with, and the
 * redaction every recorded byte passes through. Nothing here touches git, a
 * process, or a session; `driver.ts` owns those.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CheckId, StandardCheck } from '@deepseek-ai/dsh-verification/types'
import { ROSTER_PATH } from '../../../../../scripts/enterprise-roster.ts'
import type { Roster } from '../../../../../scripts/enterprise-roster.ts'
import { loadTickets, validateTickets } from '../../../../../scripts/enterprise-tickets.ts'
import type { QueuePolicy } from '../../../../../scripts/enterprise-tickets.ts'

/** One queue file after validation, as the engine reads it. */
export interface Ticket {
  readonly id: string
  readonly title: string
  readonly division: string
  readonly seat: string
  readonly kind: string
  readonly source: { readonly path: string; readonly anchor: string }
  readonly task: string
  readonly scope: readonly string[]
  readonly acceptance: readonly { readonly id: string; readonly run: string }[]
  readonly budget: { readonly maxTotalTokens: number; readonly maxWallMs: number }
  readonly priority: number
}

/** The ledger file, relative to the repository root. */
export const LEDGER_PATH = 'data/enterprise/ledger.jsonl'

/** The directory every shift record is written under, relative to the repository root. */
export const SHIFTS_DIR = 'data/enterprise/shifts'

/** The file every shift appends its start line to, relative to the repository root. */
export const SHIFT_STARTS_PATH = 'data/enterprise/shift-starts.jsonl'

/** How one department was staffed: the harness loop on the composed route, or Claude Code through the subagent seam. */
export type ImplementerKind = 'route' | 'subagent'

/** What one department came to, as the ledger line states it. */
export type DepartmentOutcome = 'certified' | 'failed' | 'blocked' | 'abandoned' | 'pending' | 'halted'

/** What the independent reviewer decided; `none` when no review ran. */
export type ReviewVerdict = 'approve' | 'reject' | 'none'

/** What the shift's integration did with one ticket. */
export type IntegrationOutcome =
  | 'merged'
  | 'skipped'
  | 'conflict'
  | 'checks-failed'
  | 'digest-mismatch'
  | 'not-shipped'

/**
 * One line of `data/enterprise/ledger.jsonl`: one ticket's passage through one
 * shift. The field set is shared with the enterprise functions that read the
 * ledger, so it changes only together with them.
 */
export interface TicketLedgerLine {
  readonly type: 'ticket'
  /** ISO-8601 instant the line was written. */
  readonly at: string
  readonly shift: string
  readonly ticket: string
  readonly seat: string
  readonly division: string
  readonly programId: string
  readonly implementer: ImplementerKind
  readonly model: string
  readonly department: { readonly outcome: DepartmentOutcome; readonly sessionId: string | null }
  readonly checks: readonly { readonly id: string; readonly ok: boolean }[]
  readonly review: { readonly verdict: ReviewVerdict; readonly sessionId: string | null }
  readonly integration: { readonly outcome: IntegrationOutcome }
  readonly shipped: { readonly commit: string } | null
  readonly reason: string
  readonly tokens: number
  readonly seconds: number
}

/** The status the ledger gives one ticket: closed by a shipped commit, closed by a rejection, or still open. */
export type TicketStatus = 'shipped' | 'rejected' | 'open'

/** The prefix of the reason a ticket line carries when the shift halted on the subscription's usage limit. */
export const LIMIT_HALT_REASON = 'halted: limit'

/**
 * One line of {@link SHIFT_STARTS_PATH}: a shift that selected its tickets,
 * written and pushed before any department runs. The shift's ticket lines are
 * its end; a start with none was cut off before it could write them.
 */
export interface ShiftStartLine {
  readonly type: 'shift-start'
  /** ISO-8601 instant the shift started. */
  readonly at: string
  readonly shift: string
  readonly tickets: readonly string[]
  /** The tip the shift cut its worktrees from. */
  readonly base: string
  /** The host and process that ran the shift, which tell a shift still running from one that died. */
  readonly host: string
  readonly pid: number
  readonly implementer: ImplementerKind
}

/** The prefix of the reason a ticket line carries when its shift started and never recorded an end. */
export const ABANDONED_REASON = 'abandoned: container reset'

/**
 * Parse the start lines of {@link SHIFT_STARTS_PATH}. The file is
 * machine-written, so a line that is not JSON is refused as damage; a line of
 * another type is skipped.
 * @param text - the file's contents, possibly empty.
 * @returns the start lines in file order.
 */
export function parseShiftStarts(text: string): ShiftStartLine[] {
  return text.split('\n')
    .filter(line => line.trim() !== '')
    .map(line => JSON.parse(line) as { type?: unknown })
    .filter(parsed => parsed.type === 'shift-start') as ShiftStartLine[]
}

/**
 * The ticket lines that close every started shift which recorded no end: a
 * start whose shift has no ticket line in the ledger, unless `inFlight` says
 * its process is still running. Each of its tickets still in the queue gets an
 * `abandoned` line under the dead shift's id, whose reason starts with
 * {@link ABANDONED_REASON} and so counts as an attempt in {@link queueOrder}.
 * @param starts - the start lines.
 * @param lines - the ledger so far.
 * @param tickets - the validated queue, for each ticket's seat and division.
 * @param at - the instant the lines are written.
 * @param inFlight - whether a start's shift is still running.
 * @returns the lines, in start order then ticket order.
 */
export function abandonedLines(
  starts: readonly ShiftStartLine[],
  lines: readonly TicketLedgerLine[],
  tickets: readonly Ticket[],
  at: string,
  inFlight: (start: ShiftStartLine) => boolean,
): TicketLedgerLine[] {
  const ended = new Set(lines.map(line => line.shift))
  return starts.filter(start => !ended.has(start.shift) && !inFlight(start)).flatMap(start => start.tickets.flatMap((id) => {
    const ticket = tickets.find(candidate => candidate.id === id)
    if (ticket === undefined) return []
    return [{
      type: 'ticket' as const,
      at,
      shift: start.shift,
      ticket: id,
      seat: ticket.seat,
      division: ticket.division,
      programId: '',
      implementer: start.implementer,
      model: '',
      department: { outcome: 'abandoned' as const, sessionId: null },
      checks: [],
      review: { verdict: 'none' as const, sessionId: null },
      integration: { outcome: 'skipped' as const },
      shipped: null,
      reason: `${ABANDONED_REASON}: shift ${start.shift} started at ${start.at} on ${start.host} over ${start.base} and recorded no end`,
      tokens: 0,
      seconds: 0,
    }]
  }))
}

/**
 * The message of the commit that carries a shift's start line and the lines
 * that close the shifts which never ended.
 * @param shift - the starting shift.
 * @param tickets - the tickets it selected.
 * @param abandoned - the ids of the shifts it closed as abandoned.
 * @param trailers - the two trailer lines.
 * @returns the full message.
 */
export function shiftStartMessage(
  shift: string,
  tickets: readonly string[],
  abandoned: readonly string[],
  trailers: CommitTrailers,
): string {
  return [
    `chore(enterprise): shift ${shift} starts over ${tickets.join(', ')}`,
    '',
    `Daliesk shift ${shift}: its start line in ${SHIFT_STARTS_PATH}, pushed before any department runs.`,
    ...abandoned.length === 0 ? [] : [`It closes ${abandoned.join(', ')}, which started and recorded no end, as ${ABANDONED_REASON}.`],
    '',
    `Co-Authored-By: ${trailers.coAuthor}`,
    `Claude-Session: ${trailers.session}`,
  ].join('\n')
}

/** How a shift chooses its tickets: the next `n` open ones in queue order, or named ones. */
export type TicketSelection = { readonly kind: 'next'; readonly count: number } | { readonly kind: 'tickets'; readonly ids: readonly string[] }

/**
 * Read and validate the queue of one repository.
 * @param root - the repository root holding `data/enterprise/`.
 * @param policy - the acceptance commands that queue mandates.
 * @returns every ticket, in id order.
 * @throws when any file fails validation, listing every violation.
 */
export function readQueue(root: string, policy: QueuePolicy): Ticket[] {
  const roster = JSON.parse(readFileSync(join(root, ROSTER_PATH), 'utf8')) as Roster
  const loaded = loadTickets(root)
  const errors = validateTickets(loaded, roster, root, policy)
  if (errors.length > 0) throw new Error(`the ticket queue under ${root} is invalid:\n${errors.join('\n')}`)
  return loaded.map(entry => entry.value as Ticket)
}

/**
 * Parse the ledger file's ticket lines. A line whose `type` is absent or
 * `ticket` is a ticket line; a line of any other type — the enterprise
 * functions' `function` lines share the file — is skipped. A line that is not
 * JSON is refused: the ledger is machine-written, so it is damage.
 * @param text - the file's contents, possibly empty.
 * @returns the ticket lines in file order.
 */
export function parseLedger(text: string): TicketLedgerLine[] {
  return text.split('\n')
    .filter(line => line.trim() !== '')
    .map(line => JSON.parse(line) as { type?: unknown })
    .filter(parsed => parsed.type === undefined || parsed.type === 'ticket') as TicketLedgerLine[]
}

/**
 * The status of every ticket the ledger names, from each ticket's latest line.
 * @param lines - the ledger in file order.
 * @returns ticket id to status; a ticket with no line is absent, which is `open`.
 */
export function ticketStatuses(lines: readonly TicketLedgerLine[]): Map<string, TicketStatus> {
  const statuses = new Map<string, TicketStatus>()
  for (const line of lines) {
    statuses.set(line.ticket, line.shipped !== null ? 'shipped' : line.review.verdict === 'reject' ? 'rejected' : 'open')
  }
  return statuses
}

/**
 * The open tickets in the order `--next` takes them: fewest attempts first, so
 * a ticket that failed waits until every untried ticket had its turn; then by
 * priority; then each division in turn, so one division's backlog does not hold
 * back another's tickets of the same priority; then by id. An attempt is a
 * ledger line for the ticket whose reason does not start with
 * {@link LIMIT_HALT_REASON}: a halt on the usage limit is not the ticket's failure.
 * @param open - the open tickets.
 * @param lines - the ledger so far.
 * @returns the same tickets, in queue order.
 */
export function queueOrder(open: readonly Ticket[], lines: readonly TicketLedgerLine[]): Ticket[] {
  const attempts = new Map<string, number>()
  for (const line of lines) {
    if (!line.reason.startsWith(LIMIT_HALT_REASON)) attempts.set(line.ticket, (attempts.get(line.ticket) ?? 0) + 1)
  }
  const tries = (ticket: Ticket): number => attempts.get(ticket.id) ?? 0
  const byId = [...open].sort((left, right) => (left.id < right.id ? -1 : 1))
  // A ticket's turn is its rank, by id, among its division's tickets of the same attempts and priority.
  const ranks = new Map<string, number>()
  const turn = new Map<string, number>()
  for (const ticket of byId) {
    const group = JSON.stringify([tries(ticket), ticket.priority, ticket.division])
    const rank = ranks.get(group) ?? 0
    ranks.set(group, rank + 1)
    turn.set(ticket.id, rank)
  }
  return byId.sort((left, right) =>
    tries(left) - tries(right)
    || left.priority - right.priority
    || (turn.get(left.id) ?? 0) - (turn.get(right.id) ?? 0)
    || (left.id < right.id ? -1 : 1))
}

/**
 * The tickets one shift takes: the first `n` open ones in {@link queueOrder}
 * for `next`, the named ones in the order named for `tickets`.
 * @param tickets - the validated queue.
 * @param lines - the ledger so far.
 * @param selection - what the shift asked for.
 * @returns the selected tickets.
 * @throws when a named ticket is unknown or closed, or `next` asks for a non-positive count.
 */
export function selectTickets(tickets: readonly Ticket[], lines: readonly TicketLedgerLine[], selection: TicketSelection): Ticket[] {
  const statuses = ticketStatuses(lines)
  const open = tickets.filter(ticket => (statuses.get(ticket.id) ?? 'open') === 'open')
  switch (selection.kind) {
    case 'next': {
      if (!Number.isInteger(selection.count) || selection.count < 1) throw new Error('--next takes a positive integer')
      return queueOrder(open, lines).slice(0, selection.count)
    }
    case 'tickets':
      return selection.ids.map((id) => {
        const ticket = tickets.find(candidate => candidate.id === id)
        if (ticket === undefined) throw new Error(`ticket ${id} is not in the queue`)
        const status = statuses.get(id) ?? 'open'
        if (status !== 'open') throw new Error(`ticket ${id} is ${status} in ${LEDGER_PATH}`)
        return ticket
      })
    default:
      return assertNeverSelection(selection)
  }
}

function assertNeverSelection(selection: never): never {
  throw new TypeError(`unhandled ticket selection ${JSON.stringify(selection)}`)
}

/**
 * The department key one ticket works under. A goal key is lower-kebab-case,
 * so the ticket id is lowered; the ledger line names the ticket itself.
 * @param ticketId - `T-NNNN`.
 * @returns `t-nnnn`.
 */
export function departmentKey(ticketId: string): string {
  return ticketId.toLowerCase()
}

/** Ids of the checks the engine adds to every ticket's acceptance. */
export const ENGINE_CHECKS = {
  committed: 'engine-committed',
  scope: 'engine-scope',
  whitespace: 'engine-whitespace',
  documentation: 'engine-documentation',
} as const

/**
 * The queue's documentation gate as one check: the policy's command runs when
 * the diff from `base` touches any Markdown document, and the check passes
 * without running it when none changed.
 * @param policy - the queue's policy; a policy without a documentation run yields no check.
 * @param base - the revision the diff starts from.
 * @param id - the check's id.
 * @returns the check, or nothing.
 */
export function documentationCheck(policy: QueuePolicy, base: string, id: CheckId): StandardCheck[] {
  if (policy.documentationRun === undefined) return []
  return [{
    id,
    outcome: `a change that touches a Markdown document passes: ${policy.documentationRun}`,
    run: `! git diff --name-only ${base} HEAD -- '*.md' | grep -q . || ${policy.documentationRun}`,
  }]
}

/** Quote one word for bash: single quotes, each embedded single quote closed, escaped, and reopened. */
function shellWord(word: string): string {
  return `'${word.replaceAll("'", String.raw`'\''`)}'`
}

/**
 * One acceptance command as the engine runs it. A command the queue policy
 * marks heavy runs under util-linux `flock` on the shift's heavy lock when the
 * shift names one — it waits for the lock, holds it while it runs, and releases
 * it when it exits or is killed — so it never runs beside another heavy run of
 * this shift or of anything else on the machine that takes the same lock. The
 * command itself runs in `bash -c` unchanged, whatever its pipes and quotes.
 * Every other command runs as written.
 * @param run - the ticket's command line.
 * @param policy - the queue's policy, which marks heavy runs.
 * @param heavyLock - the lock file every heavy run takes, or `undefined` to run unlocked.
 * @returns the command line the check runs.
 */
export function acceptanceRun(run: string, policy: QueuePolicy, heavyLock: string | undefined): string {
  if (heavyLock === undefined || !policy.heavyFragments.some(fragment => run.includes(fragment))) return run
  return `flock ${shellWord(heavyLock)} bash -c ${shellWord(run)}`
}

/**
 * The paths one ticket may change: its own scope, then the queue's generated
 * paths, which every ticket's scope includes.
 * @param ticket - the ticket.
 * @param policy - the queue's policy.
 * @returns git pathspecs, the ticket's first.
 */
export function ticketScope(ticket: Ticket, policy: QueuePolicy): string[] {
  return [...ticket.scope, ...policy.generatedPaths.filter(path => !ticket.scope.includes(path))]
}

/**
 * The standard one department is certified against: the ticket's acceptance
 * commands, each as {@link acceptanceRun} runs it, then the engine's own — the
 * branch carries a commit past the base, every changed path is under the
 * ticket's scope or one of the queue's generated paths, the diff carries no
 * whitespace error, and a change touching a Markdown document passes the
 * queue's documentation gate. The scope check lists the changed paths outside
 * every allowed pathspec through git's own exclude pathspecs and passes only
 * when that list is empty.
 * @param ticket - the ticket.
 * @param base - the revision every worktree of the shift is cut from.
 * @param policy - the queue's policy, whose documentation gate, heavy runs and generated paths the standard follows.
 * @param heavyLock - the lock file the heavy acceptance commands take, or `undefined` to run them unlocked.
 * @param prefix - `''` for the department's own standard, a label for the shift's re-run.
 * @returns the checks in the order they run.
 */
export function ticketChecks(ticket: Ticket, base: string, policy: QueuePolicy, heavyLock: string | undefined, prefix = ''): StandardCheck[] {
  const id = (name: string): CheckId => `${prefix}${name}` as CheckId
  const scope = ticketScope(ticket, policy)
  const excludes = scope.map(entry => `':(exclude)${entry}'`).join(' ')
  return [
    ...ticket.acceptance.map(check => ({
      id: id(check.id),
      outcome: `acceptance ${check.id} of ${ticket.id} exits 0`,
      run: acceptanceRun(check.run, policy, heavyLock),
    })),
    {
      id: id(ENGINE_CHECKS.committed),
      outcome: 'the branch carries at least one commit past the base revision',
      run: `test "$(git rev-parse HEAD)" != "$(git rev-parse ${base})"`,
    },
    {
      id: id(ENGINE_CHECKS.scope),
      outcome: `every changed path is under one of: ${scope.join(', ')}`,
      run: `test -z "$(git diff --name-only ${base} HEAD -- . ${excludes})"`,
    },
    {
      id: id(ENGINE_CHECKS.whitespace),
      outcome: 'the diff carries no whitespace error',
      run: `git diff --check ${base} HEAD`,
    },
    ...documentationCheck(policy, base, id(ENGINE_CHECKS.documentation)),
  ]
}

/** The first line of a department's objective, by which a scripted route recognizes its ticket. */
function objectiveHeading(ticket: Ticket): string {
  return `Ticket ${ticket.id}: ${ticket.title}.`
}

/**
 * The objective one department's goal is created with: the ticket, the seat,
 * the task, and the rules a contributor to this repository follows, pointed at
 * the files that state them rather than restating them. A queue that owns
 * generated files adds how to bring them back in line and that they are in
 * scope; a shift under a heavy lock adds how the heavy commands are run.
 * @param ticket - the ticket.
 * @param seatName - the display name of the seat, from the roster.
 * @param policy - the queue's policy, for its generated paths and heavy runs.
 * @param heavyLock - the lock file the heavy acceptance commands take, or `undefined`.
 * @returns the objective text.
 */
export function departmentObjective(ticket: Ticket, seatName: string, policy: QueuePolicy, heavyLock: string | undefined): string {
  const quoted = (entries: readonly string[]): string => entries.map(entry => `\`${entry}\``).join(', ')
  const generated = policy.generatedPaths.length === 0 ? '' : ', and the generated files named below'
  return [
    objectiveHeading(ticket),
    `You are the ${seatName} (seat \`${ticket.seat}\`) of the \`${ticket.division}\` division, working this ticket in your own git worktree on your own branch.`,
    `Task: ${ticket.task}`,
    `Rules: read \`CLAUDE.md\` at the root of this worktree and the README of every package you change before editing, and follow them. Change only paths under: ${quoted(ticket.scope)}${generated}. Install or update no dependencies. Do not push.`,
    ...policy.generatedPaths.length === 0
      ? []
      : [`Generated files: when \`pnpm run doc-sync\` reports a generated file stale, run the generator it names (\`pnpm run gen-…\`) and commit what it writes; when it reports a \`type-equiv\` drift, update the named block, and its Chinese counterpart, to match the source; then re-record every translation pair whose sides changed with \`pnpm run verify-translation-pairing --write <English path>\`. These files are inside your scope whichever package they are in: ${quoted(policy.generatedPaths)}.`],
    `Commit every change on this branch before you stop, with a message that names the ticket: only committed work is measured, over a clean worktree. Your work is accepted when these commands exit 0 at the worktree root: ${ticket.acceptance.map(check => `\`${check.run}\``).join('; ')}.`,
    ...heavyLock === undefined
      ? []
      : [`Heavy runs share this machine: the engine runs every acceptance command containing ${quoted(policy.heavyFragments)} under \`flock ${heavyLock}\`, which waits for every other heavy run on the machine. Run such a command yourself the same way, \`flock ${heavyLock} <command>\`, with a timeout that allows for the wait.`],
    'If the ticket turns out larger than written, stop with a report of what you found instead of widening the change.',
  ].join('\n')
}

/** The line the reviewer's answer opens with, and the pattern that reads it back. */
const REVIEW_VERDICT_LINE = /^[ \t]*verdict:[ \t]*(approve|reject)[ \t]*$/im

/** The first sentence of the reviewer's standing instruction, by which a scripted route recognizes a review. */
export const REVIEW_MARKER = 'You are the independent reviewer of one change to a repository.'

/**
 * The reviewer's standing instruction. It states the answer format the verdict
 * is read back from, so a change here without a matching change to the verdict
 * pattern rejects every change.
 */
export const REVIEW_INSTRUCTION = [
  `${REVIEW_MARKER} You did not make it and cannot reach the session that did: the next two messages are the whole record you have.`,
  '',
  'The first is the ticket the implementer worked from. The second is the evidence: the diff the implementer committed, the messages of its commits, and the output of every check the change was measured by.',
  '',
  'Answer with this line first, then your reasons on the lines after it:',
  '',
  'verdict: approve',
  '',
  'Use `approve` when the diff does what the ticket asks, stays inside the ticket\'s scope, and the checks passed. Use `reject` when it does not do what the ticket asks, changes more than the ticket asks, or the evidence cannot show that it does. The ticket describes the tree as intake saw it; the diff, the commit messages, and the check outputs are the current facts, so judge the diff against the ticket\'s problem and required behaviour rather than against a step the tree already satisfied. The ticket\'s `generated` paths are inside its scope: a change there that regenerates a generated file, or brings a mirror of the changed source and its translation record back in line, is what the repository\'s gates require of the change, not a widening of it. Decide on what you were given; there is nothing further to ask for.',
].join('\n')

/**
 * The ticket as the reviewer reads it.
 * @param ticket - the ticket.
 * @param policy - the queue's policy, whose generated paths every ticket's scope includes.
 * @returns the second message of the review.
 */
export function reviewTicketText(ticket: Ticket, policy: QueuePolicy): string {
  return [
    `<ticket id="${ticket.id}" kind="${ticket.kind}" seat="${ticket.seat}">`,
    `title: ${ticket.title}`,
    `task: ${ticket.task}`,
    `scope: ${ticket.scope.join(', ')}`,
    ...policy.generatedPaths.length === 0 ? [] : [`generated: ${policy.generatedPaths.join(', ')}`],
    'acceptance:',
    ...ticket.acceptance.map(check => `- ${check.id}: ${check.run}`),
    '</ticket>',
  ].join('\n')
}

/** One check's outcome as the reviewer reads it. */
export interface ReviewedCheck {
  readonly id: string
  readonly status: string
  readonly evidence: string
}

/**
 * The evidence as the reviewer reads it: the bounded diff, the bounded
 * messages of the branch's commits, then every check with its status and
 * bounded output. The commit messages are the implementer's own account of
 * the change, committed with it; nothing of the implementer's session is here.
 * @param diff - `git diff <base> HEAD` of the department branch.
 * @param commits - `git log <base>..HEAD` of the department branch, messages only.
 * @param checks - the department's certifying run.
 * @param maxChars - bound of the diff, of the commit messages, and of each check's evidence.
 * @returns the third message of the review.
 */
export function reviewEvidenceText(diff: string, commits: string, checks: readonly ReviewedCheck[], maxChars: number): string {
  return [
    '<diff>',
    boundHead(diff, maxChars),
    '</diff>',
    '<commits>',
    boundHead(commits, maxChars),
    '</commits>',
    '<checks>',
    ...checks.map(check => `- ${check.id}: ${check.status}\n${boundHead(check.evidence, maxChars)}`),
    '</checks>',
  ].join('\n')
}

/** Keep the head of longer text inside the bound, marking what was dropped. */
function boundHead(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`
}

/**
 * Read the reviewer's verdict out of its answer: the first `verdict:` line
 * naming `approve` or `reject`, with everything after it as the rationale. An
 * answer naming neither is a rejection carrying the answer itself, because a
 * reviewer that did not decide approved nothing.
 * @param answer - the reviewer's assembled reply text.
 * @param maxChars - bound of the recorded rationale.
 * @returns the verdict and its bounded rationale.
 */
export function readReviewVerdict(answer: string, maxChars: number): { verdict: 'approve' | 'reject'; rationale: string } {
  const match = REVIEW_VERDICT_LINE.exec(answer)
  if (match === null) {
    const text = answer.trim()
    return { verdict: 'reject', rationale: boundHead(text === '' ? 'the reviewer answered nothing' : `no verdict line: ${text}`, maxChars) }
  }
  const rationale = answer.slice(match.index + match[0].length).trim()
  return { verdict: match[1] as 'approve' | 'reject', rationale: boundHead(rationale === '' ? 'the reviewer gave no reason' : rationale, maxChars) }
}

/** The two trailer lines every shipped commit ends with: the model that wrote the change, and the operator's session. */
export interface CommitTrailers {
  readonly coAuthor: string
  readonly session: string
}

/**
 * The message one shipped ticket commit carries. The commit is authored and
 * committed as `Claude <noreply@anthropic.com>`, the repository's rule, so the
 * enterprise is named in the body.
 * @param ticket - the ticket.
 * @param shift - the shift that shipped it.
 * @param programId - the program whose department delivered it.
 * @param departmentSessionId - that department's session.
 * @param reviewSessionId - the review that approved it.
 * @param trailers - the two trailer lines.
 * @returns the full message, ending with the trailers.
 */
export function shippedCommitMessage(
  ticket: Ticket,
  shift: string,
  programId: string,
  departmentSessionId: string,
  reviewSessionId: string,
  trailers: CommitTrailers,
): string {
  return [
    `${ticket.id}: ${ticket.title}`,
    '',
    `Shift: Daliesk shift ${shift}`,
    `Seat: ${ticket.seat} (${ticket.division})`,
    `Program: ${programId}`,
    `Department session: ${departmentSessionId}`,
    `Review session: ${reviewSessionId}`,
    `Source: ${ticket.source.path} — ${ticket.source.anchor}`,
    '',
    `Co-Authored-By: ${trailers.coAuthor}`,
    `Claude-Session: ${trailers.session}`,
  ].join('\n')
}

/**
 * The message the shift's own commit carries: its ledger lines and its record.
 * @param shift - the shift id.
 * @param shipped - the tickets the commit follows.
 * @param trailers - the two trailer lines.
 * @returns the full message.
 */
export function shiftCommitMessage(shift: string, shipped: readonly string[], trailers: CommitTrailers): string {
  const summary = shipped.length === 0 ? 'nothing shipped' : `shipped ${shipped.join(', ')}`
  return [
    `chore(enterprise): shift ${shift}, ${summary}`,
    '',
    `Daliesk shift ${shift}: its ledger lines and its record under ${SHIFTS_DIR}/.`,
    '',
    `Co-Authored-By: ${trailers.coAuthor}`,
    `Claude-Session: ${trailers.session}`,
  ].join('\n')
}

/**
 * The engine as the principal of a decision an unattended shift makes itself.
 * It is not a signature: `@deepseek-ai/dsh-signoff` records only a person's,
 * and no person reviews an unattended shift's spec or release.
 */
interface MachinePrincipal {
  readonly kind: 'machine'
  /** The deciding engine. */
  readonly id: string
  /** The engine and the shift that decided, for a reader of the record. */
  readonly decidedBy: string
}

/** One decision the shift made without a person: freezing its program spec, or releasing what it assembled. */
export interface EngineDecision {
  readonly transition: 'spec-freeze' | 'release'
  readonly principal: MachinePrincipal
  /** Lowercase SHA-256 hex of the selected tickets, the artefact both decisions cover. */
  readonly artefactSha256: string
}

/** The id every engine decision names as its principal. */
export const ENGINE_PRINCIPAL_ID = 'daliesk-enterprise-shift'

/**
 * The two decisions one shift records in place of a signature: the spec
 * freeze before its program opens and the release of whatever it pushes, both
 * decided by the engine for this shift.
 * @param shift - the shift id.
 * @param artefactSha256 - the digest of the selected tickets.
 * @returns the spec-freeze and the release decision.
 */
export function engineDecisions(shift: string, artefactSha256: string): EngineDecision[] {
  const principal: MachinePrincipal = { kind: 'machine', id: ENGINE_PRINCIPAL_ID, decidedBy: `the enterprise-shift engine, shift ${shift}` }
  return (['spec-freeze', 'release'] as const).map(transition => ({ transition, principal, artefactSha256 }))
}

/** Strings shaped like credentials, cut from every recorded byte. */
const CREDENTIAL_SHAPES = new RegExp([
  String.raw`\b(?:sk-[A-Za-z0-9_-]{8,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}`,
  String.raw`|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})\b`,
  String.raw`|-----BEGIN [A-Z ]*PRIVATE KEY-----`,
].join(''), 'g')

/**
 * Cut credential-shaped strings out of text bound for a committed record.
 * @param text - the text to record.
 * @returns the text with each match replaced, and how many were cut.
 */
export function redactCredentials(text: string): { text: string; redacted: number } {
  let redacted = 0
  const cut = text.replace(CREDENTIAL_SHAPES, () => {
    redacted += 1
    return '[redacted]'
  })
  return { text: cut, redacted }
}

/**
 * The record directory name of one shift: the UTC date it started, then its id.
 * @param startedAt - the shift's start.
 * @param shift - the shift id.
 * @returns `<UTC date>-<shift id>`.
 */
export function shiftRecordName(startedAt: Date, shift: string): string {
  return `${startedAt.toISOString().slice(0, 10)}-${shift}`
}

/**
 * A shift id from its start instant: the UTC clock time and a random suffix,
 * so two shifts started in one second still record apart.
 * @param startedAt - the shift's start.
 * @param suffix - four lower-case hex characters.
 * @returns `hhmmss-<suffix>`.
 */
export function shiftIdFor(startedAt: Date, suffix: string): string {
  return `${startedAt.toISOString().slice(11, 19).replaceAll(':', '')}-${suffix}`
}
