/**
 * Thin CLI wrapper around the Proving Ground bench drivers and tools: path
 * resolution, argument validation, a `run.log` banner, and process execution.
 * It adds no scoring, folding, or registry logic of its own — every
 * subcommand delegates to the driver or tool that already owns that
 * behavior (`examples/headless-agent/tests/fixtures/proving-ground-bench/`
 * and `data/proving-ground/tools/`).
 *
 *   pnpm run bench -- <subcommand> [options]
 *
 * Run `pnpm run bench -- --help` for the subcommand list.
 */
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, createWriteStream, existsSync, readdirSync, readFileSync } from 'node:fs'
import { copyFile, mkdir } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'

export const REPO_ROOT = resolve(import.meta.dirname, '..')
export const BENCH_DIR = join(REPO_ROOT, 'examples/headless-agent/tests/fixtures/proving-ground-bench')
export const PLANS_DIR = join(BENCH_DIR, 'plans')
export const OVERLAYS_DIR = join(BENCH_DIR, 'overlays')
export const BASE_COMPOSITION = join(BENCH_DIR, 'cordis.yml')
export const RUNS_ROOT = join(REPO_ROOT, '.proving-ground/runs')
export const TOOLS_DIR = join(REPO_ROOT, 'data/proving-ground/tools')

const OVERLAY_SUFFIX = '.cordis.yml'
const PLAN_SUFFIX = '.json'

/** Fail loudly if a locally closed union gains an unhandled member. */
function assertNever(value: never): never {
  throw new TypeError(`proving-ground: unhandled command kind ${JSON.stringify(value)}`)
}

/**
 * Overlay names under `overlays/`, without their `.cordis.yml` suffix, sorted.
 * @param overlaysDir - directory holding the named overlay compositions.
 * @returns the available overlay names.
 */
export function listOverlayNames(overlaysDir: string = OVERLAYS_DIR): string[] {
  return readdirSync(overlaysDir)
    .filter(entry => entry.endsWith(OVERLAY_SUFFIX))
    .map(entry => entry.slice(0, -OVERLAY_SUFFIX.length))
    .sort()
}

/**
 * Resolve an `--overlay <name>` value to a composition path.
 * @param name - overlay name as given on the command line, or undefined for the base composition.
 * @param overlaysDir - directory holding the named overlay compositions.
 * @param baseComposition - the fixture's own composition, used when `name` is undefined.
 * @returns the absolute composition path.
 */
export function resolveOverlayPath(
  name: string | undefined,
  overlaysDir: string = OVERLAYS_DIR,
  baseComposition: string = BASE_COMPOSITION,
): string {
  if (name === undefined) return baseComposition
  const names = listOverlayNames(overlaysDir)
  if (!names.includes(name)) throw new Error(`unknown overlay '${name}'; expected one of ${names.join(' | ')}`)
  return join(overlaysDir, `${name}${OVERLAY_SUFFIX}`)
}

/**
 * Checked-in plan names under `plans/`, without their `.json` suffix, sorted.
 * @param plansDir - directory holding checked-in plan fixtures.
 * @returns the available plan names.
 */
export function listPlanNames(plansDir: string = PLANS_DIR): string[] {
  return readdirSync(plansDir)
    .filter(entry => entry.endsWith(PLAN_SUFFIX))
    .map(entry => entry.slice(0, -PLAN_SUFFIX.length))
    .sort()
}

/**
 * Resolve a `<plan>` argument to a JSON file path: a checked-in plan name
 * resolves under `plans/`, anything else is a path resolved against `cwd`.
 * @param planArg - a checked-in plan name or a path to a plan JSON file.
 * @param plansDir - directory holding checked-in plan fixtures.
 * @param cwd - directory a path argument resolves against.
 * @returns the absolute plan file path.
 */
export function resolvePlanPath(planArg: string, plansDir: string = PLANS_DIR, cwd: string = process.cwd()): string {
  const named = join(plansDir, `${planArg}${PLAN_SUFFIX}`)
  if (existsSync(named)) return named
  const asGiven = resolve(cwd, planArg)
  if (existsSync(asGiven)) return asGiven
  const available = listPlanNames(plansDir)
  throw new Error(`unknown plan '${planArg}'; expected a checked-in plan (${available.join(' | ')}) or a path to a JSON file`)
}

/**
 * UTC timestamp safe for a directory name.
 * @param date - the instant to format.
 * @returns a compact timestamp, e.g. `20260918T211530Z`.
 */
export function formatUtcTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

/**
 * Default `--out` directory for a fleet or experiment run.
 * @param planName - the resolved plan file's base name, without `.json`.
 * @param date - the run's start time.
 * @param runsRoot - the directory every run directory is created under.
 * @returns the run directory's absolute path.
 */
