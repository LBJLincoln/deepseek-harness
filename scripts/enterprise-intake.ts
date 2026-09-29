/**
 * The Program Departments coordinators' intake: turn the owner's requests into
 * tickets, and when the ticket queue runs low, run coordinators each proposing
 * tickets for its own package group; admit what the deterministic rules of
 * `enterprise-intake-admission.ts` accept.
 *
 *   pnpm run enterprise:intake -- [--min-open <n>] [--max-requests <n>] [--coordinators <seat,...>] [--count <n>] [--max-tickets <n>]
 *   pnpm run enterprise:intake -- admit --root <dir> --tip <dir> --seat <id> --proposals <file> [--max-tickets <n>] [--request <path>]
 *
 * The first form reads the owner's requests under `data/enterprise/requests/`
 * and counts the open tickets. Every request no ticket answers yet, up to
 * `--max-requests` in file-name order, gets a department of its own that turns
 * it into exactly one ticket, staffed by the coordinators in turn; a request
 * whose first line is not `# <title>` is refused without one. Independently,
 * below `--min-open` open tickets, the selected coordinators each get a
 * department that refills the queue. When any department is due, the intake
 * clones the committed tip into a scratch directory, installs a clean checkout
 * of it for the checks, and runs one program through the driver of
 * `examples/headless-agent/tests/fixtures/enterprise-intake/`, the requests'
 * departments first. Each department's verifier is the second form, run over
 * the proposals it committed: it passes when admission admits at least one of
 * them. After the program the intake admits every department's committed
 * proposals once more, the requests' first and then across the coordinators,
 * writes the admitted tickets into the queue, records the run under
 * `data/enterprise/intake/` with what became of every request it took up, and
 * appends one function line per department that reached the route to the
 * ledger. A department whose route stopped at its usage limit ends the run:
 * the driver refuses every later request without sending it, and the intake
 * exits {@link ROUTE_LIMIT_EXIT_CODE} after recording what the run did.
 */

