/**
 * The Program Departments coordinators' intake: when the ticket queue runs low,
 * run one program whose departments are coordinators, each proposing tickets
 * for its own package group, and admit what the deterministic rules of
 * `enterprise-intake-admission.ts` accept.
 *
 *   pnpm run enterprise:intake -- [--min-open <n>] [--coordinators <seat,...>] [--count <n>] [--max-tickets <n>]
 *   pnpm run enterprise:intake -- admit --root <dir> --tip <dir> --seat <id> --proposals <file> [--max-tickets <n>]
 *
 * The first form counts the open tickets and, below `--min-open`, clones the
 * committed tip into a scratch directory, installs a clean checkout of it for
 * the checks, and runs the intake program through the driver of
 * `examples/headless-agent/tests/fixtures/enterprise-intake/`, one department
 * per selected coordinator. Each department's verifier is the second form,
 * run over the proposals it committed: it passes when admission admits at
 * least one of them. After the program the intake admits every department's
 * committed proposals once more, across departments, writes the admitted
 * tickets into the queue, records the run under `data/enterprise/intake/`,
 * and appends one function line per coordinator to the ledger. A department
 * whose route stopped at its usage limit ends the run: the driver refuses
 * every later request without sending it, and the intake exits
 * {@link ROUTE_LIMIT_EXIT_CODE} after recording what the run did.
 */

import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
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
import type { Admission, Coordinator, Queue, Ticket, Verdict } from './enterprise-intake-admission.ts'
import { ROSTER_PATH } from './enterprise-roster.ts'
import type { Roster } from './enterprise-roster.ts'
import { TICKETS_DIR } from './enterprise-tickets.ts'

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
  /** Open tickets at or above which the intake records that nothing was needed. */
  readonly minOpen: number
  /** Seats `--coordinators` named, or undefined to take the `count` with the fewest open tickets. */
  readonly coordinators: readonly string[] | undefined
  readonly count: number
  /** Proposals one coordinator may file; later ones are refused unread. */
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
}

/** One parsed invocation. */
export type IntakeCommand =
  | { readonly kind: 'help' }
  | { readonly kind: 'intake'; readonly options: IntakeOptions }
  | { readonly kind: 'admit'; readonly options: AdmitOptions }

/** The defaults an invocation that names no value takes. */
export const INTAKE_DEFAULTS = {
  minOpen: 8,
  count: 2,
  maxTickets: 3,
  checkTimeoutMs: 120_000,
  install: 'pnpm install --offline --frozen-lockfile',
  exclude: ['data'],
  composition: join(INTAKE_FIXTURE, 'overlays/claude-code.cordis.yml'),
} as const

/** The directory every checkout keeps whatever `--exclude` names: admission reads the roster there. */
const KEPT_DIRECTORY = dirname(ROSTER_PATH)

/** Characters of each acceptance command's output kept as evidence. */
const OUTPUT_CHARS = 4000

