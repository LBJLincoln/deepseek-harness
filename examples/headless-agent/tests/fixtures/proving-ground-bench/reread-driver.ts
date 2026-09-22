#!/usr/bin/env node
/**
 * Offline re-read: rebuild the per-repetition paired outcomes of recorded
 * frozen experiments and read them under the experiments package's current
 * statistic, writing the reading as a fold under `data/proving-ground/folds/`.
 *
 *   reread-driver.ts <out.json> <record dir>... [--minimum-discordant-pairs <n>]
 *
 * A record's `result.json` states each environment's pair count and per-arm
 * rates, not which repetitions certified, so the pairs are rebuilt from the
 * record's `facts.jsonl`: one fact per cell session, keyed by its stamp group,
 * environment, and repetition, with the cells the result lists as errors left
 * unpaired as the fold left them. The rebuild is refused unless it reproduces
 * every recorded cell: its pair count, both arms' certificates, and its
 * interval redrawn under the record's own digest and thresholds, since both
 * statistics draw an environment's own interval the same way.
 *
 * One record is read under its own digest. Several are pooled: they must share
 * the plan, the arms, the environments, and the thresholds; each environment
 * then holds every record's paired deltas, records in name order, and the draws
 * are seeded by a digest derived from the record names and digests, so the
 * reading does not depend on the order the records are given in. The
 * discordant-pair minimum, which no earlier record states, is the option's
 * value or the experiments service's default of two. An existing output file is
 * never overwritten, and the records are only read.
 */

import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { bootstrapIntervals, EXPERIMENT_ARM_ROLES, parseExperimentGroup, readPairedDeltas, readStatistic } from '@deepseek-ai/dsh-experiments'
import type {
  ConfidenceInterval,
  DeltaStratum,
  ExperimentArm,
  ExperimentArmRole,
  ExperimentStatistic,
  ExperimentThresholds,
} from '@deepseek-ai/dsh-experiments'

/** One environment's cell as a recorded result states it. */
interface RecordedCell {
  readonly environment: string
  readonly pairs: number
  readonly unpaired: number
  readonly baselineRate: number
  readonly candidateRate: number
  readonly interval?: ConfidenceInterval
}

/**
 * The fields of a recorded experiment result this driver reads. A result
 * recorded before a field existed lacks it, so the fields later versions added
 * are optional here.
 */
interface RecordedResult {
  readonly digest: string
  readonly arms: Readonly<Record<ExperimentArmRole, ExperimentArm>>
  readonly cells: readonly RecordedCell[]
  readonly errors: readonly { readonly arm: ExperimentArmRole; readonly environment: string; readonly repetition: number }[]
  readonly delta: number
  readonly interval?: ConfidenceInterval
  readonly statistic?: unknown
  readonly thresholds: Omit<ExperimentThresholds, 'minimumDiscordantPairs'>
  readonly verdict: string
}

/** One scorekeeper fact line, reduced to the fields that place and score its session. */
interface RecordedFact {
  readonly identity?: {
    readonly environment?: { readonly environmentId?: string; readonly repetition?: number; readonly group?: string }
  }
  readonly outcome?: { readonly certified?: boolean }
}

/** Certificates each arm earned over one environment's paired repetitions. */
interface Certified {
  baseline: number
  candidate: number
}

/** One recorded experiment with its paired deltas rebuilt and checked. */
interface RebuiltRecord {
  readonly name: string
  readonly plan: string
  readonly result: RecordedResult
  /** The statistic the record was read by. */
  readonly statistic: ExperimentStatistic
  /** Repetition indexes each arm ran per environment. */
  readonly repetitions: number
  /** Each environment's paired deltas in repetition order, in the result's cell order. */
  readonly strata: readonly DeltaStratum[]
  /** Each environment's per-arm certificates, in the same order. */
  readonly certified: readonly Certified[]
}

const USAGE = 'reread-driver requires <out.json> <record dir>... [--minimum-discordant-pairs <n>]'

/** Key of one cell of one arm. */
function cellKey(environment: string, repetition: number, role: ExperimentArmRole): string {
  return `${environment}\0${repetition}\0${role}`
}

/** Whether two optional intervals state the same bounds. */
function sameInterval(left: ConfidenceInterval | undefined, right: ConfidenceInterval | undefined): boolean {
  return left?.lower === right?.lower && left?.upper === right?.upper
}

/** The arm as the comparison measured it, without the digest-bearing stamp group. */
function measuredArm(arm: ExperimentArm): Omit<ExperimentArm, 'group'> {
  const { group: _group, ...measured } = arm
  return measured
}

/** How many of some strata's paired deltas are not zero. */
function discordant(strata: readonly DeltaStratum[]): number {
  return strata.reduce((total, stratum) => total + stratum.deltas.filter(delta => delta !== 0).length, 0)
}