import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { appendFileSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import {
  admitProposals,
  coordinators,
  covers,
  describeVerdict,
  formatTicket,
  INTAKE_DIR,
  LEDGER_PATH,
  maskCredentials,
  openTickets,
  proposalsPath,
  readQueue,
  selectCoordinators,
  shellCheckRunner,
  statusOf,
  ticketId,
  uncertified,
} from './enterprise-intake-admission.ts'
import type { Admission, AdmissionContext, Coordinator, Queue, RequestSource, Ticket } from './enterprise-intake-admission.ts'
import { isTitled, readRequests, requestTitle, unansweredRequests, UNTITLED_REASON } from './enterprise-requests.ts'
import type { IntakeRequestEntry, TitledRequest } from './enterprise-requests.ts'
import { ROSTER_PATH } from './enterprise-roster.ts'
import type { Roster, RosterAgentDefinition } from './enterprise-roster.ts'
import { REQUEST_PRIORITY, TICKETS_DIR } from './enterprise-tickets.ts'

/** This repository's root, where the fixture, `tsx` and the tsconfig live. */
export const REPO_ROOT = resolve(import.meta.dirname, '..')

/** The fixture whose driver runs the intake program. */
export const INTAKE_FIXTURE = join(REPO_ROOT, 'examples/headless-agent/tests/fixtures/enterprise-intake')

/** Exit code of an intake a route's usage limit stopped. */
export const ROUTE_LIMIT_EXIT_CODE = 3

/** The check id every department's verifier runs under. */
const ADMISSION_CHECK = 'admission'

/** The integration gate: the merged proposals are committed and nothing else is left. */
const CLEAN_TREE_GATE = 'test -z "$(git status --porcelain)"'

/** The deployment choices one intake run takes, each validated when parsed. */
export interface IntakeOptions {
  /** Open tickets at or above which the queue needs no refill. */
  readonly minOpen: number
  /** Requests no ticket answers that one run turns into tickets, in file-name order; later ones wait for a later run. */
  readonly maxRequests: number
  /** Seats `--coordinators` named, or undefined to take the `count` with the fewest open tickets. */
  readonly coordinators: readonly string[] | undefined
  readonly count: number
  /** Proposals one refilling coordinator may file; later ones are refused unread. */
  readonly maxTickets: number
  /** The shift the ledger lines name; the intake's own id when absent. */
  readonly shift: string | undefined
  /** The composition the driver boots. */
  readonly composition: string
  /** The repository whose queue is counted and filled. */
  readonly root: string
  /** Directory the run's clone and clean checkout are made under. */
  readonly scratch: string
  /** Command that installs the clean checkout's dependencies, or `none`. */
  readonly install: string
  /** Top-level directories left out of every checkout of the run; `data/enterprise/` is always kept. */
  readonly exclude: readonly string[]
  /** Wall-clock bound of one acceptance command at admission. */
  readonly checkTimeoutMs: number
  /** Keep the scratch directory after the run. */
  readonly keep: boolean
}

/** The `admit` form: one department's verifier over its committed proposals. */
export interface AdmitOptions {
  readonly root: string
  readonly tip: string
  readonly seat: string
  readonly proposals: string
  readonly maxTickets: number
  readonly checkTimeoutMs: number
  /** The request the proposals answer, for a request's department; its title line is read in the tip. */
  readonly request: string | undefined
}

/** One parsed invocation. */
export type IntakeCommand =
  | { readonly kind: 'help' }
  | { readonly kind: 'intake'; readonly options: IntakeOptions }
  | { readonly kind: 'admit'; readonly options: AdmitOptions }

/** The defaults an invocation that names no value takes. */
export const INTAKE_DEFAULTS = {
  minOpen: 8,
  maxRequests: 2,
  count: 2,
  maxTickets: 3,
  checkTimeoutMs: 120_000,
  install: 'pnpm install --offline --frozen-lockfile',
  exclude: ['data'],
  composition: join(INTAKE_FIXTURE, 'overlays/claude-code.cordis.yml'),
} as const

/** The directory every checkout keeps whatever `--exclude` names: admission reads the roster and the requests there. */
const KEPT_DIRECTORY = dirname(ROSTER_PATH)

/** Characters of each acceptance command's output kept as evidence. */
const OUTPUT_CHARS = 4000

export const USAGE = `Usage: pnpm run enterprise:intake -- [options]
       pnpm run enterprise:intake -- admit --root <dir> --tip <dir> --seat <id> --proposals <file> [--max-tickets <n>] [--request <path>] [--check-timeout-ms <n>]

  --min-open <n>          open tickets at or above which the queue needs no refill (default ${INTAKE_DEFAULTS.minOpen})
  --max-requests <n>      requests no ticket answers that one run turns into tickets, in file-name order (default ${INTAKE_DEFAULTS.maxRequests})
  --coordinators <ids>    comma-separated Program Departments coordinator seats that refill (default: the --count with the fewest open tickets)
  --count <n>             coordinators to take when none is named (default ${INTAKE_DEFAULTS.count})
  --max-tickets <n>       proposals one refilling coordinator may file (default ${INTAKE_DEFAULTS.maxTickets})
  --shift <id>            the shift the ledger lines name (default: the intake's own id)
  --composition <path>    the composition the driver boots (default: the fixture's Claude Code overlay)
  --root <dir>            the repository whose requests are read and whose queue is counted and filled (default: this repository)
  --scratch <dir>         where the run's clone is made (default: $DSH_ENTERPRISE_SCRATCH, else the system temporary directory)
  --install <command>     installs the clean checkout's dependencies, or none (default: ${INTAKE_DEFAULTS.install})
  --exclude <dirs>        comma-separated top-level directories left out of the run's checkouts, or none;
                          ${KEPT_DIRECTORY}/ is always kept (default: ${INTAKE_DEFAULTS.exclude.join(',')})
  --check-timeout-ms <n>  bound of one acceptance command at admission (default ${INTAKE_DEFAULTS.checkTimeoutMs})
  --keep                  keep the scratch directory after the run
`

function positiveInteger(flag: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${flag} must be a positive integer, got ${JSON.stringify(raw)}`)
  return value
}

function required(flag: string, value: string | undefined): string {
  if (value === undefined || value === '') throw new Error(`admit requires ${flag}`)
  return value
}

/**
 * Parse `pnpm run enterprise:intake -- …`. A leading `--` is dropped, since pnpm
 * forwards its own separator into `process.argv`.
 * @param argv - `process.argv.slice(2)`.
 * @param env - the environment `--scratch` falls back to.
 * @returns the parsed command.
 * @throws when a flag is unknown, repeated as a positional, or out of range.
 */
export function parseCommand(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): IntakeCommand {
  const args = argv[0] === '--' ? argv.slice(1) : [...argv]
  if (args[0] === '--help' || args[0] === '-h') return { kind: 'help' }
  if (args[0] === 'admit') {
    const { values } = parseArgs({
      args: args.slice(1),
      options: {
        'root': { type: 'string' },
        'tip': { type: 'string' },
        'seat': { type: 'string' },
        'proposals': { type: 'string' },
        'max-tickets': { type: 'string' },
        'check-timeout-ms': { type: 'string' },
        'request': { type: 'string' },
      },
    })
    return {
      kind: 'admit',
      options: {
        root: resolve(required('--root', values.root)),
        tip: resolve(required('--tip', values.tip)),
        seat: required('--seat', values.seat),
        proposals: required('--proposals', values.proposals),
        maxTickets: positiveInteger('--max-tickets', values['max-tickets'], INTAKE_DEFAULTS.maxTickets),
        checkTimeoutMs: positiveInteger('--check-timeout-ms', values['check-timeout-ms'], INTAKE_DEFAULTS.checkTimeoutMs),
        request: values.request,
      },
    }
  }
  const { values } = parseArgs({
    args,
    options: {
      'min-open': { type: 'string' },
      'max-requests': { type: 'string' },
      'coordinators': { type: 'string' },
      'count': { type: 'string' },
      'max-tickets': { type: 'string' },
      'shift': { type: 'string' },
      'composition': { type: 'string' },
      'root': { type: 'string' },
      'scratch': { type: 'string' },
      'install': { type: 'string' },
      'exclude': { type: 'string' },
      'check-timeout-ms': { type: 'string' },
      'keep': { type: 'boolean', default: false },
    },
  })
  const named = values.coordinators?.split(',').map(seat => seat.trim()).filter(seat => seat !== '')
  if (named !== undefined && named.length === 0) throw new Error('--coordinators names no seat')
  const exclude = values.exclude === undefined
    ? INTAKE_DEFAULTS.exclude
    : values.exclude === 'none' ? [] : values.exclude.split(',').map(dir => dir.trim()).filter(dir => dir !== '')
  for (const dir of exclude) {
    if (!/^[\w.-]+$/.test(dir) || dir === '.' || dir === '..') throw new Error(`--exclude takes top-level directory names, got ${JSON.stringify(dir)}`)
  }
  if (values.shift !== undefined && !/^[\w.:-]+$/.test(values.shift)) throw new Error(`--shift must be letters, digits, '.', ':', '_' or '-', got ${JSON.stringify(values.shift)}`)
  return {
    kind: 'intake',
    options: {
      minOpen: positiveInteger('--min-open', values['min-open'], INTAKE_DEFAULTS.minOpen),
      maxRequests: positiveInteger('--max-requests', values['max-requests'], INTAKE_DEFAULTS.maxRequests),
      coordinators: named,
      count: positiveInteger('--count', values.count, INTAKE_DEFAULTS.count),
      maxTickets: positiveInteger('--max-tickets', values['max-tickets'], INTAKE_DEFAULTS.maxTickets),
      shift: values.shift,
      composition: resolve(values.composition ?? INTAKE_DEFAULTS.composition),
      root: resolve(values.root ?? REPO_ROOT),
      scratch: resolve(values.scratch ?? env['DSH_ENTERPRISE_SCRATCH'] ?? join(tmpdir(), 'dsh-enterprise')),
      install: values.install ?? INTAKE_DEFAULTS.install,
      exclude,
      checkTimeoutMs: positiveInteger('--check-timeout-ms', values['check-timeout-ms'], INTAKE_DEFAULTS.checkTimeoutMs),
      keep: values.keep,
    },
  }
}

/**
 * The intake's own id: the UTC clock time it started and a random suffix.
 * @param now - the start.
 * @returns `hhmmss-<4 hex>`.
 */
export function intakeId(now: Date): string {
  return `${now.toISOString().slice(11, 19).replaceAll(':', '')}-${randomBytes(2).toString('hex')}`
}

function git(args: readonly string[], cwd: string): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${result.stderr.trim()}`)
  return result.stdout.trim()
}

function readRoster(root: string): Roster {
  const parsed = JSON.parse(readFileSync(join(root, ROSTER_PATH), 'utf8')) as unknown
  const roster = parsed as Partial<Roster>
  if (!Array.isArray(roster.agents) || !Array.isArray(roster.divisions)) throw new Error(`${ROSTER_PATH} under ${root} holds no divisions and agents`)
  return parsed as Roster
}

/** Longest part of a request's file name its department key carries. */
const REQUEST_KEY_CHARS = 48

/**
 * The department key of one request: `request-` and its file name's ASCII
 * letters and digits, lower-cased, every other run of characters becoming one
 * hyphen, so the key is a program goal key and a branch name whatever the file
 * is called.
 * @param path - the request's repository path.
 * @returns the key; `request` alone when the name holds no ASCII letter or digit.
 */
export function requestKey(path: string): string {
  const stem = basename(path).replace(/\.md$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '')
  const trimmed = stem.slice(0, REQUEST_KEY_CHARS).replace(/-+$/, '')
  return trimmed === '' ? 'request' : `request-${trimmed}`
}

/** One request a run answers: the request, its department's key, and the coordinator staffing that department. */
export interface RequestAssignment {
  readonly request: TitledRequest
  readonly key: string
  readonly coordinator: Coordinator
}