export const USAGE = `Usage: pnpm run enterprise:intake -- [options]
       pnpm run enterprise:intake -- admit --root <dir> --tip <dir> --seat <id> --proposals <file> [--max-tickets <n>] [--check-timeout-ms <n>]

  --min-open <n>          open tickets at or above which nothing is needed (default ${INTAKE_DEFAULTS.minOpen})
  --coordinators <ids>    comma-separated Program Departments coordinator seats (default: the --count with the fewest open tickets)
  --count <n>             coordinators to take when none is named (default ${INTAKE_DEFAULTS.count})
  --max-tickets <n>       proposals one coordinator may file (default ${INTAKE_DEFAULTS.maxTickets})
  --shift <id>            the shift the ledger lines name (default: the intake's own id)
  --composition <path>    the composition the driver boots (default: the fixture's Claude Code overlay)
  --root <dir>            the repository whose queue is counted and filled (default: this repository)
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
      },
    }
  }
  const { values } = parseArgs({
    args,
    options: {
      'min-open': { type: 'string' },
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

/**
 * The objective one coordinator's department is created with: what intake is,
 * where its work comes from, the ticket schema it writes, and how admission
 * decides. Everything a proposal is measured by is stated here, because it is
 * the whole of what the department is told before its first turn.
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
  const left = exclude.length === 0
    ? ''
    : ` This worktree and that checkout leave out ${exclude.map(dir => `\`${dir}/\``).join(', ')} apart from \`${KEPT_DIRECTORY}/\`; no ticket of yours needs them.`
  return [
    `${seat.name}, roster seat \`${seat.id}\`: intake for the package group under \`${subsystem}\`.`,
    `Your function is intake: find at most ${maxTickets} small, real pieces of work in \`${subsystem}\` and write each one up as a ticket one implementer can finish in under thirty minutes. You change no code yourself.`,
    'Work comes from, in order of preference: a bullet under a package README\'s `## Known Limitations and Deferred Work` that the tree can now resolve; a `TODO`, `FIXME` or `XXX` marker under a package\'s `src/`; a deferred item of a proposed Agent Note under `.agents/notes/proposed/` that names one of these packages; a README or JSDoc statement the code no longer matches; a fragile or skipped test. Read the code behind every candidate before you write it up, and drop anything larger than one small change or that no command can check.',
    `Write the tickets as one JSON array to \`${proposalsPath(seat.id)}\` at the root of this worktree, then \`git add\` and \`git commit\` it before you stop: only committed work is measured. Every element carries exactly these fields: \`id\` ("${first}", then the next ids in order; admission renumbers what it admits so the queue stays gap-free), \`title\` (one line naming the change), \`division\` and \`seat\` (the roster seat whose source covers every path in \`scope\`: for anything under \`${subsystem}\` that is \`${seat.id}\` in division \`${seat.division}\`), \`kind\` (fix, test, docs, feature or chore), \`source\` (\`{ "path", "anchor" }\`: the file the work comes from and text copied verbatim from it, such as the bullet, marker or heading), \`task\` (the problem with its evidence cited as \`path:line\`, the required behaviour, the repository rules that constrain it, and what not to touch), \`scope\` (the path prefixes the change may touch, one package written with a trailing slash), \`acceptance\`, \`budget\` (\`{ "maxTotalTokens": 8000000, "maxWallMs": 2700000 }\`) and \`priority\` (1 to 3).`,
    '`acceptance` is a list of `{ "id", "run" }`: `id` a lower-case slug, `run` one shell command run at the repository root, exit 0 meaning pass. It holds the ticket\'s own checks, each keyless, fast (seconds), and failing on the current tree because it asserts what the change adds or removes (`test -f <new spec> && pnpm exec vitest run <new spec>`, `grep -q \'<new text>\' <file>`, `! grep -q \'<removed symbol>\' <file>`); and beside them the package\'s per-file coverage run (`pnpm exec vitest run <package>/ --coverage --coverage.include=\'<package>/src/**/*.ts\'`), `pnpm run typecheck`, and `pnpm run doc-sync` when the change touches documentation.',
    `\`${tip}\` is a clean checkout of this tree with its dependencies installed: run each check of your own there before you commit, keep only tickets whose own checks all fail there, and change nothing in it. Do not run the typecheck, doc-sync or coverage commands anywhere: they pass on this tree by the queue's rules, take minutes, and admission does not run them.${left}`,
    filed.length === 0
      ? 'The queue holds no open or shipped ticket in this package group.'
      : `The queue already holds tickets from these sources; a proposal repeating a source path and its anchor is refused: ${filed.join('; ')}.`,
    'Admission reads your committed file ticket by ticket and refuses a ticket that breaks the schema, names a seat whose source does not cover its scope, repeats the source path and anchor of an open or shipped ticket, carries no check of its own, or has a check of its own that already passes on the clean checkout. If you are told every ticket was refused, fix or replace them, commit again, and stop.',
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

/**
 * The command a department's verifier runs in its worktree: the `admit` form
 * over its committed proposals.
 * @param seat - the coordinator seat.
 * @param options - the intake's options.
 * @param tip - the clean checkout.
 * @returns one shell command line.
 */
export function admissionCommand(seat: string, options: IntakeOptions, tip: string): string {
  return [
    join(REPO_ROOT, 'node_modules/.bin/tsx'),
    join(REPO_ROOT, 'scripts/enterprise-intake.ts'),
    'admit',
    '--root', options.root,
    '--tip', tip,
    '--seat', seat,
    '--proposals', proposalsPath(seat),
    '--max-tickets', String(options.maxTickets),
    '--check-timeout-ms', String(options.checkTimeoutMs),
  ].join(' ')
}

/**
 * The intake program: one department per coordinator whose one check is
 * admission, and an integration gated on a clean merged tree.
 * @param selected - the coordinators, in selection order.
 * @param queue - the queue.
 * @param options - the intake's options.
 * @param base - the commit every worktree starts from.
 * @param tip - the clean checkout.
 * @returns the plan.
 */
export function intakePlan(selected: readonly Coordinator[], queue: Queue, options: IntakeOptions, base: string, tip: string): IntakePlan {
  return {
    objective: `intake: the ${selected.map(coordinator => coordinator.seat.id).join(', ')} coordinators propose tickets for their package groups`,
    baseRevision: base,
    departments: selected.map(coordinator => ({
      key: coordinator.seat.id,
      objective: coordinatorObjective(coordinator, queue, options, tip),
      checks: [{
        id: ADMISSION_CHECK,
        outcome: 'admission admits at least one of the committed proposals',
        run: admissionCommand(coordinator.seat.id, options, tip),
      }],
    })),
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

/** What the function line of one coordinator states, and why. */
export type FunctionOutcome = 'pass' | 'fail' | 'error'

/** One coordinator's part of the run, as the record states it. */
export interface CoordinatorRecord {
  readonly seat: string
  readonly subsystem: string
  readonly openInSubsystem: number
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

/**
 * The ledger outcome of one coordinator: `pass` when admission admitted a
 * ticket of its, `error` when its department was cut before it could finish
 * (a route limit, a spent budget, or no department at all), and `fail` when it
 * ran to its end and nothing was admitted.
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
  seat: string,
  revision: string | undefined,
  base: string,
): { text: string; revision: string } | undefined {
  const branch = `program/${programId}/${seat}`
  const head = revision ?? spawnSync('git', ['rev-parse', '--verify', '--quiet', branch], { cwd: repo, encoding: 'utf8' }).stdout.trim()
  if (head === '' || head === base) return undefined
  const shown = spawnSync('git', ['show', `${head}:${proposalsPath(seat)}`], { cwd: repo, encoding: 'utf8' })
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
  if (open.length >= options.minOpen) {
    writeJson(join(recordDir, 'result.json'), {
      type: 'intake', id, shift, at, target: { commit: head }, outcome: 'nothing-needed', open: open.length, minOpen: options.minOpen,
    })
    log(`${open.length} open tickets, at least ${options.minOpen}: nothing needed; recorded ${record}/result.json`)
    process.stdout.write(`${JSON.stringify({ type: 'intake', id, record, outcome: 'nothing-needed', open: open.length })}\n`)
    return 0
  }
  const roster = readRoster(options.root)
  const selected = selectCoordinators(coordinators(roster, options.root, open), options.coordinators, options.count)
  if (selected.length === 0) throw new Error('no Program Departments coordinator is selected')
  log(`${open.length} open tickets, below ${options.minOpen}: ${selected.map(coordinator => `${coordinator.seat.id} (${coordinator.open.length} open)`).join(', ')}`)
  const run = join(options.scratch, `intake-${at.slice(0, 10)}-${id}`)
  const { repo, tip } = prepare(options, run, head)
  const plan = intakePlan(selected, queue, options, head, tip)
  writeFileSync(join(run, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`)
  log(`running the intake program in ${run}`)
  const result = await runDriver(options, run, repo)
  const limit = result.routeLimit
  const runCheck = shellCheckRunner({ tip, commit: head, timeoutMs: options.checkTimeoutMs, outputChars: OUTPUT_CHARS })
  const tipRoster = readRoster(tip)
  const admitted: Ticket[] = []
  const records: CoordinatorRecord[] = []
  for (const coordinator of [...selected].sort((left, right) => (left.seat.id < right.seat.id ? -1 : 1))) {
    const seat = coordinator.seat.id
    const goal = result.report.goals.find(candidate => candidate.key === seat)
    const member = result.members.find(candidate => candidate.key === seat)
    const status = goal?.status ?? 'pending'
    const certified = status === 'certified' || status === 'merged'
    const committed = committedProposals(repo, result.report.programId, seat, certified ? goal?.revision : undefined, head)
    const admissionStarted = performance.now()
    const proposals = committed === undefined ? { value: null } : parseProposals(committed.text)
    let admission: Admission = { verdicts: [] }
    if ('error' in proposals) {
      admission = { verdicts: [], error: proposals.error }
    } else if (committed !== undefined) {
      admission = await admitProposals(proposals.value, options.maxTickets, { roster: tipRoster, tip, queue, admitted, runCheck })
      if (!certified) admission = uncertified(admission)
    }
    const mine = admission.verdicts.flatMap(verdict => (verdict.ticket === undefined ? [] : [verdict.ticket]))
    admitted.push(...mine)
    const limited = limit !== undefined && limit.sessionId === member?.sessionId
    const ran = member !== undefined && !(result.walled.includes(member.sessionId) && !limited)
    const endedAt = member?.endedAt ?? null
    records.push({
      seat,
      subsystem: coordinator.subsystem,
      openInSubsystem: coordinator.open.length,
      department: {
        status,
        ...goal?.reason === undefined ? {} : { reason: goal.reason },
        ...member === undefined ? {} : { sessionId: member.sessionId },
        ...committed === undefined ? {} : { revision: committed.revision },
        ...endedAt === null ? {} : { endedAt: new Date(endedAt).toISOString() },
        tokens: member?.tokens ?? 0,
        seconds: spanSeconds(member?.startedAt ?? null, endedAt) + Math.round((performance.now() - admissionStarted) / 1000),
      },
      ran,
      outcome: functionOutcome(status, mine.map(ticket => ticket.id), limited),
      admitted: mine.map(ticket => ticket.id),
      proposals: 'error' in proposals ? committed?.text ?? null : proposals.value,
      admission,
    })
    for (const verdict of admission.verdicts) log(`${seat}: ${describeVerdict(verdict)}`)
    if (admission.error !== undefined) log(`${seat}: ${admission.error}`)
  }
  for (const ticket of admitted) writeFileSync(join(options.root, TICKETS_DIR, `${ticket.id}.json`), formatTicket(ticket))
  const hits: Record<string, number> = {}
  const sessions = copySessions(join(run, '.sessions'), join(recordDir, 'sessions'), hits)
  for (const entry of records) addHits(hits, writeJson(join(recordDir, `${entry.seat}.json`), entry))
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
    maxTickets: options.maxTickets,
    composition: relative(REPO_ROOT, options.composition),
    program: {
      programId: result.report.programId,
      outcome: result.report.outcome ?? null,
      mergedRevision: result.report.mergedRevision ?? null,
    },
    ...limit === undefined ? {} : { routeLimit: routeLimitRecord(limit) },
    coordinators: records.map(entry => ({
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
      refused: entry.admission.verdicts
        .filter((verdict: Verdict) => !verdict.admitted)
        .map(verdict => ({ index: verdict.index, code: verdict.code, reason: verdict.reason })),
    })),
    admitted: admitted.map(ticket => ticket.id),
    sessions,
    masked: hits,
  }))
  const ledger = join(options.root, LEDGER_PATH)
  mkdirSync(dirname(ledger), { recursive: true })
  for (const entry of records.filter(candidate => candidate.ran)) {
    appendFileSync(ledger, functionLine({
      at: entry.department.endedAt ?? at,
      shift,
      seat: entry.seat,
      division: selected.find(coordinator => coordinator.seat.id === entry.seat)?.seat.division ?? '',
      commit: head,
      outcome: entry.outcome,
      evidence: `${record}/${entry.seat}.json`,
      seconds: entry.department.seconds,
    }))
  }
  if (!options.keep) rmSync(run, { recursive: true, force: true })
  log(`admitted ${admitted.length === 0 ? 'nothing' : admitted.map(ticket => ticket.id).join(', ')}; recorded ${record}`)
  process.stdout.write(`${JSON.stringify({ type: 'intake', id, record, outcome, admitted: admitted.map(ticket => ticket.id), coordinators: records.map(entry => ({ seat: entry.seat, outcome: entry.outcome, ran: entry.ran, admitted: entry.admitted, tokens: entry.department.tokens, seconds: entry.department.seconds })) })}\n`)
  if (limit === undefined) return 0
  const reset = limit.resetsAt === undefined ? '' : `; its limit lifts at ${new Date(limit.resetsAt).toISOString()}`
  process.stderr.write(`enterprise-intake: route ${limit.provider}/${limit.model} stopped at its limit: ${limit.message}${reset}\n`)
  return ROUTE_LIMIT_EXIT_CODE
}

/**
 * One department's verifier: admit the proposals it committed, print one line
 * per proposal, and pass when at least one is admitted.
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
  const commit = git(['rev-parse', 'HEAD'], options.tip)
  const admission = await admitProposals(proposals, options.maxTickets, {
    roster: readRoster(options.tip),
    tip: options.tip,
    queue: readQueue(options.root),
    admitted: [],
    runCheck: shellCheckRunner({ tip: options.tip, commit, timeoutMs: options.checkTimeoutMs, outputChars: 600 }),
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