export function resolveOutDir(planName: string, date: Date, runsRoot: string = RUNS_ROOT): string {
  return join(runsRoot, `${planName}-${formatUtcTimestamp(date)}`)
}

/**
 * One banner line recording a run's identity, appended to `run.log` before its driver starts.
 * @param date - the run's start time.
 * @param planLabel - the plan's base name.
 * @param overlayLabel - the overlay name, or `'base'` for the fixture's own composition.
 * @param head - the repository's short commit SHA at run time.
 * @returns the banner line, including its trailing newline.
 */
export function formatRunBanner(date: Date, planLabel: string, overlayLabel: string, head: string): string {
  return `=== ${date.toISOString()} plan=${planLabel} overlay=${overlayLabel} head=${head} ===\n`
}

/** Render a plan field for a `describePlan` line: primitives directly, anything else as JSON. */
function formatScalar(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? value.toString()
    : JSON.stringify(value)
}

function formatImplementer(implementer: unknown): string {
  if (typeof implementer !== 'object' || implementer === null) return String(implementer)
  const fields = implementer as Record<string, unknown>
  return ['kind', 'provider', 'label']
    .map(key => fields[key])
    .filter((value): value is string => typeof value === 'string')
    .join('/')
}

function formatArm(arm: unknown): string {
  if (typeof arm !== 'object' || arm === null) return String(arm)
  const fields = arm as Record<string, unknown>
  const parts = [`${formatScalar(fields.provider)}/${formatScalar(fields.model)}`]
  if (Array.isArray(fields.ladder)) parts.push(`ladder×${fields.ladder.length}`)
  if (fields.implementer !== undefined) parts.push(`implementer=${formatImplementer(fields.implementer)}`)
  return parts.join(' ')
}

/**
 * One-line description of a plan file, parsed from its own JSON fields
 * (name, tier, heldOut, repetitions, seed, models or arms, implementer,
 * ladder) rather than validated against the drivers' stricter types, since
 * this line is a display aid and the driver that runs the plan is what
 * enforces its shape.
 * @param fileName - the plan file's base name, without `.json`.
 * @param plan - the parsed plan JSON.
 * @returns the one-line summary `bench plans` prints for this file.
 */
export function describePlan(fileName: string, plan: Record<string, unknown>): string {
  const label = typeof plan.name === 'string' && plan.name !== fileName ? `${fileName} (${plan.name})` : fileName
  const fields: string[] = []
  if (plan.tier !== undefined) fields.push(`tier=${formatScalar(plan.tier)}`)
  fields.push(`heldOut=${formatScalar(plan.heldOut ?? false)}`)
  fields.push(`repetitions=${formatScalar(plan.repetitions)}`)
  if (plan.seed !== undefined) fields.push(`seed=${formatScalar(plan.seed)}`)
  if (plan.domain !== undefined) fields.push(`domain=${formatScalar(plan.domain)}`)
  if (Array.isArray(plan.models)) fields.push(`models=[${plan.models.map(formatArm).join(', ')}]`)
  if (plan.baseline !== undefined) fields.push(`baseline=${formatArm(plan.baseline)}`)
  if (plan.candidate !== undefined) fields.push(`candidate=${formatArm(plan.candidate)}`)
  if (plan.implementer !== undefined) fields.push(`implementer=${formatImplementer(plan.implementer)}`)
  if (Array.isArray(plan.ladder)) fields.push(`ladder×${plan.ladder.length}`)
  if (plan.district !== undefined) fields.push(`district=${formatScalar(plan.district)}`)
  return `${label}: ${fields.join(' ')}`
}

/**
 * One description line per checked-in plan, sorted by file name.
 * @param plansDir - directory holding checked-in plan fixtures.
 * @returns one `describePlan` line per `plans/*.json` file.
 */
export function formatPlansListing(plansDir: string = PLANS_DIR): string[] {
  return listPlanNames(plansDir).map((name) => {
    const plan = JSON.parse(readFileSync(join(plansDir, `${name}${PLAN_SUFFIX}`), 'utf8')) as Record<string, unknown>
    return describePlan(name, plan)
  })
}

/** Fields `registry-driver.ts` prints as its one JSON summary line. */
export interface RegistrySummary {
  readonly type: string
  readonly total: number
  readonly heldOut: number
  readonly tiers: Record<string, number>
  readonly domains: Record<string, number>
  readonly withReference: number
  readonly cases: Record<string, number[]>
  readonly ids: string[]
}