/**
 * The departments one run gives the requests no ticket answers: the first
 * `maxRequests` in file-name order, each under a key of its own and staffed by
 * the coordinators in turn, fewest open tickets first.
 * @param pending - the titled requests no ticket answers, in file-name order.
 * @param ranked - every coordinator, fewest open tickets first.
 * @param maxRequests - how many requests the run answers.
 * @returns one assignment per request the run answers, in file-name order.
 * @throws when a request is due and the roster has no coordinator to staff it.
 */
export function assignRequests(
  pending: readonly TitledRequest[],
  ranked: readonly Coordinator[],
  maxRequests: number,
): RequestAssignment[] {
  const keys = new Set<string>()
  return pending.slice(0, maxRequests).map((request, index) => {
    const coordinator = ranked[index % ranked.length]
    if (coordinator === undefined) throw new Error(`no Program Departments coordinator can answer ${request.path}`)
    const base = requestKey(request.path)
    let key = base
    for (let suffix = 2; keys.has(key); suffix += 1) key = `${base}-${suffix}`
    keys.add(key)
    return { request, key, coordinator }
  })
}

/** The ticket fields every department's objective describes alike. */
const FIELD = {
  title: '`title` (one line naming the change)',
  kind: '`kind` (fix, test, docs, feature or chore)',
  task: '`task` (the problem with its evidence cited as `path:line`, the required behaviour, the repository rules that constrain it, and what not to touch)',
  scope: '`scope` (the path prefixes the change may touch, one package written with a trailing slash)',
  budget: '`budget` (`{ "maxTotalTokens": 8000000, "maxWallMs": 2700000 }`)',
} as const

/** What every department is told an acceptance list holds. */
const ACCEPTANCE_TEXT = '`acceptance` is a list of `{ "id", "run" }`: `id` a lower-case slug, `run` one shell command run at the repository root, exit 0 meaning pass. It holds the ticket\'s own checks, each keyless, fast (seconds), and failing on the current tree because it asserts what the change adds or removes (`test -f <new spec> && pnpm exec vitest run <new spec>`, `grep -q \'<new text>\' <file>`, `! grep -q \'<removed symbol>\' <file>`); and beside them the package\'s per-file coverage run (`pnpm exec vitest run <package>/ --coverage --coverage.include=\'<package>/src/**/*.ts\'`), `pnpm run typecheck`, and `pnpm run doc-sync` when the change touches documentation.'

/** How a department hands in its proposals: committed, at the path admission reads. */
function commitText(path: string, what: string): string {
  return `Write ${what} to \`${path}\` at the root of this worktree, then \`git add\` and \`git commit\` it before you stop: only committed work is measured.`
}

/** Where a department runs its own checks, and what it must not run. */
function checkoutText(tip: string, exclude: readonly string[]): string {
  const left = exclude.length === 0
    ? ''
    : ` This worktree and that checkout leave out ${exclude.map(dir => `\`${dir}/\``).join(', ')} apart from \`${KEPT_DIRECTORY}/\`; no ticket of yours needs them.`
  return `\`${tip}\` is a clean checkout of this tree with its dependencies installed: run each check of your own there before you commit, keep only tickets whose own checks all fail there, and change nothing in it. Do not run the typecheck, doc-sync or coverage commands anywhere: they pass on this tree by the queue's rules, take minutes, and admission does not run them.${left}`
}

/**
 * The objective one refilling coordinator's department is created with: what
 * intake is, where its work comes from, the ticket schema it writes, and how
 * admission decides. Everything a proposal is measured by is stated here,
 * because it is the whole of what the department is told before its first turn.
 * @param coordinator - the coordinator, its subsystem and its open tickets.
 * @param queue - the queue, for the next id and the sources already filed.
 * @param options - the proposals a coordinator may file and the directories the checkouts leave out.
 * @param tip - the clean checkout, with dependencies installed, the checks run in.
 * @returns the objective text.
 */
export function coordinatorObjective(
  coordinator: Coordinator,
  queue: Queue,
  options: Pick<IntakeOptions, 'maxTickets' | 'exclude'>,
  tip: string,
): string {
  const { seat, subsystem } = coordinator
  const { maxTickets, exclude } = options
  const filed = queue.tickets
    .filter(ticket => statusOf(queue, ticket.id) !== 'rejected' && (ticket.seat === seat.id || covers(subsystem, ticket.source.path)))
    .map(ticket => `\`${ticket.source.path}\` (anchor ${JSON.stringify(ticket.source.anchor)}, ${ticket.id})`)
  const first = ticketId(queue.tickets.length + 1)
  return [
    `${seat.name}, roster seat \`${seat.id}\`: intake for the package group under \`${subsystem}\`.`,
    `Your function is intake: find at most ${maxTickets} small, real pieces of work in \`${subsystem}\` and write each one up as a ticket one implementer can finish in under thirty minutes. You change no code yourself.`,
    'Work comes from, in order of preference: a bullet under a package README\'s `## Known Limitations and Deferred Work` that the tree can now resolve; a `TODO`, `FIXME` or `XXX` marker under a package\'s `src/`; a deferred item of a proposed Agent Note under `.agents/notes/proposed/` that names one of these packages; a README or JSDoc statement the code no longer matches; a fragile or skipped test. Read the code behind every candidate before you write it up, and drop anything larger than one small change or that no command can check.',
    `${commitText(proposalsPath(seat.id), 'the tickets as one JSON array')} Every element carries exactly these fields: \`id\` ("${first}", then the next ids in order; admission renumbers what it admits so the queue stays gap-free), ${FIELD.title}, \`division\` and \`seat\` (the roster seat whose source covers every path in \`scope\`: for anything under \`${subsystem}\` that is \`${seat.id}\` in division \`${seat.division}\`), ${FIELD.kind}, \`source\` (\`{ "path", "anchor" }\`: the file the work comes from and text copied verbatim from it, such as the bullet, marker or heading), ${FIELD.task}, ${FIELD.scope}, \`acceptance\`, ${FIELD.budget} and \`priority\` (1 to 3).`,
    ACCEPTANCE_TEXT,
    checkoutText(tip, exclude),
    filed.length === 0
      ? 'The queue holds no open or shipped ticket in this package group.'
      : `The queue already holds tickets from these sources; a proposal repeating a source path and its anchor is refused: ${filed.join('; ')}.`,
    'Admission reads your committed file ticket by ticket and refuses a ticket that breaks the schema, names a seat whose source does not cover its scope, repeats the source path and anchor of an open or shipped ticket, carries no check of its own, or has a check of its own that already passes on the clean checkout. If you are told every ticket was refused, fix or replace them, commit again, and stop.',
  ].join('\n\n')
}

/**
 * The objective a request's department is created with: the request
 * verbatim, the one ticket it becomes, the ticket schema with the request's
 * source and priority, and how admission decides.
 * @param assignment - the request, its department key, and the coordinator staffing it.
 * @param queue - the queue, for the next id.
 * @param options - the directories the checkouts leave out.
 * @param tip - the clean checkout, with dependencies installed, the checks run in.
 * @returns the objective text.
 */
