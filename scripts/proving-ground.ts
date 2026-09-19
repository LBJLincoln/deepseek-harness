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
import { appendFileSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { copyFile, mkdir } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'

export const REPO_ROOT = resolve(import.meta.dirname, '..')
export const BENCH_DIR = join(REPO_ROOT, 'examples/headless-agent/tests/fixtures/proving-ground-bench')
export const PLANS_DIR = join(BENCH_DIR, 'plans')
export const OVERLAYS_DIR = join(BENCH_DIR, 'overlays')
export const QUEUES_DIR = join(BENCH_DIR, 'queues')
export const BASE_COMPOSITION = join(BENCH_DIR, 'cordis.yml')
export const RUNS_ROOT = join(REPO_ROOT, '.proving-ground/runs')
export const RECORDS_ROOT = join(REPO_ROOT, 'data/proving-ground')
export const TOOLS_DIR = join(RECORDS_ROOT, 'tools')
export const LEDGER_PATH = join(RECORDS_ROOT, 'loop/ledger.jsonl')

const OVERLAY_SUFFIX = '.cordis.yml'
const PLAN_SUFFIX = '.json'
const QUEUE_SUFFIX = '.json'

/**
 * Fail loudly if a locally closed union gains an unhandled member.
 * @param value - the member no branch handled.
 * @param subject - what the union describes, as the message names it.
 */
function assertNever(value: never, subject: string): never {
  throw new TypeError(`proving-ground: unhandled ${subject} ${JSON.stringify(value)}`)
}

/**
 * A thrown value as a ledger reason or a diagnostic states it.
 * @param error - the caught value.
 * @returns the error's message, or the value itself rendered.
 */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
 * Checked-in queue names under `queues/`, without their `.json` suffix, sorted.
 * @param queuesDir - directory holding checked-in queue files.
 * @returns the available queue names.
 */
export function listQueueNames(queuesDir: string = QUEUES_DIR): string[] {
  return readdirSync(queuesDir)
    .filter(entry => entry.endsWith(QUEUE_SUFFIX))
    .map(entry => entry.slice(0, -QUEUE_SUFFIX.length))
    .sort()
}

/**
 * Resolve a `<queue>` argument to a JSON file path: a checked-in queue name
 * resolves under `queues/`, anything else is a path resolved against `cwd`.
 * @param queueArg - a checked-in queue name or a path to a queue JSON file.
 * @param queuesDir - directory holding checked-in queue files.
 * @param cwd - directory a path argument resolves against.
 * @returns the absolute queue file path.
 */
export function resolveQueuePath(queueArg: string, queuesDir: string = QUEUES_DIR, cwd: string = process.cwd()): string {
  const named = join(queuesDir, `${queueArg}${QUEUE_SUFFIX}`)
  if (existsSync(named)) return named
  const asGiven = resolve(cwd, queueArg)
  if (existsSync(asGiven)) return asGiven
  const available = listQueueNames(queuesDir)
  throw new Error(`unknown queue '${queueArg}'; expected a checked-in queue (${available.join(' | ')}) or a path to a JSON file`)
}

/** One queue entry: the plan to run, the overlay it runs under (`null` for the fixture's own composition), and why it is queued. */
export interface QueueEntry {
  readonly plan: string
  readonly overlay: string | null
  readonly note: string
}

const QUEUE_ENTRY_FIELDS = ['plan', 'overlay', 'note']

/**
 * Parse a queue file: a JSON array of `{ plan, overlay, note }` entries. Every
 * field is required and an unknown field is refused, so a misspelled `overlay`
 * cannot quietly run the base composition instead.
 * @param text - the queue file's contents.
 * @param source - the queue file's path, as the messages name it.
 * @returns the entries in queue order.
 */
export function parseQueue(text: string, source: string): readonly QueueEntry[] {
  const parsed: unknown = JSON.parse(text)
  if (!Array.isArray(parsed)) throw new Error(`queue ${source} must be a JSON array of { plan, overlay, note } entries`)
  const entries = parsed as readonly unknown[]
  if (entries.length === 0) throw new Error(`queue ${source} holds no entry`)
  return entries.map((entry, position) => {
    const at = `queue ${source} entry ${position + 1}`
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) throw new Error(`${at} must be an object`)
    const fields = entry as Record<string, unknown>
    const unknown = Object.keys(fields).filter(key => !QUEUE_ENTRY_FIELDS.includes(key))
    if (unknown.length > 0) throw new Error(`${at} names ${unknown.join(', ')}; a queue entry has exactly ${QUEUE_ENTRY_FIELDS.join(', ')}`)
    const { plan, overlay, note } = fields
    if (typeof plan !== 'string' || plan === '') throw new Error(`${at} needs a non-empty 'plan'`)
    if (overlay !== null && (typeof overlay !== 'string' || overlay === '')) {
      throw new Error(`${at} needs an 'overlay' name, or null for the fixture's base composition`)
    }
    if (typeof note !== 'string' || note === '') throw new Error(`${at} needs a non-empty 'note' saying why it is queued`)
    return { plan, overlay, note }
  })
}