/**
 * Each cell's outcome as the record's facts state it, for the sessions of this
 * experiment alone, less the cells the result lists as errors.
 * @param name - the record's name, as messages state it.
 * @param facts - the record's `facts.jsonl`.
 * @param result - the recorded result, whose digest selects the sessions.
 * @returns whether each cell certified, keyed by {@link cellKey}.
 */
function outcomesOf(name: string, facts: string, result: RecordedResult): Map<string, boolean> {
  const outcomes = new Map<string, boolean>()
  for (const line of facts.split('\n')) {
    if (line === '') continue
    const fact = JSON.parse(line) as RecordedFact
    const stamp = fact.identity?.environment
    const arm = stamp?.group === undefined ? undefined : parseExperimentGroup(stamp.group)
    // A session of another experiment, or of none, is not one of this pair's cells.
    if (arm?.digest !== result.digest) continue
    if (stamp?.environmentId === undefined || stamp.repetition === undefined) {
      throw new Error(`reread-driver: record ${name} holds a ${arm.role} session without an environment and repetition`)
    }
    const key = cellKey(stamp.environmentId, stamp.repetition, arm.role)
    if (outcomes.has(key)) throw new Error(`reread-driver: record ${name} holds two sessions for one cell of ${stamp.environmentId}`)
    outcomes.set(key, fact.outcome?.certified === true)
  }
  for (const error of result.errors) outcomes.delete(cellKey(error.environment, error.repetition, error.arm))
  return outcomes
}

/**
 * Read one record's result and facts and rebuild its paired deltas.
 * @param dir - the record directory.
 * @returns the record with its rebuilt strata and per-arm certificates.
 */
async function rebuild(dir: string): Promise<RebuiltRecord> {
  const name = basename(resolve(dir))
  const status = JSON.parse(await readFile(join(dir, 'result.json'), 'utf8')) as { readonly plan?: string; readonly result?: RecordedResult }
  const { plan, result } = status
  if (plan === undefined || result === undefined) throw new Error(`reread-driver: record ${name} holds no frozen experiment result`)
  const statistic = readStatistic(result.statistic)
  const outcomes = outcomesOf(name, await readFile(join(dir, 'facts.jsonl'), 'utf8'), result)
  const repetitions = (result.cells[0]?.pairs ?? 0) + (result.cells[0]?.unpaired ?? 0)
  const certified = result.cells.map((): Certified => ({ baseline: 0, candidate: 0 }))
  const strata = result.cells.map((cell, index): DeltaStratum => {
    const deltas: number[] = []
    const totals = certified[index] as Certified
    for (let repetition = 0; repetition < repetitions; repetition += 1) {
      const before = outcomes.get(cellKey(cell.environment, repetition, 'baseline'))
      const after = outcomes.get(cellKey(cell.environment, repetition, 'candidate'))
      if (before === undefined || after === undefined) continue
      deltas.push(Number(after) - Number(before))
      totals.baseline += Number(before)
      totals.candidate += Number(after)
    }
    const stated = {
      pairs: cell.pairs,
      baseline: Math.round(cell.baselineRate * cell.pairs),
      candidate: Math.round(cell.candidateRate * cell.pairs),
    }
    const rebuilt = { pairs: deltas.length, ...totals }
    if (JSON.stringify(rebuilt) !== JSON.stringify(stated)) {
      throw new Error(`reread-driver: record ${name} states ${cell.environment} as ${JSON.stringify(stated)} but its facts rebuild ${JSON.stringify(rebuilt)}`)
    }
    return { key: cell.environment, deltas }
  })
  const replay = bootstrapIntervals(strata, {
    digest: result.digest,
    resamples: result.thresholds.bootstrapResamples,
    confidenceLevel: result.thresholds.confidenceLevel,
  })
  result.cells.forEach((cell, index) => {
    if (!sameInterval(replay.strata[index], cell.interval)) {
      throw new Error(`reread-driver: record ${name} states the ${cell.environment} interval ${JSON.stringify(cell.interval)} but its rebuilt pairs redraw ${JSON.stringify(replay.strata[index])}`)
    }
  })
  return { name, plan, result, statistic, repetitions, strata, certified }
}

/**
 * Refuse to pool records that did not run one comparison, or one record twice.
 * @param records - the rebuilt records, in name order.
 */
function checkPoolable(records: readonly RebuiltRecord[]): void {
  const [first, ...rest] = records as [RebuiltRecord, ...RebuiltRecord[]]
  const shared = (record: RebuiltRecord): string => JSON.stringify({
    plan: record.plan,
    arms: EXPERIMENT_ARM_ROLES.map(role => measuredArm(record.result.arms[role])),
    environments: record.result.cells.map(cell => cell.environment),
    thresholds: record.result.thresholds,
  })
  let previous = first
  for (const record of rest) {
    if (record.name === previous.name) throw new Error(`reread-driver: record ${record.name} is named twice`)
    if (shared(record) !== shared(first)) {
      throw new Error(`reread-driver: ${record.name} and ${first.name} differ in plan, arms, environments, or thresholds, so they cannot be pooled`)
    }
    previous = record
  }
}