export function requestObjective(assignment: RequestAssignment, queue: Queue, options: Pick<IntakeOptions, 'exclude'>, tip: string): string {
  const { request, key, coordinator: { seat } } = assignment
  const source = JSON.stringify({ path: request.path, anchor: request.anchor })
  return [
    `${seat.name}, roster seat \`${seat.id}\`: intake of one of the owner's requests, \`${request.path}\`.`,
    `The owner wrote it, and only people with push access to this repository can add a request, so take it as the owner's word:\n\n<request>\n${request.text.trimEnd()}\n</request>`,
    'Your function is intake: turn this request into exactly one ticket one implementer can finish in under thirty minutes. You change no code yourself. Read the code and documents the request is about before you write the ticket; when the request asks for more than one small change can do, the ticket is its first verifiable step, and its `task` says what the request leaves for later.',
    `${commitText(proposalsPath(key), 'the ticket as a JSON array holding exactly that one ticket')} It carries exactly these fields: \`id\` ("${ticketId(queue.tickets.length + 1)}"; admission renumbers what it admits so the queue stays gap-free), ${FIELD.title}, \`division\` and \`seat\` (the seat whose code or document the request is about: of the seats in \`${ROSTER_PATH}\` whose \`source\` covers every path in \`scope\` — a \`README.md\` covers its directory, a directory covers itself, a file covers only itself — the one whose covered path is longest, with its own division), ${FIELD.kind}, \`source\` (exactly \`${source}\`: the request's file and its title line), ${FIELD.task}, ${FIELD.scope}, \`acceptance\`, ${FIELD.budget} and \`priority\` (\`${REQUEST_PRIORITY}\`, which the queue reserves for a ticket answering a request and takes before every untried ticket).`,
    ACCEPTANCE_TEXT,
    checkoutText(tip, options.exclude),
    `Admission reads the first ticket of your committed file and refuses it when it does not carry the request's source and priority \`${REQUEST_PRIORITY}\`, breaks the schema, names a seat that does not own its scope, carries no check of its own, or has a check of its own that already passes on the clean checkout. If you are told the ticket was refused, fix it, commit again, and stop.`,
  ].join('\n\n')
}

/** The plan the driver turns into a program spec. */
export interface IntakePlan {
  readonly objective: string
  readonly baseRevision: string
  readonly departments: readonly {
    readonly key: string
    readonly objective: string
    readonly checks: readonly { readonly id: string; readonly outcome: string; readonly run: string }[]
  }[]
  readonly gates: readonly string[]
}

/** The department whose committed proposals one admission command admits. */
export interface AdmittedDepartment {
  readonly key: string
  /** The coordinator staffing the department. */
  readonly seat: string
  /** The request the department answers, if it answers one. */
  readonly request?: string
}

/** One word of a shell command line: as it is when every character is one the shell takes literally, else single-quoted. */
function shellWord(word: string): string {
  return /^[\w./:=@%+,-]+$/.test(word) ? word : `'${word.replaceAll('\'', '\'\\\'\'')}'`
}

/**
 * The command a department's verifier runs in its worktree: the `admit` form
 * over its committed proposals, one ticket for a request's department.
 * @param department - the department's key, its coordinator, and the request it answers.
 * @param options - the intake's options.
 * @param tip - the clean checkout.
 * @returns one shell command line.
 */
export function admissionCommand(department: AdmittedDepartment, options: IntakeOptions, tip: string): string {
  return [
    join(REPO_ROOT, 'node_modules/.bin/tsx'),
    join(REPO_ROOT, 'scripts/enterprise-intake.ts'),
    'admit',
    '--root', options.root,
    '--tip', tip,
    '--seat', department.seat,
    '--proposals', proposalsPath(department.key),
    '--max-tickets', String(department.request === undefined ? options.maxTickets : 1),
    ...department.request === undefined ? [] : ['--request', department.request],
    '--check-timeout-ms', String(options.checkTimeoutMs),
  ].map(shellWord).join(' ')
}

/** The departments of one intake: the requests it answers, and the coordinators refilling the queue. */
export interface IntakeDepartments {
  readonly requests: readonly RequestAssignment[]
  readonly coordinators: readonly Coordinator[]
}

/**
 * The intake program: one department per request, then one per refilling
 * coordinator, each with admission as its one check, and an integration gated
 * on a clean merged tree.
 * @param departments - the requests' assignments in file-name order, and the coordinators in selection order.
 * @param queue - the queue.
 * @param options - the intake's options.
 * @param base - the commit every worktree starts from.
 * @param tip - the clean checkout.
 * @returns the plan.
 */
export function intakePlan(departments: IntakeDepartments, queue: Queue, options: IntakeOptions, base: string, tip: string): IntakePlan {
  const { requests, coordinators: refilling } = departments
  const parts = [
    ...requests.length === 0 ? [] : [`the owner's requests ${requests.map(assignment => assignment.request.path).join(', ')} become tickets`],
    ...refilling.length === 0 ? [] : [`the ${refilling.map(coordinator => coordinator.seat.id).join(', ')} coordinators propose tickets for their package groups`],
  ]
  return {
    objective: `intake: ${parts.join('; ')}`,
    baseRevision: base,
    departments: [
      ...requests.map(({ request, key, coordinator }) => ({
        key,
        objective: requestObjective({ request, key, coordinator }, queue, options, tip),
        checks: [{
          id: ADMISSION_CHECK,
          outcome: 'admission admits the committed ticket answering the request',
          run: admissionCommand({ key, seat: coordinator.seat.id, request: request.path }, options, tip),
        }],
      })),
      ...refilling.map(coordinator => ({
        key: coordinator.seat.id,
        objective: coordinatorObjective(coordinator, queue, options, tip),
        checks: [{
          id: ADMISSION_CHECK,
          outcome: 'admission admits at least one of the committed proposals',
          run: admissionCommand({ key: coordinator.seat.id, seat: coordinator.seat.id }, options, tip),
        }],
      })),
    ],
    gates: [CLEAN_TREE_GATE],
  }
}

/** One goal of the driver's program report. */
export interface DriverGoal {
  readonly key: string
  readonly status: string
  readonly revision?: string
  readonly reason?: string
  readonly sessionId?: string
}

/** One member session as the driver reports it. */
export interface DriverMember {
  readonly sessionId: string
  readonly key: string
  readonly certified: boolean
  readonly tokens: number
  readonly startedAt: number | null
  readonly endedAt: number | null
  readonly verdicts: readonly string[]
}

/** The route limit that stopped the run, as the driver recorded it. */
export interface DriverRouteLimit {
  readonly sessionId: string
  readonly provider: string
  readonly model: string
  readonly message: string
  readonly resetsAt?: number
}

/** The driver's one result line. */
export interface DriverResult {
  readonly type: 'result'
  readonly report: {
    readonly programId: string
    readonly outcome?: string
    readonly mergedRevision?: string
    readonly goals: readonly DriverGoal[]
  }
  readonly members: readonly DriverMember[]
  /** Sessions whose requests the driver refused without sending, after the route stopped. */
  readonly walled: readonly string[]
  readonly routeLimit?: DriverRouteLimit
}