/** Which driver a plan file asks for: a `models` array is a fleet, a `baseline`/`candidate` pair is a frozen experiment. */
export type PlanKind = 'fleet' | 'experiment'

/**
 * Classify a plan file by the arms it declares.
 * @param planLabel - the plan's name, as the message names it.
 * @param plan - the parsed plan JSON.
 * @returns the driver the plan runs under.
 */
export function planKind(planLabel: string, plan: Record<string, unknown>): PlanKind {
  const fleet = Array.isArray(plan.models)
  const experiment = plan.baseline !== undefined && plan.candidate !== undefined
  if (fleet && !experiment) return 'fleet'
  if (experiment && !fleet) return 'experiment'
  const declared = fleet ? 'both a models array and a baseline/candidate pair' : 'neither a models array nor a baseline/candidate pair'
  throw new Error(`plan '${planLabel}' declares ${declared}`)
}

/** One queue entry resolved against the checked-in plans and overlays, ready to run. */
export interface ScheduledEntry {
  readonly index: number
  readonly plan: string
  readonly overlay: string | null
  readonly note: string
  readonly kind: PlanKind
  readonly planPath: string
  readonly compositionPath: string
}

/**
 * Resolve every entry of a queue, then narrow to the requested slice. The whole
 * queue resolves before the selection, so an unknown plan or overlay anywhere in
 * the file is refused whatever `--from` and `--only` ask for, and before any
 * driver starts.
 * @param entries - the parsed queue entries, in queue order.
 * @param selection - `--from <n>`, a 1-based queue position, and `--only <plan>`.
 * @param plansDir - directory holding checked-in plan fixtures.
 * @param overlaysDir - directory holding the named overlay compositions.
 * @param baseComposition - the fixture's own composition, used by an entry whose overlay is null.
 * @returns the selected entries, each carrying its 1-based position in the queue.
 */