/**
 * Narrow a registry summary to the fields `--tier`/`--held-out` asked for.
 * The driver has no per-environment tier or heldOut listing to filter — only
 * the aggregate counts it already computed — so this selects fields rather
 * than filtering `ids`.
 * @param summary - the driver's parsed JSON summary.
 * @param filters - the requested tier and heldOut narrowing.
 * @returns the full summary when neither filter is given, else the requested fields.
 */
export function selectRegistrySummary(
  summary: RegistrySummary,
  filters: { readonly tier: number | undefined; readonly heldOut: boolean },
): unknown {
  if (filters.tier === undefined && !filters.heldOut) return summary
  const selected: Record<string, unknown> = { type: summary.type, total: summary.total }
  if (filters.tier !== undefined) selected.tier = { value: filters.tier, count: summary.tiers[String(filters.tier)] ?? 0 }
  if (filters.heldOut) selected.heldOut = summary.heldOut
  return selected
}

export const USAGE = `Usage: pnpm run bench -- <subcommand> [options]

  plans                                               list checked-in plans
  environments [--tier <n>] [--held-out]              list registered environments
  fleet <plan> [--overlay <name>] [--out <dir>]       run a fleet plan
  experiment <plan> [--overlay <name>] [--out <dir>]  run a frozen paired experiment
  fold <baseline.json> <candidate.json> <out.json> [minimumDelta] [resamples]
  record <run dir> <name> --composition <path> [--elapsed-seconds <n>]
  summarize <dir> [--json]
  census <record> [--json]
  admit [<environments-dir>]

<plan> is a checked-in plan name under examples/headless-agent/tests/fixtures/proving-ground-bench/plans/, or a path to a JSON file.
--overlay is one of the composition overlays under .../overlays/, without its .cordis.yml suffix; omit it for the fixture's base cordis.yml.
`

/** One parsed `bench` invocation. */
export type BenchCommand =
  | { readonly kind: 'help' }
  | { readonly kind: 'plans' }
  | { readonly kind: 'environments'; readonly tier: number | undefined; readonly heldOut: boolean }
  | {
    readonly kind: 'fleet' | 'experiment'
    readonly planArg: string
    readonly overlay: string | undefined
    readonly out: string | undefined
  }
  | { readonly kind: 'fold' | 'record' | 'summarize' | 'census' | 'admit'; readonly args: readonly string[] }

/**
 * Parse `pnpm run bench -- <subcommand> …` into a command description. Pure:
 * it neither touches the filesystem nor resolves a plan or overlay name. A
 * leading `--` is stripped first: pnpm's own `run <script> -- <args>`
 * separator is forwarded into `process.argv` verbatim rather than consumed,
 * unlike npm, so it would otherwise be mistaken for the subcommand.
 * @param argv - arguments after the dispatching script, i.e. `process.argv.slice(2)`.
 * @returns the parsed command.
 */
export function parseCommand(argv: readonly string[]): BenchCommand {
  const [sub, ...rest] = argv[0] === '--' ? argv.slice(1) : argv
  if (sub === undefined || sub === '--help' || sub === '-h') return { kind: 'help' }
  switch (sub) {
    case 'plans': {
      if (rest.length > 0) throw new Error(`'plans' takes no arguments, got ${JSON.stringify(rest)}`)
      return { kind: 'plans' }
    }
    case 'environments': {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { tier: { type: 'string' }, 'held-out': { type: 'boolean', default: false } },
      })
      if (positionals.length > 0) throw new Error(`'environments' takes no positional arguments, got ${JSON.stringify(positionals)}`)
      let tier: number | undefined
      if (values.tier !== undefined) {
        tier = Number(values.tier)
        if (!Number.isInteger(tier)) throw new Error(`--tier must be an integer, got ${JSON.stringify(values.tier)}`)
      }
      return { kind: 'environments', tier, heldOut: values['held-out'] }
    }
    case 'fleet':
    case 'experiment': {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { overlay: { type: 'string' }, out: { type: 'string' } },
      })
      const [planArg] = positionals
      if (positionals.length !== 1 || planArg === undefined) {
        throw new Error(`'${sub}' requires exactly one <plan> argument, got ${JSON.stringify(positionals)}`)
      }
      return { kind: sub, planArg, overlay: values.overlay, out: values.out }
    }
    case 'fold':
    case 'record':
    case 'summarize':
    case 'census':
    case 'admit':
      return { kind: sub, args: rest }
    default:
      throw new Error(`unknown subcommand '${sub}'; expected plans | environments | fleet | experiment | fold | record | summarize | census | admit`)
  }
}

function tsxBinary(): string {
  return join(REPO_ROOT, 'node_modules/.bin/tsx')
}

/** Spawn a child process with inherited stdio and resolve its exit code (1 if it was signaled). */
function runInherited(command: string, args: readonly string[], cwd: string = process.cwd()): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' })
    child.on('error', reject)
    child.on('close', (code, signal) => { resolvePromise(signal !== null ? 1 : code ?? 1) })
  })
}