/** The id every intake decision names as its principal. */
export const INTAKE_PRINCIPAL_ID = 'daliesk-enterprise-intake'

/**
 * The two decisions one intake run records in place of a signature: the freeze
 * of its program spec and the release of what it admitted, both decided by the
 * intake itself, because no person reviews an unattended intake.
 * @param id - the intake run's id.
 * @param planSha256 - lowercase SHA-256 hex of the plan the program was built from.
 * @returns the spec-freeze and the release decision, each naming the machine principal and the run.
 */
export function intakeDecisions(id: string, planSha256: string): { transition: 'spec-freeze' | 'release'; principal: { kind: 'machine'; id: string; decidedBy: string }; artefactSha256: string }[] {
  const principal = { kind: 'machine' as const, id: INTAKE_PRINCIPAL_ID, decidedBy: `the enterprise intake, run ${id}` }
  return (['spec-freeze', 'release'] as const).map(transition => ({ transition, principal, artefactSha256: planSha256 }))
}

/** What the function line of one coordinator states, and why. */
export type FunctionOutcome = 'pass' | 'fail' | 'error'

/** One department's part of the run: its program status, the admission of what it committed, and its function line's outcome. */
export interface DepartmentRecord {
  readonly department: {
    readonly status: string
    readonly reason?: string
    readonly sessionId?: string
    readonly revision?: string
    /** When the department's session logged its last event, which is when its proposals stood. */
    readonly endedAt?: string
    readonly tokens: number
    readonly seconds: number
  }
  /** Whether the department sent any request to the route; a department the stopped route refused locally did not. */
  readonly ran: boolean
  readonly outcome: FunctionOutcome
  readonly admitted: readonly string[]
  readonly proposals: unknown
  readonly admission: Admission
}

/** One refilling coordinator's part of the run, as the record states it. */
export interface CoordinatorRecord extends DepartmentRecord {
  readonly seat: string
  readonly subsystem: string
  readonly openInSubsystem: number
}

/** One request's department, as the record states it. */
export interface RequestRecord extends DepartmentRecord {
  readonly key: string
  /** The coordinator who staffed the department. */
  readonly seat: string
  readonly request: { readonly path: string; readonly title: string; readonly anchor: string }
}

/**
 * The ledger outcome of one department: `pass` when admission admitted a
 * ticket of its, `error` when it was cut before it could finish (a route
 * limit, a spent budget, or no department at all), and `fail` when it ran to
 * its end and nothing was admitted.
 * @param status - the department's program status.
 * @param admitted - the ids admitted from its proposals.
 * @param limited - whether the route stopped at its limit in this department.
 * @returns the outcome.
 */
export function functionOutcome(status: string, admitted: readonly string[], limited: boolean): FunctionOutcome {
  if (admitted.length > 0) return 'pass'
  if (limited || status === 'blocked' || status === 'pending' || status === 'abandoned' || status === 'running') return 'error'
  return 'fail'
}

/** What one intake did with a request its department took up, as the record's `requests` states it. */
export type RequestResult =
  | { readonly result: 'admitted'; readonly ticket: string }
  | { readonly result: 'refused'; readonly reason: string }
  | { readonly result: 'unanswered' }

/**
 * What one intake did with a request its department took up: `admitted` when
 * a ticket answering it was admitted; `refused`, with every reason admission
 * gave, when admission refused what the department committed or the
 * department ran to its end without committing a ticket; `unanswered` when the
 * department was cut before it finished and nothing it committed was refused
 * for a reason of its own, which leaves the request waiting for the next run.
 * @param record - the request's department record.
 * @returns the result.
 */
export function requestResult(record: DepartmentRecord): RequestResult {
  const ticket = record.admitted[0]
  if (ticket !== undefined) return { result: 'admitted', ticket }
  const reasons = [
    ...record.admission.error === undefined ? [] : [record.admission.error],
    ...record.admission.verdicts.flatMap(verdict => (verdict.admitted || verdict.code === 'not-certified' || verdict.reason === undefined ? [] : [verdict.reason])),
  ]
  if (reasons.length > 0) return { result: 'refused', reason: reasons.join('; ') }
  if (record.outcome === 'fail') return { result: 'refused', reason: `its department ended ${record.department.status} without committing a ticket` }
  return { result: 'unanswered' }
}

/** One request as the record's `requests` states it: the result the status reads, and the department that took it up. */
export type RequestEntry = IntakeRequestEntry & {
  readonly title: string | null
  /** The admitted ticket, for `admitted`. */
  readonly ticket?: string
  /** The department that took the request up; absent for a request refused before any department. */
  readonly department?: {
    readonly key: string
    readonly seat: string
    readonly status: string
    readonly ran: boolean
    readonly outcome: FunctionOutcome
    readonly tokens: number
    readonly seconds: number
    readonly refused: readonly Refusal[]
  }
}

/** One refused proposal, as the record's summaries state it. */
interface Refusal {
  readonly index: number
  readonly code: string | undefined
  readonly reason: string | undefined
}

function refusals(admission: Admission): Refusal[] {
  return admission.verdicts
    .filter(verdict => !verdict.admitted)
    .map(verdict => ({ index: verdict.index, code: verdict.code, reason: verdict.reason }))
}

function requestEntry(record: RequestRecord): RequestEntry {
  return {
    path: record.request.path,
    title: record.request.title,
    ...requestResult(record),
    department: {
      key: record.key,
      seat: record.seat,
      status: record.department.status,
      ran: record.ran,
      outcome: record.outcome,
      tokens: record.department.tokens,
      seconds: record.department.seconds,
      refused: refusals(record.admission),
    },
  }
}

/** One request entry as the intake's summary line states it. */
function requestSummary(entry: RequestEntry): object {
  return {
    path: entry.path,
    result: entry.result,
    ...entry.ticket === undefined ? {} : { ticket: entry.ticket },
    ...entry.result === 'refused' ? { reason: entry.reason } : {},
  }
}

/**
 * One function line of the enterprise ledger, with the field set the
 * functions runner shares.
 * @param fields - the line's values.
 * @returns the line's JSON, with its newline.
 */
export function functionLine(fields: {
  readonly at: string
  readonly shift: string
  readonly seat: string
  readonly division: string
  readonly commit: string
  readonly outcome: FunctionOutcome
  readonly evidence: string
  readonly seconds: number
}): string {
  return `${JSON.stringify({
    type: 'function',
    at: fields.at,
    shift: fields.shift,
    seat: fields.seat,
    division: fields.division,
    function: 'intake',
    target: { commit: fields.commit },
    outcome: fields.outcome,
    evidence: { path: fields.evidence },
    seconds: fields.seconds,
  })}\n`
}

function log(message: string): void {
  process.stdout.write(`enterprise-intake: ${message}\n`)
}