export function scheduleQueue(
  entries: readonly QueueEntry[],
  selection: { readonly from: number | undefined; readonly only: string | undefined },
  plansDir: string = PLANS_DIR,
  overlaysDir: string = OVERLAYS_DIR,
  baseComposition: string = BASE_COMPOSITION,
): readonly ScheduledEntry[] {
  const resolved = entries.map((entry, position): ScheduledEntry => {
    const planPath = resolvePlanPath(entry.plan, plansDir)
    const plan = JSON.parse(readFileSync(planPath, 'utf8')) as Record<string, unknown>
    return {
      index: position + 1,
      plan: entry.plan,
      overlay: entry.overlay,
      note: entry.note,
      kind: planKind(entry.plan, plan),
      planPath,
      compositionPath: resolveOverlayPath(entry.overlay ?? undefined, overlaysDir, baseComposition),
    }
  })
  const selected = resolved.filter(entry =>
    (selection.from === undefined || entry.index >= selection.from)
    && (selection.only === undefined || entry.plan === selection.only))
  if (selected.length === 0) {
    const asked = [
      ...selection.from === undefined ? [] : [`--from ${selection.from}`],
      ...selection.only === undefined ? [] : [`--only ${selection.only}`],
    ].join(' ')
    throw new Error(`no entry of this ${resolved.length}-entry queue matches ${asked}`)
  }
  return selected
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

/**
 * The record directory name one loop iteration writes: `<UTC date>-bench-<plan>`,
 * suffixed `-2`, `-3`, … when that name is already taken, since a recorded run
 * is never rewritten in place.
 * @param date - the iteration's start time.
 * @param planLabel - the resolved plan file's base name, without `.json`.
 * @param existing - the directory names already under `data/proving-ground/`.
 * @returns the unused record name.
 */
export function resolveRecordName(date: Date, planLabel: string, existing: readonly string[]): string {
  const base = `${date.toISOString().slice(0, 10)}-bench-${planLabel}`
  if (!existing.includes(base)) return base
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`
    if (!existing.includes(candidate)) return candidate
  }
}

/** The verdicts the experiments service writes into a recorded `result.json`. */
const EXPERIMENT_VERDICTS = ['promote', 'reject', 'inconclusive'] as const

/** One frozen paired experiment's verdict, read from its record. */
export type ExperimentVerdict = typeof EXPERIMENT_VERDICTS[number]

/** Whether one loop iteration produced a record. */
export type LedgerOutcome = 'recorded' | 'failed'

/** What one loop iteration does with its reading. */
export type LoopDecision = 'adopt-candidate' | 'keep-baseline' | 'recorded' | 'none'

/**
 * The loop's fixed decision rule: a promoted candidate is adopted, a rejected or
 * inconclusive one keeps the baseline, a fleet carries no verdict to decide on
 * and is only recorded, and a failed iteration decides nothing. `adopt-candidate`
 * is a decision, not an edit — the composition change it asks for stays a human
 * act, so nothing here writes a composition.
 * @param outcome - whether the iteration produced a record.
 * @param verdict - the recorded experiment verdict, `null` for a fleet.
 * @returns the decision the ledger line carries.
 */
export function decideIteration(outcome: LedgerOutcome, verdict: ExperimentVerdict | null): LoopDecision {
  if (outcome === 'failed') return 'none'
  if (verdict === null) return 'recorded'
  switch (verdict) {
    case 'promote':
      return 'adopt-candidate'
    case 'reject':
    case 'inconclusive':
      return 'keep-baseline'
    default:
      return assertNever(verdict, 'experiment verdict')
  }
}

/** A paired delta's bootstrap interval, as a recorded experiment result states it. */
export interface LedgerInterval {
  readonly lower: number
  readonly upper: number
}

/** One arm's certificates, as the recorded result states them. */
export interface LedgerArm {
  readonly arm: string
  readonly certified: number
  readonly cells: number
}

/** What one recorded run states about itself, read back from its own files. */
export interface RecordedReading {
  readonly record: string
  readonly verdict: ExperimentVerdict | null
  readonly delta: number | null
  readonly interval: LedgerInterval | null
  readonly certified: readonly LedgerArm[]
  readonly elapsedSeconds: number | null
}

/** One loop iteration's identity, fixed before its driver starts. */
export interface IterationIdentity {
  readonly ranAt: string
  readonly queue: string
  readonly entry: ScheduledEntry
  readonly head: string
}

/** How one iteration ended: with a record to read back, or with the reason it produced none. */
export type IterationOutcome =
  | { readonly kind: 'recorded'; readonly reading: RecordedReading }
  | { readonly kind: 'failed'; readonly reason: string; readonly record?: string }

/** One machine-written line of `data/proving-ground/loop/ledger.jsonl`. */
export interface LedgerLine {
  readonly ranAt: string
  readonly queue: string
  readonly index: number
  readonly plan: string
  readonly overlay: string | null
  readonly kind: PlanKind
  readonly record: string | null
  readonly head: string
  readonly verdict: ExperimentVerdict | null
  readonly delta: number | null
  readonly interval: LedgerInterval | null
  readonly certified: readonly LedgerArm[]
  readonly decision: LoopDecision
  readonly elapsedSeconds: number | null
  readonly outcome: LedgerOutcome
  readonly reason?: string
}

/**
 * The ledger line of one finished iteration. Every measured field comes from the
 * reading the record itself carries; a failed iteration carries none of them and
 * states its reason instead.
 * @param identity - what the iteration was, as its launch fixed it.
 * @param outcome - the record's reading, or why no record was written.
 * @returns the line to append.
 */
export function buildLedgerLine(identity: IterationIdentity, outcome: IterationOutcome): LedgerLine {
  const reading = outcome.kind === 'recorded' ? outcome.reading : undefined
  const verdict = reading?.verdict ?? null
  return {
    ranAt: identity.ranAt,
    queue: identity.queue,
    index: identity.entry.index,
    plan: identity.entry.plan,
    overlay: identity.entry.overlay,
    kind: identity.entry.kind,
    record: outcome.kind === 'recorded' ? outcome.reading.record : outcome.record ?? null,
    head: identity.head,
    verdict,
    delta: reading?.delta ?? null,
    interval: reading?.interval ?? null,
    certified: reading?.certified ?? [],
    decision: decideIteration(outcome.kind, verdict),
    elapsedSeconds: reading?.elapsedSeconds ?? null,
    outcome: outcome.kind,
    ...outcome.kind === 'failed' ? { reason: outcome.reason } : {},
  }
}

/**
 * One ledger line as it is appended.
 * @param line - the iteration to record.
 * @returns the line's compact JSON with its trailing newline.
 */
export function formatLedgerLine(line: LedgerLine): string {
  return `${JSON.stringify(line)}\n`
}

/** The fields of a recorded `result.json` that one ledger line reads. */
interface RecordedResult {
  readonly result?: {
    readonly verdict?: string
    readonly delta?: number
    readonly interval?: LedgerInterval
    readonly cells?: readonly { readonly pairs?: number; readonly baselineRate?: number; readonly candidateRate?: number }[]
  }
  readonly report?: {
    readonly leaderboard?: readonly {
      readonly provider?: string
      readonly model?: string
      readonly runs?: number
      readonly certified?: number
    }[]
  }
}

function isExperimentVerdict(value: string | undefined): value is ExperimentVerdict {
  return EXPERIMENT_VERDICTS.some(known => known === value)
}

/** A frozen pair's reading: the verdict rule's own three numbers, and each arm's certificates over the paired cells. */
function experimentReading(
  record: string,
  experiment: NonNullable<RecordedResult['result']>,
  elapsedSeconds: number | null,
): RecordedReading {
  if (!isExperimentVerdict(experiment.verdict)) {
    throw new Error(`record ${record} carries the unknown verdict ${JSON.stringify(experiment.verdict)}`)
  }
  const { delta, interval } = experiment
  if (typeof delta !== 'number' || interval === undefined) {
    throw new Error(`record ${record} carries a verdict without a delta and an interval`)
  }
  const cells = experiment.cells ?? []
  const pairs = cells.reduce((total, cell) => total + (cell.pairs ?? 0), 0)
  const certificates = (rate: 'baselineRate' | 'candidateRate'): number =>
    cells.reduce((total, cell) => total + Math.round((cell[rate] ?? 0) * (cell.pairs ?? 0)), 0)
  return {
    record,
    verdict: experiment.verdict,
    delta,
    interval,
    certified: [
      { arm: 'baseline', certified: certificates('baselineRate'), cells: pairs },
      { arm: 'candidate', certified: certificates('candidateRate'), cells: pairs },
    ],
    elapsedSeconds,
  }
}

/** A fleet's reading: no verdict, and one arm per model of its leaderboard. */
function fleetReading(
  record: string,
  leaderboard: NonNullable<NonNullable<RecordedResult['report']>['leaderboard']>,
  elapsedSeconds: number | null,
): RecordedReading {
  const arms = new Map<string, { certified: number; cells: number }>()
  for (const row of leaderboard) {
    if (typeof row.provider !== 'string' || typeof row.model !== 'string' || typeof row.runs !== 'number' || typeof row.certified !== 'number') {
      throw new Error(`record ${record} has a leaderboard row without a provider, model, runs, and certified count`)
    }
    const arm = `${row.provider}/${row.model}`
    const totals = arms.get(arm) ?? { certified: 0, cells: 0 }
    arms.set(arm, { certified: totals.certified + row.certified, cells: totals.cells + row.runs })
  }
  return {
    record,
    verdict: null,
    delta: null,
    interval: null,
    certified: [...arms].map(([arm, totals]) => ({ arm, ...totals })),
    elapsedSeconds,
  }
}

/**
 * Read one record's own numbers: an experiment's verdict, paired delta, interval,
 * and per-arm certificates from its result cells, a fleet's certificates from its
 * leaderboard, and the elapsed seconds its manifest carries. Nothing is measured
 * here — the ledger states what the record states.
 * @param recordDir - the record directory under `data/proving-ground/`.
 * @param record - that directory's name.
 * @returns the reading the ledger line carries.
 */
export function readRecordedReading(recordDir: string, record: string): RecordedReading {
  const result = JSON.parse(readFileSync(join(recordDir, 'result.json'), 'utf8')) as RecordedResult
  const manifest = JSON.parse(readFileSync(join(recordDir, 'manifest.json'), 'utf8')) as { readonly elapsedSeconds?: number }
  const elapsedSeconds = manifest.elapsedSeconds ?? null
  if (result.result !== undefined) return experimentReading(record, result.result, elapsedSeconds)
  if (result.report?.leaderboard !== undefined) return fleetReading(record, result.report.leaderboard, elapsedSeconds)
  throw new Error(`record ${record} holds neither an experiment result nor a fleet leaderboard`)
}

/**
 * The schedule `--dry-run` prints: the queue and one line per selected entry, in
 * run order.
 * @param queue - the queue's name.
 * @param schedule - the resolved entries.
 * @returns the lines, each without its newline.
 */
export function formatSchedule(queue: string, schedule: readonly ScheduledEntry[]): string[] {
  return [
    `queue=${queue} entries=${schedule.length}`,
    ...schedule.map(entry =>
      `  ${entry.index} plan=${entry.plan} kind=${entry.kind} overlay=${entry.overlay ?? 'base'} note=${entry.note}`),
  ]
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
  loop <queue> [--dry-run] [--from <n>] [--only <plan>]  run a queue of plans, record each, append the loop ledger
  fold <baseline.json> <candidate.json> <out.json> [minimumDelta] [resamples]
  record <run dir> <name> --composition <path> [--elapsed-seconds <n>]
  summarize <dir> [--json]
  census <record> [--json]
  admit [<environments-dir>]

<plan> is a checked-in plan name under examples/headless-agent/tests/fixtures/proving-ground-bench/plans/, or a path to a JSON file.
--overlay is one of the composition overlays under .../overlays/, without its .cordis.yml suffix; omit it for the fixture's base cordis.yml.
<queue> is a checked-in queue name under .../queues/, or a path to a JSON file: an array of { "plan", "overlay", "note" } entries run in order.
loop records each run as <UTC date>-bench-<plan> under data/proving-ground/ and appends one line per iteration to data/proving-ground/loop/ledger.jsonl.
Its decision rule is fixed: verdict promote decides adopt-candidate, reject and inconclusive decide keep-baseline, a fleet decides recorded, and a failed
entry decides none. adopt-candidate is a decision, not an edit: applying it to a composition stays a human act.
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
  | {
    readonly kind: 'loop'
    readonly queueArg: string
    readonly from: number | undefined
    readonly only: string | undefined
    readonly dryRun: boolean
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
    case 'loop': {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { 'dry-run': { type: 'boolean', default: false }, from: { type: 'string' }, only: { type: 'string' } },
      })
      const [queueArg] = positionals
      if (positionals.length !== 1 || queueArg === undefined) {
        throw new Error(`'loop' requires exactly one <queue> argument, got ${JSON.stringify(positionals)}`)
      }
      let from: number | undefined
      if (values.from !== undefined) {
        from = Number(values.from)
        if (!Number.isInteger(from) || from < 1) throw new Error(`--from must be a positive integer, got ${JSON.stringify(values.from)}`)
      }
      return { kind: 'loop', queueArg, from, only: values.only, dryRun: values['dry-run'] }
    }
    case 'fold':
    case 'record':
    case 'summarize':
    case 'census':
    case 'admit':
      return { kind: sub, args: rest }
    default:
      throw new Error(`unknown subcommand '${sub}'; expected plans | environments | fleet | experiment | loop | fold | record | summarize | census | admit`)
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

/** Run one `data/proving-ground/tools/` script under plain Node, with inherited stdio. */
function runTool(tool: string, args: readonly string[]): Promise<number> {
  return runInherited(process.execPath, [join(TOOLS_DIR, tool), ...args])
}

/** One run's launch: everything the driver and the `run.log` banner need. */
interface RunLaunch {
  readonly kind: PlanKind
  readonly planPath: string
  readonly compositionPath: string
  readonly overlayLabel: string
  readonly outDir: string
  readonly now: Date
  readonly head: string
}

/**
 * Create the run directory, copy the plan into it, append the banner, and run the
 * plan's driver with its output teed into `run.log`.
 * @param launch - the resolved plan, composition, out directory, and launch stamps.
 * @returns the driver's exit code.
 */
async function launchRun(launch: RunLaunch): Promise<number> {
  await mkdir(launch.outDir, { recursive: true })
  await copyFile(launch.planPath, join(launch.outDir, 'plan.json'))
  const runLogPath = join(launch.outDir, 'run.log')
  const planLabel = basename(launch.planPath, PLAN_SUFFIX)
  appendFileSync(runLogPath, formatRunBanner(launch.now, planLabel, launch.overlayLabel, launch.head))
  const driverPath = join(BENCH_DIR, launch.kind === 'fleet' ? 'fleet-driver.ts' : 'experiment-driver.ts')
  return runTeeingToLog(tsxBinary(), [driverPath, launch.compositionPath, 'plan.json'], launch.outDir, runLogPath)
}

async function runFleetOrExperiment(
  kind: PlanKind,
  planArg: string,
  overlayName: string | undefined,
  outArg: string | undefined,
): Promise<number> {
  const planPath = resolvePlanPath(planArg)
  const compositionPath = resolveOverlayPath(overlayName)
  const now = new Date()
  const outDir = outArg === undefined ? resolveOutDir(basename(planPath, PLAN_SUFFIX), now) : resolve(process.cwd(), outArg)
  const code = await launchRun({
    kind, planPath, compositionPath, overlayLabel: overlayName ?? 'base', outDir, now, head: repositoryHead(),
  })
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

/**
 * Run one queue entry end to end: the driver, the record, the summary, and the
 * reading its ledger line carries. A non-zero exit anywhere yields a failed line
 * naming what refused, so the queue's next entry still runs.
 * @param identity - the iteration's queue position, launch time, and head.
 * @returns the line to append to the ledger.
 */
async function runQueueEntry(identity: IterationIdentity): Promise<LedgerLine> {
  const { entry } = identity
  const now = new Date(identity.ranAt)
  const planLabel = basename(entry.planPath, PLAN_SUFFIX)
  const outDir = resolveOutDir(planLabel, now)
  const driverCode = await launchRun({
    kind: entry.kind,
    planPath: entry.planPath,
    compositionPath: entry.compositionPath,
    overlayLabel: entry.overlay ?? 'base',
    outDir,
    now,
    head: identity.head,
  })
  if (driverCode !== 0) {
    return buildLedgerLine(identity, {
      kind: 'failed',
      reason: `the ${entry.kind} driver exited ${driverCode}; the run directory is ${relative(REPO_ROOT, outDir)}`,
    })
  }
  const record = resolveRecordName(now, planLabel, readdirSync(RECORDS_ROOT))
  const recordCode = await runTool('record-run.mjs', [outDir, record, '--composition', relative(REPO_ROOT, entry.compositionPath)])
  if (recordCode !== 0) return buildLedgerLine(identity, { kind: 'failed', reason: `recording ${record} exited ${recordCode}` })
  const recordDir = join(RECORDS_ROOT, record)
  const summarizeCode = await runTool('summarize-run.mjs', [recordDir])
  if (summarizeCode !== 0) {
    return buildLedgerLine(identity, { kind: 'failed', reason: `summarizing ${record} exited ${summarizeCode}`, record })
  }
  try {
    return buildLedgerLine(identity, { kind: 'recorded', reading: readRecordedReading(recordDir, record) })
  } catch (error) {
    return buildLedgerLine(identity, { kind: 'failed', reason: describeError(error), record })
  }
}

/**
 * Run a queue of checked-in plans in order, recording each run and appending one
 * ledger line per iteration. A failed entry is written as such and the queue
 * continues; the command exits non-zero when any entry failed.
 * @param queueArg - a checked-in queue name or a path to a queue JSON file.
 * @param selection - `--from <n>` and `--only <plan>`.
 * @param dryRun - print the resolved schedule and stop, running and writing nothing.
 * @returns the process exit code.
 */
async function runLoop(
  queueArg: string,
  selection: { readonly from: number | undefined; readonly only: string | undefined },
  dryRun: boolean,
): Promise<number> {
  const queuePath = resolveQueuePath(queueArg)
  const queue = basename(queuePath, QUEUE_SUFFIX)
  const entries = parseQueue(readFileSync(queuePath, 'utf8'), relative(REPO_ROOT, queuePath))
  const schedule = scheduleQueue(entries, selection)
  process.stdout.write(`${formatSchedule(queue, schedule).join('\n')}\n`)
  if (dryRun) {
    process.stdout.write('proving-ground: --dry-run, nothing ran and nothing was written\n')
    return 0
  }
  let failures = 0
  for (const entry of schedule) {
    const identity: IterationIdentity = { ranAt: new Date().toISOString(), queue, entry, head: repositoryHead() }
    process.stdout.write(`\n=== loop ${queue} ${entry.index}/${entries.length} plan=${entry.plan} ===\n`)
    let line: LedgerLine
    try {
      line = await runQueueEntry(identity)
    } catch (error) {
      line = buildLedgerLine(identity, { kind: 'failed', reason: describeError(error) })
    }
    mkdirSync(dirname(LEDGER_PATH), { recursive: true })
    appendFileSync(LEDGER_PATH, formatLedgerLine(line))
    if (line.outcome === 'failed') failures += 1
    const reason = line.reason === undefined ? '' : ` reason=${line.reason}`
    process.stdout.write(`proving-ground: ${entry.plan} ${line.outcome} decision=${line.decision}${reason}\n`)
  }
  process.stdout.write(`\nproving-ground: ${schedule.length - failures} of ${schedule.length} recorded in ${relative(REPO_ROOT, LEDGER_PATH)}\n`)
  return failures === 0 ? 0 : 1
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
    case 'loop':
      return runLoop(command.queueArg, { from: command.from, only: command.only }, command.dryRun)
    case 'fold':
      return runInherited(tsxBinary(), [join(BENCH_DIR, 'fold-driver.ts'), ...command.args])
    case 'record':
      return runTool('record-run.mjs', command.args)
    case 'summarize':
      return runTool('summarize-run.mjs', command.args)
    case 'census':
      return runTool('census-escapes.mjs', command.args)
    case 'admit':
      return runInherited(process.execPath, [join(BENCH_DIR, 'admit.mjs'), ...command.args])
    default:
      return assertNever(command, 'command kind')
  }
}

if (import.meta.main) {
  try {
    process.exitCode = await execute(parseCommand(process.argv.slice(2)))
  } catch (error) {
    process.stderr.write(`proving-ground: ${describeError(error)}\n`)
    process.exitCode = 2
  }
}