/** Spawn a child process, streaming its stdout/stderr to the terminal and appending both to `runLogPath`. */
function runTeeingToLog(command: string, args: readonly string[], cwd: string, runLogPath: string): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['inherit', 'pipe', 'pipe'] })
    const log = createWriteStream(runLogPath, { flags: 'a' })
    child.stdout.on('data', (chunk: Buffer) => {
      process.stdout.write(chunk)
      log.write(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk)
      log.write(chunk)
    })
    child.on('error', reject)
    child.on('close', (code, signal) => {
      log.end(() => { resolvePromise(signal !== null ? 1 : code ?? 1) })
    })
  })
}

function repositoryHead(): string {
  const result = spawnSync('git', ['-C', REPO_ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`cannot resolve the repository head: ${result.stderr.trim() || result.error?.message || `git exited ${String(result.status)}`}`)
  }
  return result.stdout.trim()
}

async function runFleetOrExperiment(
  kind: 'fleet' | 'experiment',
  planArg: string,
  overlayName: string | undefined,
  outArg: string | undefined,
): Promise<number> {
  const planPath = resolvePlanPath(planArg)
  const compositionPath = resolveOverlayPath(overlayName)
  const planLabel = basename(planPath, PLAN_SUFFIX)
  const now = new Date()
  const outDir = outArg === undefined ? resolveOutDir(planLabel, now) : resolve(process.cwd(), outArg)
  await mkdir(outDir, { recursive: true })
  await copyFile(planPath, join(outDir, 'plan.json'))
  const runLogPath = join(outDir, 'run.log')
  appendFileSync(runLogPath, formatRunBanner(now, planLabel, overlayName ?? 'base', repositoryHead()))
  const driverPath = join(BENCH_DIR, kind === 'fleet' ? 'fleet-driver.ts' : 'experiment-driver.ts')
  const code = await runTeeingToLog(tsxBinary(), [driverPath, compositionPath, 'plan.json'], outDir, runLogPath)
  const compositionRelative = relative(REPO_ROOT, compositionPath)
  process.stdout.write([
    '',
    'proving-ground: next, run:',
    `  pnpm run bench -- summarize ${outDir}`,
    `  pnpm run bench -- record ${outDir} <name> --composition ${compositionRelative}`,
    '',
  ].join('\n'))
  return code
}

function runEnvironments(tier: number | undefined, heldOut: boolean): number {
  const driverPath = join(BENCH_DIR, 'registry-driver.ts')
  const compositionPath = join(OVERLAYS_DIR, 'registry-only.cordis.yml')
  const result = spawnSync(tsxBinary(), [driverPath, compositionPath], { cwd: REPO_ROOT, encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    process.stdout.write(result.stdout)
    process.stderr.write(result.stderr)
    return result.status ?? 1
  }
  const line = result.stdout.trim().split('\n').at(-1)
  if (line === undefined || line === '') throw new Error('registry-driver produced no output')
  const summary = JSON.parse(line) as RegistrySummary
  process.stdout.write(`${JSON.stringify(selectRegistrySummary(summary, { tier, heldOut }), null, 2)}\n`)
  return 0
}

function execute(command: BenchCommand): Promise<number> {
  switch (command.kind) {
    case 'help':
      process.stdout.write(USAGE)
      return Promise.resolve(0)
    case 'plans':
      process.stdout.write(`${formatPlansListing().join('\n')}\n`)
      return Promise.resolve(0)
    case 'environments':
      return Promise.resolve(runEnvironments(command.tier, command.heldOut))
    case 'fleet':
    case 'experiment':
      return runFleetOrExperiment(command.kind, command.planArg, command.overlay, command.out)
    case 'fold':
      return runInherited(tsxBinary(), [join(BENCH_DIR, 'fold-driver.ts'), ...command.args])
    case 'record':
      return runInherited(process.execPath, [join(TOOLS_DIR, 'record-run.mjs'), ...command.args])
    case 'summarize':
      return runInherited(process.execPath, [join(TOOLS_DIR, 'summarize-run.mjs'), ...command.args])
    case 'census':
      return runInherited(process.execPath, [join(TOOLS_DIR, 'census-escapes.mjs'), ...command.args])
    case 'admit':
      return runInherited(process.execPath, [join(BENCH_DIR, 'admit.mjs'), ...command.args])
    default:
      return assertNever(command)
  }
}

if (import.meta.main) {
  try {
    process.exitCode = await execute(parseCommand(process.argv.slice(2)))
  } catch (error) {
    process.stderr.write(`proving-ground: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 2
  }
}