function writeJson(path: string, value: unknown): Record<string, number> {
  mkdirSync(dirname(path), { recursive: true })
  const { text, hits } = maskCredentials(`${JSON.stringify(value, null, 2)}\n`)
  writeFileSync(path, text)
  return hits
}

function addHits(total: Record<string, number>, hits: Record<string, number>): void {
  for (const [name, count] of Object.entries(hits)) total[name] = (total[name] ?? 0) + count
}

/**
 * Clone the committed tip, make the clean checkout, and install it. The
 * sparse patterns are set before the first checkout, and git gives every
 * worktree added from the clone the same patterns, so the program's
 * department and integration worktrees leave the same directories out.
 */
function prepare(options: IntakeOptions, run: string, head: string): { repo: string; tip: string } {
  const repo = join(run, 'repo')
  const tip = join(run, 'tip')
  mkdirSync(run, { recursive: true })
  git(['clone', '--quiet', '--no-tags', '--no-checkout', options.root, repo], run)
  if (options.exclude.length > 0) {
    git(['sparse-checkout', 'set', '--no-cone', '/*', ...options.exclude.map(dir => `!/${dir}/`), `/${KEPT_DIRECTORY}/`], repo)
    // The sparse patterns live in per-worktree config, so git enables the
    // `worktreeConfig` extension, and a repository using an extension is
    // format 1; the repository's own hook installer refuses it at format 0.
    git(['config', 'core.repositoryFormatVersion', '1'], repo)
  }
  git(['checkout', '--quiet', '--detach', head], repo)
  git(['config', 'user.name', 'Program Departments intake'], repo)
  git(['config', 'user.email', 'intake@daliesk.invalid'], repo)
  git(['worktree', 'add', '--quiet', '--detach', tip, head], repo)
  if (options.install !== 'none') {
    log(`installing the clean checkout: ${options.install}`)
    const result = spawnSync('bash', ['-c', options.install], { cwd: tip, encoding: 'utf8' })
    writeFileSync(join(run, 'install.log'), `${result.stdout}${result.stderr}`)
    if (result.status !== 0) throw new Error(`${options.install} exited ${String(result.status)} in ${tip}; see ${join(run, 'install.log')}`)
  }
  // An install may give the clean checkout the repository's own git hooks.
  // The departments commit in worktrees with no dependencies installed, where
  // those hooks cannot run, so every other worktree of the clone runs none.
  const hooks = join(run, 'hooks')
  mkdirSync(hooks, { recursive: true })
  git(['config', 'core.hooksPath', hooks], repo)
  return { repo, tip }
}