/** One arm's label: the plan, the role, and the attempt ladder when the arm names one. */
function armLabel(plan: string, role: ExperimentArmRole, arm: ExperimentArm): string {
  return arm.ladder === undefined ? `${plan} ${role}` : `${plan} ${role}: ${arm.ladder.length}-rung ladder`
}

/** A mean over paired repetitions, `0` when nothing paired. */
function perPair(total: number, pairs: number): number {
  return pairs === 0 ? 0 : total / pairs
}

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: { 'minimum-discordant-pairs': { type: 'string' } },
})
const [outPath, ...recordDirs] = positionals
if (outPath === undefined || recordDirs.length === 0) throw new Error(USAGE)
const minimumArg = values['minimum-discordant-pairs']
const minimumDiscordantPairs = minimumArg === undefined ? 2 : Number(minimumArg)
if (!Number.isInteger(minimumDiscordantPairs) || minimumDiscordantPairs < 0) {
  throw new Error(`reread-driver: --minimum-discordant-pairs must be a non-negative integer, got ${JSON.stringify(minimumArg)}`)
}

const records = (await Promise.all(recordDirs.map(rebuild)))
  .sort((left, right) => (left.name < right.name ? -1 : Number(left.name > right.name)))
checkPoolable(records)
const [first] = records as [RebuiltRecord, ...RebuiltRecord[]]
const digest = records.length === 1
  ? first.result.digest
  : createHash('sha256')
    .update(JSON.stringify({ reread: 1, records: records.map(record => [record.name, record.result.digest]) }))
    .digest('hex')
const recorded = first.result.thresholds
const thresholds: ExperimentThresholds = {
  bootstrapResamples: recorded.bootstrapResamples,
  confidenceLevel: recorded.confidenceLevel,
  minimumDelta: recorded.minimumDelta,
  minimumDiscordantPairs,
  cellTokenCap: recorded.cellTokenCap,
}
const environments = first.result.cells.map(cell => cell.environment)
const strata = environments.map((environment, index): DeltaStratum => ({
  key: environment,
  deltas: records.flatMap(record => (record.strata[index] as DeltaStratum).deltas),
}))
const reading = readPairedDeltas(strata, { digest, thresholds })
const cells = environments.map((environment, index) => {
  const pairs = (strata[index] as DeltaStratum).deltas.length
  const baseline = records.reduce((total, record) => total + (record.certified[index] as Certified).baseline, 0)
  const candidate = records.reduce((total, record) => total + (record.certified[index] as Certified).candidate, 0)
  const interval = reading.strata[index]
  return {
    environment,
    pairs,
    baselineRate: perPair(baseline, pairs),
    candidateRate: perPair(candidate, pairs),
    delta: perPair(candidate - baseline, pairs),
    ...interval === undefined ? {} : { interval },
  }
})
const seedsPaired = cells.reduce((total, cell) => total + cell.pairs, 0)
const summed = strata.reduce((total, stratum) => total + stratum.deltas.reduce((sum, delta) => sum + delta, 0), 0)
const fold = {
  type: 'offline-fold',
  reading: records.length === 1 ? 'reread' : 'pooled-reread',
  plan: first.plan,
  baseline: armLabel(first.plan, 'baseline', first.result.arms.baseline),
  candidate: armLabel(first.plan, 'candidate', first.result.arms.candidate),
  records: records.map(record => ({
    record: record.name,
    digest: record.result.digest,
    statistic: record.statistic,
    delta: record.result.delta,
    ...record.result.interval === undefined ? {} : { interval: record.result.interval },
    verdict: record.result.verdict,
    discordantPairs: discordant(record.strata),
    certified: EXPERIMENT_ARM_ROLES.map(role => ({
      arm: role,
      certified: record.certified.reduce((total, cell) => total + cell[role], 0),
      cells: record.strata.reduce((total, stratum) => total + stratum.deltas.length, 0),
    })),
  })),
  environments,
  repetitions: records.reduce((total, record) => total + record.repetitions, 0),
  thresholds,
  result: {
    digest,
    cells,
    seedsPaired,
    discordantPairs: reading.discordantPairs,
    delta: perPair(summed, seedsPaired),
    ...reading.interval === undefined ? {} : { interval: reading.interval },
    statistic: reading.statistic,
    thresholds,
    verdict: reading.verdict,
    verdictBasis: reading.verdictBasis,
  },
}
await writeFile(outPath, `${JSON.stringify(fold, null, 2)}\n`, { flag: 'wx' })
process.stdout.write(`${JSON.stringify({
  type: fold.type,
  reading: fold.reading,
  records: records.map(record => record.name),
  delta: fold.result.delta,
  interval: fold.result.interval,
  discordantPairs: fold.result.discordantPairs,
  statistic: fold.result.statistic,
  verdict: fold.result.verdict,
  verdictBasis: fold.result.verdictBasis,
})}\n`)
