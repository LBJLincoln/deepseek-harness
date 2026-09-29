/**
 * The functions of the divisions that need no ticket, run on one commit and
 * recorded as function lines in the enterprise ledger
 * (`pnpm run enterprise:functions -- [--commit <sha>] [--shift <id>] [--branch <name>] [--only <divisions>] [--lock <file>]`):
 *
 * - **Verification**: every verifier seat runs the `verify-*` package script
 *   its `source` names, on the checked-out commit; the gate's output is the
 *   evidence, written under `data/enterprise/functions/<shift>/`.
 * - **Judging**: every judge seat whose CI lane runs on this fork reads its
 *   verdict from the Branch CI run of the commit (GitHub's REST API, read
 *   without credentials, through the proxy `HTTPS_PROXY` names when the
 *   environment names one — Node's `fetch` honours it only under
 *   `NODE_USE_ENV_PROXY=1`, which the package script sets): a job maps to the seat of the gate mode its log
 *   opens with, and a gate group a job's log shows by name
 *   ({@link GATE_GROUPS}) to that group's seat. When no run of the commit
 *   rendered a verdict (it has none, or a newer push superseded it), the first
 *   later run that did whose head contains the commit is read, and its head is
 *   named in `target.via`; when no such run exists yet, the branch's newest
 *   run that did is read, its commit named in `target.commit` and the
 *   asked-for commit in `target.requested`.
 * - **Observatory**: the session-stats observer folds its package's real
 *   `sessionStats` projection unit over the recorded sessions of the last 24
 *   hours and publishes the enterprise's telemetry snapshot,
 *   `data/enterprise/telemetry.json`.
 * - **Curation**: the scorekeeper folds the scorekeeper package's session facts
 *   over every recorded session and refreshes `data/enterprise/scoreboard.json`.
 *
 * A seat gets a line only for a function that really ran; the seats whose
 * function nothing here can perform are reported vacant with the reason
 * ({@link VACANT_REASONS}). Every run appends to the ledger and never rewrites
 * it, so the command is safe to repeat on any later commit; a CI verdict already
 * in the ledger for the same seat and job is not appended twice.
 *
 * @module enterprise-functions
 */

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { foldScoreboard, foldSessionFacts, type ScoreboardRow, type SessionFactsRecord } from '@deepseek-ai/dsh-scorekeeper'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { sessionStatsProjectionDefinition } from '@deepseek-ai/dsh-session-stats/src/projection.ts'
// Type-only: declares the `sessionStats` key of the projection map the unit's view is typed by.
import type {} from '@deepseek-ai/dsh-session-stats/types'

import {
  activeWindow,
  appendLedger,
  LEDGER_PATH,
  ledgerBySeat,
  occupancyByDivision,
  occupancyOf,
  readLedger,
  type ActiveWindow,
  type DivisionOccupancy,
  type FunctionLine,
  type FunctionOutcome,
  type LedgerLine,
} from './enterprise-ledger.ts'
import { ROSTER_PATH, type Roster, type RosterAgentDefinition } from './enterprise-roster.ts'
import { committedRecords } from './roster-evidence.ts'
import { listDirSafe, readJsonlLines, sessionFilesIn, statSafeIsDirectory, typeOf, type SessionLine } from './session-records.ts'

/** The public repository whose Branch CI the judges read. */
export const CI_REPOSITORY = 'LBJLincoln/deepseek-harness'

/** The workflow file whose runs are the judges' verdicts. */
export const CI_WORKFLOW = 'branch-ci.yml'

/** The branch Branch CI runs on; `--branch` names another. */
export const DEFAULT_CI_BRANCH = 'claude/coding-agent-harness-u9l4gt'

/** Where the engine records a shift's session logs; read beside the committed records. */
export const SHIFT_RECORDS = 'data/enterprise/shifts'

/** The telemetry snapshot, relative to the repository root. */
export const TELEMETRY_PATH = 'data/enterprise/telemetry.json'

/** The scoreboard, relative to the repository root. */
export const SCOREBOARD_PATH = 'data/enterprise/scoreboard.json'

/** Where a shift's gate outputs are written, relative to the repository root. */
export const FUNCTIONS_DIR = 'data/enterprise/functions'

/** How much of a gate's output the evidence file keeps: the tail, where a failure states itself. */
const OUTPUT_TAIL_BYTES = 12_000