/** Run the driver over the plan and return its result line. */
async function runDriver(options: IntakeOptions, run: string, repo: string): Promise<DriverResult> {
  const stdout = createWriteStream(join(run, 'stdout.jsonl'))
  const stderr = createWriteStream(join(run, 'stderr.txt'))
  const code = await new Promise<number>((resolveExit, reject) => {
    const child = spawn(join(REPO_ROOT, 'node_modules/.bin/tsx'), [join(INTAKE_FIXTURE, 'driver.ts'), options.composition], {
      cwd: run,
      env: {
        ...process.env,
        TSX_TSCONFIG_PATH: join(REPO_ROOT, 'tsconfig.json'),
        DSH_TEST_PROGRAM_REPO: repo,
        DSH_TEST_SESSION_ROOT: join(run, '.sessions'),
        DSH_INTAKE_PLAN: join(run, 'plan.json'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    // A signal to the intake ends the driver with it, so no program outlives the command.
    const forward = (): void => {
      child.kill('SIGTERM')
    }
    process.once('SIGTERM', forward)
    process.once('SIGINT', forward)
    child.stdout.pipe(stdout)
    child.stderr.pipe(stderr)
    child.on('error', reject)
    child.on('close', (exitCode) => {
      process.off('SIGTERM', forward)
      process.off('SIGINT', forward)
      resolveExit(exitCode ?? 1)
    })
  })
  await Promise.all([new Promise(done => stdout.end(done)), new Promise(done => stderr.end(done))])
  const lines = readFileSync(join(run, 'stdout.jsonl'), 'utf8').trimEnd().split('\n')
  const last = lines.at(-1) ?? ''
  if (code !== 0 || !last.startsWith('{')) {
    const tail = readFileSync(join(run, 'stderr.txt'), 'utf8').slice(-4000)
    throw new Error(`the intake driver exited ${code} without a result; stderr tail:\n${tail}`)
  }
  return JSON.parse(last) as DriverResult
}

/** The committed proposals of one department: at its certified revision, else at its branch head. */
function committedProposals(
  repo: string,
  programId: string,
  key: string,
  revision: string | undefined,
  base: string,
): { text: string; revision: string } | undefined {
  const branch = `program/${programId}/${key}`
  const head = revision ?? spawnSync('git', ['rev-parse', '--verify', '--quiet', branch], { cwd: repo, encoding: 'utf8' }).stdout.trim()
  if (head === '' || head === base) return undefined
  const shown = spawnSync('git', ['show', `${head}:${proposalsPath(key)}`], { cwd: repo, encoding: 'utf8' })
  return shown.status === 0 ? { text: shown.stdout, revision: head } : undefined
}

/** Copy every session log the run wrote into the record, masked. */
function copySessions(sessionsRoot: string, target: string, hits: Record<string, number>): string[] {
  const copied: string[] = []
  if (!existsSync(sessionsRoot)) return copied
  for (const entry of readdirSync(sessionsRoot, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || entry.name !== 'session.jsonl') continue
    const id = basename(entry.parentPath)
    const masked = maskCredentials(readFileSync(join(entry.parentPath, entry.name), 'utf8'))
    addHits(hits, masked.hits)
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, `${id}.jsonl`), masked.text)
    copied.push(id)
  }
  return copied.sort()
}

/** A committed proposals file's parsed value, or why it is not JSON. */
function parseProposals(text: string): { readonly value: unknown } | { readonly error: string } {
  try {
    return { value: JSON.parse(text) as unknown }
  } catch (error: unknown) {
    return { error: `the committed proposals are not JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/** The route limit as the record states it: the driver's facts and the reset as an ISO instant. */
function routeLimitRecord(limit: DriverRouteLimit): DriverRouteLimit & { readonly resetsAtIso?: string } {
  return { ...limit, ...limit.resetsAt === undefined ? {} : { resetsAtIso: new Date(limit.resetsAt).toISOString() } }
}

/** Seconds between two epoch-millisecond instants, or zero when either is unknown. */
function spanSeconds(from: number | null, to: number | null): number {
  return from === null || to === null ? 0 : Math.round((to - from) / 1000)
}

/** What the program run is read from when a department's proposals are admitted. */
interface ProgramRun {
  readonly result: DriverResult
  readonly repo: string
  readonly head: string
}

/**
 * Admit what one department committed, once more after the program: at its
 * certified revision, else at its branch head with every admission turned
 * into an uncertified refusal.
 * @param key - the department's key.
 * @param maxTickets - the proposals of its file admission reads.
 * @param run - the driver's result, the clone, and the base commit.
 * @param context - the admission context, whose `admitted` holds every earlier department's tickets.
 * @returns the department's record and the tickets admitted from it.
 */
async function admitDepartment(
  key: string,
  maxTickets: number,
  run: ProgramRun,
  context: AdmissionContext,
): Promise<{ record: DepartmentRecord; tickets: Ticket[] }> {
  const { result, repo, head } = run
  const goal = result.report.goals.find(candidate => candidate.key === key)
  const member = result.members.find(candidate => candidate.key === key)
  const status = goal?.status ?? 'pending'
  const certified = status === 'certified' || status === 'merged'
  const committed = committedProposals(repo, result.report.programId, key, certified ? goal?.revision : undefined, head)
  const admissionStarted = performance.now()
  const proposals = committed === undefined ? { value: null } : parseProposals(committed.text)
  let admission: Admission = { verdicts: [] }
  if ('error' in proposals) {
    admission = { verdicts: [], error: proposals.error }
  } else if (committed !== undefined) {
    admission = await admitProposals(proposals.value, maxTickets, context)
    if (!certified) admission = uncertified(admission)
  }
  const tickets = admission.verdicts.flatMap(verdict => (verdict.ticket === undefined ? [] : [verdict.ticket]))
  const limited = result.routeLimit !== undefined && result.routeLimit.sessionId === member?.sessionId
  const endedAt = member?.endedAt ?? null
  for (const verdict of admission.verdicts) log(`${key}: ${describeVerdict(verdict)}`)
  if (admission.error !== undefined) log(`${key}: ${admission.error}`)
  return {
    tickets,
    record: {
      department: {
        status,
        ...goal?.reason === undefined ? {} : { reason: goal.reason },
        ...member === undefined ? {} : { sessionId: member.sessionId },
        ...committed === undefined ? {} : { revision: committed.revision },
        ...endedAt === null ? {} : { endedAt: new Date(endedAt).toISOString() },
        tokens: member?.tokens ?? 0,
        seconds: spanSeconds(member?.startedAt ?? null, endedAt) + Math.round((performance.now() - admissionStarted) / 1000),
      },
      ran: member !== undefined && !(result.walled.includes(member.sessionId) && !limited),
      outcome: functionOutcome(status, tickets.map(ticket => ticket.id), limited),
      admitted: tickets.map(ticket => ticket.id),
      proposals: 'error' in proposals ? committed?.text ?? null : proposals.value,
      admission,
    },
  }
}

/** One department's function line to append: the record, the coordinator seat it names, and its evidence. */
interface LedgerEntry {
  readonly record: DepartmentRecord
  readonly seat: RosterAgentDefinition
  readonly evidence: string
}

/**
 * Run one intake over `options.root`.
 * @param options - the intake's options.
 * @returns the process exit code.
 */
export async function runIntake(options: IntakeOptions): Promise<number> {
  const started = new Date()
  const id = intakeId(started)
  const at = started.toISOString()
  const shift = options.shift ?? id
  const record = `${INTAKE_DIR}/${at.slice(0, 10)}-${id}`
  const recordDir = join(options.root, record)
  const head = git(['rev-parse', 'HEAD'], options.root)
  const queue = readQueue(options.root)
  const open = openTickets(queue)
  const pending = unansweredRequests(readRequests(options.root), queue.tickets)
  const untitled = pending
    .filter(request => !isTitled(request))
    .map((request): RequestEntry => ({ path: request.path, title: null, result: 'refused', reason: UNTITLED_REASON }))
  for (const entry of untitled) log(`${entry.path}: refused, ${UNTITLED_REASON}`)
  const titled = pending.filter(isTitled)
  const refill = open.length < options.minOpen
  if (!refill && titled.length === 0) {
    writeJson(join(recordDir, 'result.json'), {
      type: 'intake', id, shift, at, target: { commit: head }, outcome: 'nothing-needed', open: open.length, minOpen: options.minOpen, requests: untitled,
    })
    log(`${open.length} open tickets, at least ${options.minOpen}, and no request to answer: nothing needed; recorded ${record}/result.json`)
    process.stdout.write(`${JSON.stringify({ type: 'intake', id, record, outcome: 'nothing-needed', open: open.length, requests: untitled.map(requestSummary) })}\n`)
    return 0
  }
  const roster = readRoster(options.root)
  const all = coordinators(roster, options.root, open)
  const assignments = assignRequests(titled, selectCoordinators(all, undefined, all.length), options.maxRequests)
  const selected = refill ? selectCoordinators(all, options.coordinators, options.count) : []
  if (refill && selected.length === 0) throw new Error('no Program Departments coordinator is selected')
  if (assignments.length > 0) {
    const later = titled.length - assignments.length
    log(`requests no ticket answers: ${assignments.map(assignment => `${assignment.request.path} (${assignment.coordinator.seat.id})`).join(', ')}${later === 0 ? '' : `; ${later} left for a later intake`}`)
  }
  if (refill) log(`${open.length} open tickets, below ${options.minOpen}: ${selected.map(coordinator => `${coordinator.seat.id} (${coordinator.open.length} open)`).join(', ')}`)
  else log(`${open.length} open tickets, at least ${options.minOpen}: no refill`)
  const run = join(options.scratch, `intake-${at.slice(0, 10)}-${id}`)
  const { repo, tip } = prepare(options, run, head)
  const plan = intakePlan({ requests: assignments, coordinators: selected }, queue, options, head, tip)
  writeFileSync(join(run, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`)
  log(`running the intake program in ${run}`)
  const result = await runDriver(options, run, repo)
  const limit = result.routeLimit
  const programRun: ProgramRun = { result, repo, head }
  const tipRoster = readRoster(tip)
  const runCheck = shellCheckRunner({ tip, commit: head, timeoutMs: options.checkTimeoutMs, outputChars: OUTPUT_CHARS })
  const admitted: Ticket[] = []
  const context = (request?: RequestSource): AdmissionContext => ({
    roster: tipRoster,
    tip,
    queue,
    admitted,
    runCheck,
    ...request === undefined ? {} : { request },
  })
  const ledgerEntries: LedgerEntry[] = []
  const requestRecords: RequestRecord[] = []
  for (const { request, key, coordinator } of assignments) {
    const answer = await admitDepartment(key, 1, programRun, context({ path: request.path, anchor: request.anchor }))
    admitted.push(...answer.tickets)
    const entry: RequestRecord = {
      key,
      seat: coordinator.seat.id,
      request: { path: request.path, title: request.title, anchor: request.anchor },
      ...answer.record,
    }
    requestRecords.push(entry)
    ledgerEntries.push({ record: entry, seat: coordinator.seat, evidence: `${record}/${key}.json` })
  }
  const coordinatorRecords: CoordinatorRecord[] = []
  for (const coordinator of [...selected].sort((left, right) => (left.seat.id < right.seat.id ? -1 : 1))) {
    const proposed = await admitDepartment(coordinator.seat.id, options.maxTickets, programRun, context())
    admitted.push(...proposed.tickets)
    const entry: CoordinatorRecord = {
      seat: coordinator.seat.id,
      subsystem: coordinator.subsystem,
      openInSubsystem: coordinator.open.length,
      ...proposed.record,
    }
    coordinatorRecords.push(entry)
    ledgerEntries.push({ record: entry, seat: coordinator.seat, evidence: `${record}/${coordinator.seat.id}.json` })
  }
  for (const ticket of admitted) writeFileSync(join(options.root, TICKETS_DIR, `${ticket.id}.json`), formatTicket(ticket))
  const hits: Record<string, number> = {}
  const sessions = copySessions(join(run, '.sessions'), join(recordDir, 'sessions'), hits)
  for (const entry of requestRecords) addHits(hits, writeJson(join(recordDir, `${entry.key}.json`), entry))
  for (const entry of coordinatorRecords) addHits(hits, writeJson(join(recordDir, `${entry.seat}.json`), entry))
  const answered = requestRecords.map(requestEntry)
  for (const entry of answered) {
    log(`${entry.path}: ${entry.result}${entry.ticket === undefined ? '' : ` as ${entry.ticket}`}${entry.result === 'refused' ? `, ${entry.reason}` : ''}`)
  }
  const requests = [...answered, ...untitled].sort((left, right) => (left.path < right.path ? -1 : 1))
  const outcome = limit === undefined ? 'ran' : 'route-limit'
  addHits(hits, writeJson(join(recordDir, 'result.json'), {
    type: 'intake',
    id,
    shift,
    at,
    target: { commit: head },
    outcome,
    open: open.length,
    minOpen: options.minOpen,
    maxRequests: options.maxRequests,
    maxTickets: options.maxTickets,
    composition: relative(REPO_ROOT, options.composition),
    program: {
      programId: result.report.programId,
      outcome: result.report.outcome ?? null,
      mergedRevision: result.report.mergedRevision ?? null,
    },
    ...limit === undefined ? {} : { routeLimit: routeLimitRecord(limit) },
    decisions: intakeDecisions(id, createHash('sha256').update(readFileSync(join(run, 'plan.json'))).digest('hex')),
    requests,
    coordinators: coordinatorRecords.map(entry => ({
      seat: entry.seat,
      subsystem: entry.subsystem,
      openInSubsystem: entry.openInSubsystem,
      status: entry.department.status,
      ran: entry.ran,
      outcome: entry.outcome,
      tokens: entry.department.tokens,
      seconds: entry.department.seconds,
      proposals: Array.isArray(entry.proposals) ? entry.proposals.length : 0,
      admitted: entry.admitted,
      refused: refusals(entry.admission),
    })),
    admitted: admitted.map(ticket => ticket.id),
    sessions,
    masked: hits,
  }))
  const ledger = join(options.root, LEDGER_PATH)
  mkdirSync(dirname(ledger), { recursive: true })
  for (const { record: entry, seat, evidence } of ledgerEntries.filter(candidate => candidate.record.ran)) {
    appendFileSync(ledger, functionLine({
      at: entry.department.endedAt ?? at,
      shift,
      seat: seat.id,
      division: seat.division,
      commit: head,
      outcome: entry.outcome,
      evidence,
      seconds: entry.department.seconds,
    }))
  }
  if (!options.keep) rmSync(run, { recursive: true, force: true })
  log(`admitted ${admitted.length === 0 ? 'nothing' : admitted.map(ticket => ticket.id).join(', ')}; recorded ${record}`)
  process.stdout.write(`${JSON.stringify({
    type: 'intake',
    id,
    record,
    outcome,
    admitted: admitted.map(ticket => ticket.id),
    requests: requests.map(requestSummary),
    coordinators: coordinatorRecords.map(entry => ({
      seat: entry.seat,
      outcome: entry.outcome,
      ran: entry.ran,
      admitted: entry.admitted,
      tokens: entry.department.tokens,
      seconds: entry.department.seconds,
    })),
  })}\n`)
  if (limit === undefined) return 0
  const reset = limit.resetsAt === undefined ? '' : `; its limit lifts at ${new Date(limit.resetsAt).toISOString()}`
  process.stderr.write(`enterprise-intake: route ${limit.provider}/${limit.model} stopped at its limit: ${limit.message}${reset}\n`)
  return ROUTE_LIMIT_EXIT_CODE
}

/**
 * One department's verifier: admit the proposals it committed, print one line
 * per proposal, and pass when at least one is admitted. With `--request`, the
 * proposals must answer that request, whose title line is read in the tip.
 * @param options - the `admit` form's options.
 * @returns the exit code: 0 when a proposal is admitted, 1 otherwise.
 */
export async function runAdmit(options: AdmitOptions): Promise<number> {
  if (!existsSync(options.proposals)) {
    process.stdout.write(`REFUSED: no proposals file is committed at ${options.proposals}\n`)
    return 1
  }
  let proposals: unknown
  try {
    proposals = JSON.parse(readFileSync(options.proposals, 'utf8')) as unknown
  } catch (error: unknown) {
    process.stdout.write(`REFUSED: ${options.proposals} is not JSON: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
  let request: RequestSource | undefined
  if (options.request !== undefined) {
    const file = join(options.tip, options.request)
    const anchor = existsSync(file) ? requestTitle(readFileSync(file, 'utf8')).anchor : null
    if (anchor === null) {
      process.stdout.write(`REFUSED: ${options.request} is not a request with a \`# <title>\` first line in the clean checkout\n`)
      return 1
    }
    request = { path: options.request, anchor }
  }
  const commit = git(['rev-parse', 'HEAD'], options.tip)
  const admission = await admitProposals(proposals, options.maxTickets, {
    roster: readRoster(options.tip),
    tip: options.tip,
    queue: readQueue(options.root),
    admitted: [],
    runCheck: shellCheckRunner({ tip: options.tip, commit, timeoutMs: options.checkTimeoutMs, outputChars: 600 }),
    ...request === undefined ? {} : { request },
  })
  if (admission.error !== undefined) {
    process.stdout.write(`REFUSED: ${admission.error}\n`)
    return 1
  }
  for (const verdict of admission.verdicts) {
    process.stdout.write(`${describeVerdict(verdict)}\n`)
    const passing = verdict.checks.find(check => check.exitCode === 0)
    if (verdict.code === 'passes-before' && passing !== undefined) process.stdout.write(`  ${passing.run} exited 0\n`)
  }
  const count = admission.verdicts.filter(verdict => verdict.admitted).length
  process.stdout.write(`${count} of ${admission.verdicts.length} proposals admitted\n`)
  return count > 0 ? 0 : 1
}

if (import.meta.main) {
  try {
    const command = parseCommand(process.argv.slice(2))
    switch (command.kind) {
      case 'help':
        process.stdout.write(USAGE)
        break
      case 'admit':
        process.exitCode = await runAdmit(command.options)
        break
      case 'intake':
        process.exitCode = await runIntake(command.options)
        break
      default:
        throw new TypeError(`unhandled command ${JSON.stringify(command satisfies never)}`)
    }
  } catch (error: unknown) {
    process.stderr.write(`enterprise-intake: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