/** ANSI escape sequences (CSI and two-byte), which gate output carries when a tool ignores `NO_COLOR`. */
const ANSI_ESCAPE = /\u001B(?:\[[0-?]*[ -/]*[@-~]|[@-Z\\-_])/g

/**
 * Gate output as the evidence file keeps it: terminal styling removed and
 * trailing whitespace trimmed from every line, so the file reads plainly and
 * passes the repository's whitespace check.
 * @param output - the captured output.
 * @returns the plain text.
 */
export function plainText(output: string): string {
  return output.replaceAll(ANSI_ESCAPE, '').split('\n').map(line => line.trimEnd()).join('\n')
}

/** The divisions this runner performs functions for. */
export type FunctionDivision = 'verification' | 'judging' | 'observatory' | 'curation-data'

const FUNCTION_DIVISIONS: readonly FunctionDivision[] = ['verification', 'judging', 'observatory', 'curation-data']

/**
 * Gate groups a Branch CI job shows by name, as `run-gates` labels them: the
 * judge of a mode this fork runs no lane for still rules when every gate of
 * its mode ran, by name, inside a lane that does.
 */
export const GATE_GROUPS: Readonly<Record<string, readonly string[]>> = {
  'ci-lint-contracts-ready': ['lint and duplication'],
  'ci-snapshot': ['build', 'test:snapshot'],
  'ci-artifacts': ['build', 'publint', 'node-next types', 'built package invariants', 'built-bin smoke'],
}

/**
 * Verifier gates whose script judges nothing without a build first run the
 * root script that builds and then verifies, as CI's static lane does; the
 * function line still names the gate.
 */
export const VERIFIER_COMMANDS: Readonly<Record<string, string>> = {
  'verify-doc-site-fragments': 'docs:build:mpa',
}

/** Why a seat of these divisions gets no function line from this runner. */
export const VACANT_REASONS: Readonly<Record<string, string>> = {
  'judging-ci-primary': 'the ci-primary lane runs on runner pools this fork does not have; Branch CI runs static, coverage and consumers only',
  'judging-ci-linux-primary': 'the ci-linux-primary lane runs on runner pools this fork does not have',
  'judging-ci-windows-blocking': 'no Windows runner runs on this fork',
  'judging-ci-windows-complete': 'no Windows runner runs on this fork',
  'judging-ci-windows-observational': 'no Windows runner runs on this fork',
  'observatory-session-telemetry-observer': 'the telemetry coordinator hands live session records to a backend sink; no backend runs over committed records',
  'observatory-session-telemetry-otel-observer': 'the OpenTelemetry backend exports to an OTLP collector; none is configured here',
  'observatory-session-projection-observer': 'the projection registry drives units over live sessions; the session-stats unit is folded directly instead',
  'observatory-session-query-observer': 'the session-query provider indexes a running session store; no store runs over committed records',
  'observatory-otel-bench-fixture-observer': 'a fixture the snapshot suite composes, not a function that runs on a commit',
  'curation-data-architecture-curator': 'note curation is ticketed work, not a function of this runner',
  'curation-data-bug-fix-curator': 'note curation is ticketed work, not a function of this runner',
  'curation-data-feature-curator': 'note curation is ticketed work, not a function of this runner',
  'curation-data-process-curator': 'note curation is ticketed work, not a function of this runner',
  'curation-data-simplification-curator': 'note curation is ticketed work, not a function of this runner',
  'curation-data-testing-curator': 'note curation is ticketed work, not a function of this runner',
  'curation-data-fixture-curator': 'fixture curation is ticketed work, not a function of this runner',
}

/** One gate's run: how it ended, what it printed, how long it took. */
export interface GateResult {
  outcome: FunctionOutcome
  output: string
  seconds: number
}

/** Runs one root package script and reports the result; the real runner spawns `pnpm run <script>`. */
export type GateRunner = (script: string) => Promise<GateResult>

/** Reads the GitHub REST API; the real reader fetches `https://api.github.com`. */
export interface GitHubReader {
  /** @param path - API path starting with `/`. @returns the decoded JSON body. */
  json: (path: string) => Promise<unknown>
  /** @param path - API path starting with `/`. @returns the body as text, redirects followed. */
  text: (path: string) => Promise<string>
}

/** Everything one run of the functions reads and writes. */
export interface FunctionsOptions {
  /** Repository root. */
  root: string
  /** The roster whose seats perform the functions. */
  roster: Roster
  /** The commit the functions cover: the checked-out one. */
  commit: string
  shift: string
  /** The branch whose Branch CI runs stand in when no run of the commit rendered a verdict. */
  branch: string
  now: () => Date
  runGate: GateRunner
  github: GitHubReader
  /** The divisions to run; every function division unless narrowed. */
  divisions: ReadonlySet<FunctionDivision>
  /** Record directories, relative to `root`, whose sessions the observers read. */
  records: readonly string[]
  /** The ledger file; {@link LEDGER_PATH} under `root` unless a test names another. */
  ledgerFile: string
  /** Where the snapshot, the scoreboard and the gate outputs are written; `root` unless a test names another. */
  outputRoot: string
}

/** A seat that got no line, and why. */
export interface VacantSeat {
  seat: string
  division: string
  reason: string
}

/** What one run produced. */
export interface FunctionsReport {
  lines: FunctionLine[]
  vacant: VacantSeat[]
  /** The Branch CI run the judges read, when one was found. */
  ciRun?: { id: number; commit: string; url: string }
}

/**
 * The hint appended to an API failure when the environment names a proxy that
 * Node's `fetch` is not reading: it honours `HTTPS_PROXY` only under
 * `NODE_USE_ENV_PROXY=1` or `--use-env-proxy`, and a read that bypasses the
 * proxy goes out unauthenticated from a shared address, where GitHub's limit is
 * soon spent.
 * @returns the hint, or an empty string when no proxy is named or Node reads it.
 */
export function proxyHint(): string {
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy
  if (proxy === undefined || proxy === '') return ''
  if (process.env.NODE_USE_ENV_PROXY === '1' || process.execArgv.includes('--use-env-proxy')) return ''
  return ` (HTTPS_PROXY names ${proxy}, which Node's fetch reads only under NODE_USE_ENV_PROXY=1)`
}

/**
 * Why a judge with a lane on this fork got no line.
 * @param branch - the CI branch.
 * @param ciRun - the run read, when one was.
 * @param failure - the API failure, when the read failed.
 * @returns the reason.
 */
function judgingVacancy(branch: string, ciRun: FunctionsReport['ciRun'], failure: string | undefined): string {
  if (failure !== undefined) return `Branch CI could not be read: ${failure}${proxyHint()}`
  if (ciRun === undefined) return `no Branch CI run on ${branch} has rendered a verdict`
  return 'the run read shows no lane or gate group for this mode'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function seatsOf(roster: Roster, division: string): RosterAgentDefinition[] {
  return roster.agents.filter(agent => agent.division === division)
}

/**
 * Write a file, creating its directory.
 * @param file - absolute path.
 * @param content - the bytes.
 */
function writeOut(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content)
}

function toPosix(path: string): string {
  return path.replaceAll('\\', '/')
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * The gate a verifier seat runs, named by its `source` (`scripts/<gate>.ts`),
 * and the root package script that runs it ({@link VERIFIER_COMMANDS}, else the gate itself).
 * @param seat - the verifier seat.
 * @param scripts - the root `package.json` scripts.
 * @returns the gate and the script to run.
 * @throws when the root `package.json` lacks either, so a seat is never lit by a gate that cannot run.
 */
export function verifierScript(seat: RosterAgentDefinition, scripts: Readonly<Record<string, string>>): { gate: string; command: string } {
  const gate = seat.source.replace(/^scripts\//, '').replace(/\.ts$/, '')
  const command = VERIFIER_COMMANDS[gate] ?? gate
  for (const script of new Set([gate, command])) {
    if (!(script in scripts)) throw new Error(`enterprise-functions: ${seat.id} names ${seat.source}, but package.json has no "${script}" script`)
  }
  return { gate, command }
}

async function runVerification(options: FunctionsOptions): Promise<FunctionLine[]> {
  const pkg = JSON.parse(readFileSync(join(options.root, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }
  const scripts = pkg.scripts ?? {}
  const lines: FunctionLine[] = []
  for (const seat of seatsOf(options.roster, 'verification')) {
    const { gate, command } = verifierScript(seat, scripts)
    const result = await options.runGate(command)
    const at = options.now().toISOString()
    const path = `${FUNCTIONS_DIR}/${options.shift}/${seat.id}.log`
    const output = plainText(result.output)
    const tail = output.length > OUTPUT_TAIL_BYTES ? `…\n${output.slice(-OUTPUT_TAIL_BYTES)}` : output
    const header = `# pnpm run ${command} on ${options.commit} at ${at}: ${result.outcome} (${result.seconds.toFixed(1)}s)`
    writeOut(join(options.outputRoot, path), `${header}\n${tail}${tail.endsWith('\n') || tail.length === 0 ? '' : '\n'}`)
    lines.push({
      type: 'function',
      at,
      shift: options.shift,
      seat: seat.id,
      division: seat.division,
      function: gate,
      target: { commit: options.commit },
      outcome: result.outcome,
      evidence: { path },
      seconds: Number(result.seconds.toFixed(1)),
    })
  }
  return lines
}

/**
 * The process one gate runs as: `pnpm run <script>` through pnpm's JavaScript
 * entrypoint when the runner was itself started by pnpm (shell-free on every
 * host), else the `pnpm` on the path; under `lock`, the same command through
 * util-linux `flock <lock>`, so the gate waits for the lock, holds it while it
 * runs and releases it before the next gate takes it.
 * @param script - the root package script.
 * @param lock - the lock file every heavy command on a shared machine takes; absent to run unlocked.
 * @param env - the process environment, read for `npm_execpath`.
 * @returns the command and its arguments.
 */
export function gateCommand(
  script: string,
  lock: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): { command: string; args: string[] } {
  const execPath = env.npm_execpath
  const direct = execPath === undefined || execPath === ''
    ? { command: 'pnpm', args: ['run', script] }
    : { command: process.execPath, args: [execPath, 'run', script] }
  return lock === undefined ? direct : { command: 'flock', args: [lock, direct.command, ...direct.args] }
}

/**
 * The environment a gate runs under: the runner's own, without colour, and
 * without `NODE_USE_ENV_PROXY`, which only the runner's API reads need and
 * which makes every Node process print an experimental-agent warning into the
 * gate's output.
 * @param env - the runner's environment.
 * @returns the gate's environment.
 */
export function gateEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const { NODE_USE_ENV_PROXY: _proxy, ...rest } = env
  return { ...rest, FORCE_COLOR: '0', NO_COLOR: '1' }
}

/**
 * The real gate runner: `pnpm run <script>` at the repository root with both
 * streams captured, `error` when the process cannot be spawned or exceeds the
 * timeout, `fail` on a non-zero exit. The timeout counts from the spawn, so
 * under `lock` it includes the wait for the lock.
 * @param root - repository root.
 * @param timeoutMs - the wall-clock ceiling of one gate.
 * @param lock - see {@link gateCommand}.
 * @returns the runner.
 */
export function pnpmGateRunner(root: string, timeoutMs: number, lock?: string): GateRunner {
  return script => new Promise<GateResult>((resolvePromise) => {
    const started = performance.now()
    const seconds = (): number => (performance.now() - started) / 1000
    const { command, args } = gateCommand(script, lock)
    const chunks: string[] = []
    let settled = false
    const settle = (outcome: FunctionOutcome, note?: string): void => {
      if (settled) return
      settled = true
      if (note !== undefined) chunks.push(`\n${note}\n`)
      resolvePromise({ outcome, output: chunks.join(''), seconds: seconds() })
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: gateEnvironment() })
    } catch (error) {
      settle('error', `spawn failed: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      settle('error', `timed out after ${timeoutMs} ms`)
    }, timeoutMs)
    child.stdout?.on('data', (data: Buffer) => chunks.push(data.toString('utf8')))
    child.stderr?.on('data', (data: Buffer) => chunks.push(data.toString('utf8')))
    child.on('error', (error) => {
      clearTimeout(timer)
      settle('error', `spawn failed: ${error.message}`)
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (code === 0) settle('pass')
      else if (code === null) settle('error', `ended by ${signal ?? 'an unknown signal'}`)
      else settle('fail', `exit ${code}`)
    })
  })
}

// ---------------------------------------------------------------------------
// Judging
// ---------------------------------------------------------------------------

/** One workflow run, as the REST API lists it and this module reads it. */
interface CiRun {
  id: number
  head_sha: string
  html_url: string
  conclusion: string | null
}

/** A run whose lanes rendered a verdict: success or failure, not a cancelled or skipped run. */
function ruled(run: CiRun): boolean {
  return run.conclusion === 'success' || run.conclusion === 'failure'
}

/** One job of a workflow run. */
interface CiJob {
  id: number
  name: string
  conclusion: string | null
  html_url: string
  started_at: string | null
  completed_at: string | null
}

function readRuns(body: unknown): CiRun[] {
  if (!isRecord(body) || !Array.isArray(body.workflow_runs)) return []
  const runs: CiRun[] = []
  for (const entry of body.workflow_runs) {
    if (!isRecord(entry)) continue
    if (typeof entry.id === 'number' && typeof entry.head_sha === 'string' && typeof entry.html_url === 'string') {
      runs.push({ id: entry.id, head_sha: entry.head_sha, html_url: entry.html_url, conclusion: typeof entry.conclusion === 'string' ? entry.conclusion : null })
    }
  }
  return runs
}

function readJobs(body: unknown): CiJob[] {
  if (!isRecord(body) || !Array.isArray(body.jobs)) return []
  const jobs: CiJob[] = []
  for (const entry of body.jobs) {
    if (!isRecord(entry)) continue
    if (typeof entry.id !== 'number' || typeof entry.name !== 'string' || typeof entry.html_url !== 'string') continue
    jobs.push({
      id: entry.id,
      name: entry.name,
      conclusion: typeof entry.conclusion === 'string' ? entry.conclusion : null,
      html_url: entry.html_url,
      started_at: typeof entry.started_at === 'string' ? entry.started_at : null,
      completed_at: typeof entry.completed_at === 'string' ? entry.completed_at : null,
    })
  }
  return jobs
}

/**
 * @param conclusion - a job's conclusion as GitHub reports it.
 * @returns the verdict: `success` passes, `failure` fails, and any other ending (cancelled, timed out, skipped) rendered none.
 */
export function verdictOf(conclusion: string | null): FunctionOutcome {
  if (conclusion === 'success') return 'pass'
  if (conclusion === 'failure') return 'fail'
  return 'error'
}

/** What one job's log shows: the gate mode it opened with, and each gate label's result. */
export interface JobLog {
  mode?: string
  gates: Map<string, 'pass' | 'fail' | 'skipped'>
}

/**
 * Read a Branch CI job log as `run-gates` wrote it: the mode line
 * (`run-gates: <mode> running N gate(s)`), one `PASS <label>` line per passed
 * gate, and the summary's `- FAILED <label>` and `- SKIPPED <label>` bullets.
 * Every line carries GitHub's leading timestamp, which is dropped.
 * @param text - the log.
 * @returns the mode and the gates by label.
 */
export function parseJobLog(text: string): JobLog {
  const log: JobLog = { gates: new Map() }
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^\S+Z /, '').trimEnd()
    const mode = /^run-gates: (\S+) running \d+ gate\(s\)/.exec(line)
    if (mode?.[1] !== undefined && log.mode === undefined) log.mode = mode[1]
    const passed = /^run-gates: PASS (.+) \(\d+(?:\.\d+)?s\)$/.exec(line)
    if (passed?.[1] !== undefined) log.gates.set(passed[1], 'pass')
    const bullet = /^\s+- (?:NON-BLOCKING )?(FAILED|SKIPPED) (.+) \(\d+(?:\.\d+)?s, /.exec(line)
    if (bullet?.[1] !== undefined && bullet[2] !== undefined) log.gates.set(bullet[2], bullet[1] === 'FAILED' ? 'fail' : 'skipped')
  }
  return log
}

/**
 * The verdict of a gate group from the gates a log shows by name.
 * @param labels - the group's gate labels.
 * @param gates - the log's gates by label.
 * @returns `pass` when every gate passed, `fail` when one failed, `error` when one was skipped,
 *   `undefined` when one is absent from the log.
 */
export function groupVerdict(labels: readonly string[], gates: JobLog['gates']): FunctionOutcome | undefined {
  const results = labels.map(label => gates.get(label))
  if (results.some(result => result === undefined)) return undefined
  if (results.includes('fail')) return 'fail'
  if (results.includes('skipped')) return 'error'
  return 'pass'
}

function secondsBetween(from: string | null, to: string | null): number {
  if (from === null || to === null) return 0
  const ms = Date.parse(to) - Date.parse(from)
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms / 1000) : 0
}

/**
 * How GitHub compares a commit with a run's head: `ahead` and `identical` mean
 * the head's history contains the commit, `behind` that the head is an
 * ancestor of it, and `diverged` that neither contains the other.
 * @param github - the API reader.
 * @param commit - the commit asked about.
 * @param head - the run's head.
 * @returns the comparison's `status`, or `unknown` when the answer states none.
 */
async function comparison(github: GitHubReader, commit: string, head: string): Promise<string> {
  const body = await github.json(`/repos/${CI_REPOSITORY}/compare/${commit}...${head}`)
  return isRecord(body) && typeof body.status === 'string' ? body.status : 'unknown'
}

/**
 * Select the Branch CI run the judges read. A cancelled run (a newer push
 * supersedes a run still waiting for its turn) rendered no verdict and is
 * passed over.
 *
 * - `exact`: the commit's newest run that rendered a verdict;
 * - `later`: else the first later run that did whose head's history contains
 *   the commit, so the verdict covers it through that head;
 * - `branch`: else the branch's newest run that did, a verdict on another
 *   commit that does not cover the asked-for one.
 *
 * The branch's runs are compared newest first, and the scan stops at the first
 * head older than the commit: the branch only moves forward, so every run
 * listed after that one is older too.
 * @param options - the run options.
 * @returns the run and how it relates to the commit, or `undefined` when the branch has no ruled run.
 */
async function selectCiRun(options: FunctionsOptions): Promise<{ run: CiRun; basis: 'exact' | 'later' | 'branch' } | undefined> {
  const base = `/repos/${CI_REPOSITORY}/actions/workflows/${CI_WORKFLOW}/runs`
  const own = readRuns(await options.github.json(`${base}?head_sha=${options.commit}&status=completed&per_page=10`)).find(ruled)
  if (own !== undefined) return { run: own, basis: 'exact' }
  const branch = readRuns(await options.github.json(`${base}?branch=${encodeURIComponent(options.branch)}&status=completed&per_page=100`)).filter(ruled)
  let later: CiRun | undefined
  for (const run of branch) {
    const status = await comparison(options.github, options.commit, run.head_sha)
    if (status === 'behind') break
    if (status === 'ahead' || status === 'identical') later = run
  }
  if (later !== undefined) return { run: later, basis: 'later' }
  const newest = branch[0]
  return newest === undefined ? undefined : { run: newest, basis: 'branch' }
}

/** The ledger target of a verdict read from `run`, labelled with how the run relates to the asked-for commit. */
function judgedTarget(commit: string, run: CiRun, basis: 'exact' | 'later' | 'branch'): FunctionLine['target'] {
  if (basis === 'exact') return { commit: run.head_sha }
  if (basis === 'later') return { commit, via: run.head_sha }
  return { commit: run.head_sha, requested: commit }
}

async function runJudging(options: FunctionsOptions, existing: readonly LedgerLine[]): Promise<{ lines: FunctionLine[]; ciRun?: FunctionsReport['ciRun'] }> {
  const selected = await selectCiRun(options)
  if (selected === undefined) return { lines: [] }
  const { run, basis } = selected
  const target = judgedTarget(options.commit, run, basis)
  const judges = new Map(seatsOf(options.roster, 'judging').map(seat => [seat.specialization ?? '', seat]))
  const recorded = new Set(existing.flatMap(line =>
    line.type === 'function' && 'url' in line.evidence ? [`${line.seat} ${line.evidence.url}`] : []))
  const lines: FunctionLine[] = []
  const place = (mode: string, outcome: FunctionOutcome, job: CiJob): void => {
    const seat = judges.get(mode)
    if (seat === undefined || recorded.has(`${seat.id} ${job.html_url}`)) return
    recorded.add(`${seat.id} ${job.html_url}`)
    lines.push({
      type: 'function',
      at: job.completed_at === null ? options.now().toISOString() : new Date(job.completed_at).toISOString(),
      shift: options.shift,
      seat: seat.id,
      division: seat.division,
      function: mode,
      target,
      outcome,
      evidence: { url: job.html_url },
      seconds: secondsBetween(job.started_at, job.completed_at),
    })
  }
  const jobs = readJobs(await options.github.json(`/repos/${CI_REPOSITORY}/actions/runs/${run.id}/jobs?per_page=100`))
  for (const job of jobs) {
    const log = parseJobLog(await options.github.text(`/repos/${CI_REPOSITORY}/actions/jobs/${job.id}/logs`))
    if (log.mode === undefined) continue
    place(log.mode, verdictOf(job.conclusion), job)
    for (const [mode, labels] of Object.entries(GATE_GROUPS)) {
      if (mode === log.mode) continue
      const verdict = groupVerdict(labels, log.gates)
      if (verdict !== undefined) place(mode, verdict, job)
    }
  }
  return { lines, ciRun: { id: run.id, commit: run.head_sha, url: run.html_url } }
}

/**
 * The real reader: unauthenticated requests to `https://api.github.com`, the
 * environment's proxy applied by `fetch`.
 * @returns the reader.
 */
export function githubReader(): GitHubReader {
  const headers = { 'Accept': 'application/vnd.github+json', 'User-Agent': 'deepseek-harness enterprise-functions' }
  const get = async (path: string): Promise<Response> => {
    const response = await fetch(`https://api.github.com${path}`, { headers })
    if (!response.ok) throw new Error(`enterprise-functions: GET ${path} answered ${response.status}`)
    return response
  }
  return {
    json: async path => (await get(path)).json() as Promise<unknown>,
    text: async path => (await get(path)).text(),
  }
}

// ---------------------------------------------------------------------------
// Observatory and the scorekeeper
// ---------------------------------------------------------------------------

/** One recorded session as the folds read it. */
interface RecordedSession {
  record: string
  file: string
  header: SessionHeader
  events: SessionEvent[]
  /** Epoch milliseconds of the newest event, else the header's `createdAt`. */
  lastSeenMs: number
}

/**
 * Read one session file into the header and events the package folds take.
 * The file is a durable-format boundary: a line without a string `type`, a
 * numeric `seq` and `time` and an object `data` is not an event and is left out.
 * @param lines - the decoded file.
 * @param fallbackId - the id used when the header carries none.
 * @returns the session, or `undefined` for a file with no header and no events.
 */
function readSession(
  lines: readonly SessionLine[],
  fallbackId: string,
): { header: SessionHeader; events: SessionEvent[]; lastSeenMs: number } | undefined {
  const headerLine = lines.find(line => typeOf(line) === 'session')
  const events: SessionEvent[] = []
  let lastSeenMs = typeof headerLine?.createdAt === 'number' ? headerLine.createdAt : 0
  for (const line of lines) {
    const type = typeOf(line)
    if (type === undefined || type === 'session') continue
    if (typeof line.seq !== 'number' || typeof line.time !== 'number' || !isRecord(line.data)) continue
    events.push(line as unknown as SessionEvent)
    if (line.time > lastSeenMs) lastSeenMs = line.time
  }
  if (headerLine === undefined && events.length === 0) return undefined
  const header = {
    version: typeof headerLine?.version === 'number' ? headerLine.version : 0,
    id: typeof headerLine?.id === 'string' ? headerLine.id : fallbackId,
    createdAt: typeof headerLine?.createdAt === 'number' ? headerLine.createdAt : lastSeenMs,
    ...typeof headerLine?.cwd === 'string' ? { cwd: headerLine.cwd } : {},
    ...typeof headerLine?.parentSession === 'string' ? { parentSession: headerLine.parentSession } : {},
  } as SessionHeader
  return { header, events, lastSeenMs }
}

/**
 * @param root - repository root.
 * @returns the committed records plus every shift record directory under {@link SHIFT_RECORDS}, repository-relative.
 */
export function observedRecords(root: string): string[] {
  const shifts = listDirSafe(join(root, SHIFT_RECORDS))
    .filter(id => statSafeIsDirectory(join(root, SHIFT_RECORDS, id)))
    .map(id => `${SHIFT_RECORDS}/${id}`)
  return [...committedRecords(root), ...shifts.sort()]
}

function readSessions(root: string, records: readonly string[]): RecordedSession[] {
  const sessions: RecordedSession[] = []
  for (const record of records) {
    for (const file of sessionFilesIn(join(root, record))) {
      const relativeFile = toPosix(file.startsWith(root) ? file.slice(root.length).replace(/^[\\/]/, '') : file)
      const session = readSession(readJsonlLines(file), relativeFile)
      if (session !== undefined) sessions.push({ record, file: relativeFile, ...session })
    }
  }
  return sessions
}

/** Token totals summed from the scorekeeper's efficiency facts. */
export interface TokenTotals {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
}

/** The `sessionStats` unit's totals summed over sessions. */
export interface StatsTotals {
  turns: number
  steps: number
  llmMs: number
  toolMs: number
}

/** Figures over one set of sessions. */
export interface SessionFigures {
  sessions: number
  tokens: TokenTotals
  stats: StatsTotals
}

/** The enterprise's telemetry snapshot, `data/enterprise/telemetry.json`. */
export interface TelemetrySnapshot {
  publishedAt: string
  shift: string
  commit: string
  window: ActiveWindow
  /** The record directories read, repository-relative. */
  records: string[]
  /** Sessions whose newest event falls inside the window. */
  inWindow: SessionFigures
  /** Every session of the records. */
  total: SessionFigures
  /** Sessions per record tree, every session counted. */
  sessionsByTree: Record<string, number>
  /** Seats occupied and active per division under the occupancy rule, at `publishedAt`. */
  seats: { occupied: number; active: number; byDivision: DivisionOccupancy[] }
  /** Sessions the scorekeeper fold could not read, with the reason. */
  skipped: { session: string; reason: string }[]
}

/** The refreshed scoreboard, `data/enterprise/scoreboard.json`. */
export interface ScoreboardSnapshot {
  computedAt: string
  shift: string
  commit: string
  records: string[]
  sessions: number
  rows: ScoreboardRow[]
  excluded: number
  unstamped: number
  skipped: { session: string; reason: string }[]
}

function emptyFigures(): SessionFigures {
  return {
    sessions: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
    stats: { turns: 0, steps: 0, llmMs: 0, toolMs: 0 },
  }
}

function addFigures(into: SessionFigures, facts: SessionFactsRecord | undefined, stats: StatsTotals): void {
  into.sessions += 1
  if (facts !== undefined) {
    into.tokens.input += facts.efficiency.inputTokens
    into.tokens.output += facts.efficiency.outputTokens
    into.tokens.cacheRead += facts.efficiency.cacheReadTokens
    into.tokens.cacheWrite += facts.efficiency.cacheWriteTokens
    into.tokens.reasoning += facts.efficiency.reasoningTokens
  }
  into.stats.turns += stats.turns
  into.stats.steps += stats.steps
  into.stats.llmMs += stats.llmMs
  into.stats.toolMs += stats.toolMs
}

/**
 * Fold the `sessionStats` unit over one session's events, as the projection
 * registry would drive it.
 * @param events - the session's events.
 * @returns the unit's view.
 */
export function foldSessionStats(events: readonly SessionEvent[]): StatsTotals {
  const unit = sessionStatsProjectionDefinition
  let state = unit.init()
  for (const event of events) state = unit.apply(state, event)
  const view = unit.view(state)
  return { turns: view.turns, steps: view.steps, llmMs: view.llmMs, toolMs: view.toolMs }
}

/**
 * Seats occupied and active per division, by the occupancy rule, over the
 * roster's session evidence and the given ledger lines.
 * @param roster - the roster.
 * @param ledger - every ledger line, the lines of the running shift included.
 * @param window - the active window.
 * @returns the tallies.
 */
export function seatOccupancy(roster: Roster, ledger: readonly LedgerLine[], window: ActiveWindow): TelemetrySnapshot['seats'] {
  const bySeat = ledgerBySeat(ledger)
  const seats = roster.agents.map(agent => ({
    division: agent.division,
    occupancy: occupancyOf(
      {
        id: agent.id,
        division: agent.division,
        sessions: agent.evidence.sessions,
        ...agent.evidence.lastSeen === undefined ? {} : { lastSeen: agent.evidence.lastSeen },
      },
      bySeat.get(agent.id),
      window,
    ),
  }))
  return {
    occupied: seats.filter(seat => seat.occupancy.occupied).length,
    active: seats.filter(seat => seat.occupancy.active).length,
    byDivision: occupancyByDivision(roster.divisions.map(division => division.id), seats),
  }
}

function runObservatory(options: FunctionsOptions, ledger: readonly LedgerLine[]): FunctionLine[] {
  const started = performance.now()
  const sessions = readSessions(options.root, options.records)
  const now = options.now()
  const window = activeWindow(now.toISOString())
  const since = Date.parse(window.since)
  const facts: SessionFactsRecord[] = []
  const skipped: { session: string; reason: string }[] = []
  const inWindow = emptyFigures()
  const total = emptyFigures()
  const sessionsByTree: Record<string, number> = {}
  for (const session of sessions) {
    let record: SessionFactsRecord | undefined
    try {
      record = foldSessionFacts(session.header, session.events)
      facts.push(record)
    } catch (error) {
      skipped.push({ session: session.file, reason: error instanceof Error ? error.message : String(error) })
    }
    const stats = foldSessionStats(session.events)
    addFigures(total, record, stats)
    if (session.lastSeenMs >= since && session.lastSeenMs <= now.getTime()) addFigures(inWindow, record, stats)
    const tree = session.record.split('/').slice(0, 2).join('/')
    sessionsByTree[tree] = (sessionsByTree[tree] ?? 0) + 1
  }
  const foldSeconds = (performance.now() - started) / 1000
  const lines: FunctionLine[] = []
  const line = (seat: RosterAgentDefinition | undefined, fn: string, path: string, seconds: number): void => {
    if (seat === undefined) return
    lines.push({
      type: 'function',
      at: options.now().toISOString(),
      shift: options.shift,
      seat: seat.id,
      division: seat.division,
      function: fn,
      target: { commit: options.commit },
      outcome: 'pass',
      evidence: { path },
      seconds: Number(seconds.toFixed(1)),
    })
  }
  if (options.divisions.has('observatory')) {
    const snapshot: TelemetrySnapshot = {
      publishedAt: now.toISOString(),
      shift: options.shift,
      commit: options.commit,
      window,
      records: [...options.records],
      inWindow,
      total,
      sessionsByTree: Object.fromEntries(Object.entries(sessionsByTree).sort(([left], [right]) => left.localeCompare(right))),
      seats: seatOccupancy(options.roster, ledger, window),
      skipped,
    }
    writeOut(join(options.outputRoot, TELEMETRY_PATH), `${JSON.stringify(snapshot, null, 2)}\n`)
    line(options.roster.agents.find(agent => agent.id === 'observatory-session-stats-observer'), 'session-stats', TELEMETRY_PATH, foldSeconds)
  }
  if (options.divisions.has('curation-data')) {
    const boardStarted = performance.now()
    const board = foldScoreboard(facts, {}, [1])
    const snapshot: ScoreboardSnapshot = {
      computedAt: options.now().toISOString(),
      shift: options.shift,
      commit: options.commit,
      records: [...options.records],
      sessions: sessions.length,
      rows: [...board.rows],
      excluded: board.excluded,
      unstamped: board.unstamped,
      skipped,
    }
    writeOut(join(options.outputRoot, SCOREBOARD_PATH), `${JSON.stringify(snapshot, null, 2)}\n`)
    line(options.roster.agents.find(agent => agent.id === 'curation-data-scorekeeper'), 'scoreboard', SCOREBOARD_PATH, foldSeconds + (performance.now() - boardStarted) / 1000)
  }
  return lines
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/**
 * Run the functions of the selected divisions and append their lines to the ledger.
 * @param options - what to run, on what, and where to record it.
 * @returns the lines appended, the seats left vacant with the reason, and the CI run read.
 */
export async function runFunctions(options: FunctionsOptions): Promise<FunctionsReport> {
  const existing = readLedger(options.ledgerFile).lines
  const produced: FunctionLine[] = []
  const record = (lines: readonly FunctionLine[]): void => {
    appendLedger(options.ledgerFile, lines)
    produced.push(...lines)
  }
  if (options.divisions.has('verification')) record(await runVerification(options))
  let ciRun: FunctionsReport['ciRun']
  let judgingFailure: string | undefined
  if (options.divisions.has('judging')) {
    try {
      const judged = await runJudging(options, [...existing, ...produced])
      record(judged.lines)
      ciRun = judged.ciRun
    } catch (error) {
      // The API is a network the unattended run cannot fix; the judges stay vacant with the reason and the other divisions still run.
      judgingFailure = error instanceof Error ? error.message : String(error)
    }
  }
  if (options.divisions.has('observatory') || options.divisions.has('curation-data')) {
    record(runObservatory(options, [...existing, ...produced]))
  }
  const lit = new Set(produced.map(line => line.seat))
  const vacant: VacantSeat[] = options.roster.agents
    .filter(agent => options.divisions.has(agent.division as FunctionDivision) && !lit.has(agent.id))
    .map(agent => ({
      seat: agent.id,
      division: agent.division,
      reason: VACANT_REASONS[agent.id] ?? (agent.division === 'judging' ? judgingVacancy(options.branch, ciRun, judgingFailure) : 'its function produced no line'),
    }))
  return ciRun === undefined ? { lines: produced, vacant } : { lines: produced, vacant, ciRun }
}

/** Parsed command line of the CLI. */
export interface CliArguments {
  commit?: string
  shift?: string
  branch?: string
  only?: FunctionDivision[]
  gateTimeoutMs?: number
  /** The lock file each gate takes through `flock`; see {@link gateCommand}. */
  lock?: string
}

/**
 * Read the CLI flags. A bare `--`, which pnpm forwards from
 * `pnpm run enterprise:functions -- --commit <sha>`, separates nothing here and is skipped.
 * @param argv - the arguments after the script path.
 * @returns the flags.
 * @throws on an unknown flag, a flag without its value, or a division this runner has no function for.
 */
export function parseCliArguments(argv: readonly string[]): CliArguments {
  const parsed: CliArguments = {}
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--') continue
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`enterprise-functions: ${flag} needs a value`)
    index += 1
    switch (flag) {
      case '--commit': parsed.commit = value; break
      case '--shift': parsed.shift = value; break
      case '--branch': parsed.branch = value; break
      case '--gate-timeout-ms': parsed.gateTimeoutMs = Number(value); break
      case '--lock': parsed.lock = value; break
      case '--only': {
        const divisions = value.split(',').map(entry => entry.trim())
        for (const division of divisions) {
          if (!(FUNCTION_DIVISIONS as readonly string[]).includes(division)) {
            throw new Error(`enterprise-functions: --only names "${division}"; the function divisions are ${FUNCTION_DIVISIONS.join(', ')}`)
          }
        }
        parsed.only = divisions as FunctionDivision[]
        break
      }
      default: throw new Error(`enterprise-functions: unknown flag ${flag}`)
    }
  }
  return parsed
}

/**
 * The shift id a run gets when none is named: the minute it started, UTC.
 * @param now - the start.
 * @returns the id, such as `2026-09-28T17-20Z`.
 */
export function defaultShift(now: Date): string {
  return `${now.toISOString().slice(0, 16).replace(':', '-')}Z`
}

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${resolve(process.argv[1])}`
if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const flags = parseCliArguments(process.argv.slice(2))
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  if (flags.commit !== undefined && !head.startsWith(flags.commit)) {
    throw new Error(`enterprise-functions: --commit ${flags.commit} is not the checked-out commit ${head}; the gates run on the checkout`)
  }
  const rosterFile = join(root, ROSTER_PATH)
  if (!existsSync(rosterFile)) throw new Error(`enterprise-functions: ${ROSTER_PATH} is missing; run pnpm run roster first`)
  const roster = JSON.parse(readFileSync(rosterFile, 'utf8')) as Roster
  const started = new Date()
  const report = await runFunctions({
    root,
    roster,
    commit: head,
    shift: flags.shift ?? defaultShift(started),
    branch: flags.branch ?? DEFAULT_CI_BRANCH,
    now: () => new Date(),
    runGate: pnpmGateRunner(root, flags.gateTimeoutMs ?? 15 * 60 * 1000, flags.lock),
    github: githubReader(),
    divisions: new Set(flags.only ?? FUNCTION_DIVISIONS),
    records: observedRecords(root),
    ledgerFile: join(root, LEDGER_PATH),
    outputRoot: root,
  })
  for (const line of report.lines) {
    console.log(`enterprise-functions: ${line.outcome.padEnd(5)} ${line.seat} ${line.function} on ${line.target.commit.slice(0, 10)} (${line.seconds}s) -> ${'path' in line.evidence ? line.evidence.path : line.evidence.url}`)
  }
  for (const vacant of report.vacant) console.log(`enterprise-functions: vacant ${vacant.seat}: ${vacant.reason}`)
  console.log(`enterprise-functions: ${report.lines.length} function lines appended to ${LEDGER_PATH}, ${report.vacant.length} seats vacant${report.ciRun === undefined ? '' : `; Branch CI run ${report.ciRun.id} on ${report.ciRun.commit.slice(0, 10)}`}`)
}
