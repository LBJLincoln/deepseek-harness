/**
 * Pure fold of session facts into scoreboard rows: one row per model route,
 * attempt ladder, environment, isolation level, implementer, held-out split,
 * and district, each carrying the
 * unbiased pass@k estimate over the repetition batches its sessions belong to,
 * the cost its sessions logged, and the mean weighted pass rate of the sessions
 * that measured cases.
 *
 * @module @deepseek-ai/dsh-scorekeeper
 */

import type { RunExecutor } from '@deepseek-ai/dsh-verification/types'
import type {
  EnvironmentStats,
  LeaderboardFilter,
  PassAtK,
  ScoreboardRow,
  SessionFactsEnvironment,
  SessionFactsRecord,
} from './types.ts'

/** Sample and certified counts of one repetition batch inside one row. */
interface Batch {
  /** Sessions of the row that carried this batch identity. */
  samples: number
  /** How many of them certified. */
  certified: number
}

/** One row under construction. */
interface RowAccumulator {
  readonly environment: SessionFactsEnvironment
  runs: number
  errors: number
  certified: number
  attemptSum: number
  inputTokens: number
  outputTokens: number
  /** EUR summed over the certified sessions that state a cost. */
  certifiedCostEur: number
  /** Certified sessions whose log states no cost; one is enough to withhold the row's mean. */
  uncostedCertified: number
  /** Weighted pass rates summed over the sessions that carry one. */
  parityRateSum: number
  /** How many sessions of the row carry a parity; the divisor of that sum. */
  paritySessions: number
  /** Sessions whose last recorded run carried the `tampered` verdict. */
  tampered: number
  /** Reads the barrier refused, summed over the row's sessions. */
  escapesDenied: number
  /** Composition digest every session so far stated, absent until the first session. */
  compositionSha256: string | undefined
  /** Whether a session stated no digest or a second one, which withholds the row's digest for good. */
  compositionMixed: boolean
  /** Pricing digests of every session of the row, in first-appearance order. */
  readonly digests: Set<string>
  /** Certificate executors of the row's certified sessions, in first-appearance order. */
  readonly executors: Set<RunExecutor>
  readonly batches: Map<string, Batch>
}

/** Rows folded from a set of session facts, with what the fold set aside. */
export interface ScoreboardFold {
  /** One row per cell, in first-appearance order. */
  readonly rows: readonly ScoreboardRow[]
  /** Stamped records the filter's group or held-out condition excluded. */
  readonly excluded: number
  /** Records whose log carries no `environment/run` stamp, so no row can name their cell. */
  readonly unstamped: number
}

/**
 * Key of the row one stamped session belongs to. Serialized rather than
 * concatenated so no field value can spell a separator and merge two cells —
 * two districts above all — into one row. The attempt ladder is part of the key
 * because a laddered cell and a plain single-model cell on the same first rung
 * measure different arms.
 */
function rowKey(environment: SessionFactsEnvironment): string {
  return JSON.stringify([
    environment.provider,
    environment.model,
    environment.ladder?.map(rung => [rung.provider, rung.model]) ?? null,
    environment.environmentId,
    environment.isolation,
    environment.implementer,
    environment.heldOut,
    environment.district ?? null,
  ])
}

/**
 * Unbiased pass@k over one batch: the chance that a draw of `k` of its `n`
 * sessions holds at least one certified session, `1 - C(n - c, k) / C(n, k)`
 * evaluated as a product so no factorial overflows.
 * @param n - sessions in the batch, at least `k`.
 * @param c - how many of them certified.
 * @param k - repetitions drawn.
 * @returns the estimate between `0` and `1`.
 */
export function unbiasedPassAtK(n: number, c: number, k: number): number {
  if (n - c < k) return 1
  let miss = 1
  for (let index = 0; index < k; index += 1) miss *= (n - c - index) / (n - index)
  return 1 - miss
}

/** Estimate pass@k for every configured `k` a batch of the row reached. */
function statsOf(batches: ReadonlyMap<string, Batch>, ks: readonly number[]): EnvironmentStats {
  let samples = 0
  for (const batch of batches.values()) samples += batch.samples
  const passAtK: PassAtK[] = []
  for (const k of ks) {
    let total = 0
    let groups = 0
    for (const batch of batches.values()) {
      if (batch.samples < k) continue
      total += unbiasedPassAtK(batch.samples, batch.certified, k)
      groups += 1
    }
    if (groups > 0) passAtK.push({ k, value: total / groups, groups })
  }
  return { groups: batches.size, samples, passAtK }
}

/** Whether one stamped session passes the filter's group and held-out conditions. */
function matches(filter: LeaderboardFilter, environment: SessionFactsEnvironment): boolean {
  if (filter.group !== undefined && environment.group !== filter.group) return false
  return filter.heldOut === undefined || environment.heldOut === filter.heldOut
}

/**
 * Fold one session's composition digest into the row's agreement. A session
 * that states none, or one that states a second digest, breaks the agreement
 * for good, so a digest covering part of a row is never published as the row's.
 */
function agreeComposition(row: RowAccumulator, digest: string | undefined, first: boolean): void {
  if (digest === undefined || (!first && row.compositionSha256 !== digest)) row.compositionMixed = true
  else row.compositionSha256 = digest
}

/** Add one stamped session to its row. */
function accumulate(rows: Map<string, RowAccumulator>, record: SessionFactsRecord, environment: SessionFactsEnvironment): void {
  const key = rowKey(environment)
  const row = rows.get(key) ?? {
    environment,
    runs: 0,
    errors: 0,
    certified: 0,
    attemptSum: 0,
    inputTokens: 0,
    outputTokens: 0,
    certifiedCostEur: 0,
    uncostedCertified: 0,
    parityRateSum: 0,
    paritySessions: 0,
    tampered: 0,
    escapesDenied: 0,
    compositionSha256: undefined,
    compositionMixed: false,
    digests: new Set<string>(),
    executors: new Set<RunExecutor>(),
    batches: new Map<string, Batch>(),
  }
  const first = !rows.has(key)
  rows.set(key, row)
  const outcome = record.outcome
  const efficiency = record.efficiency
  if (outcome.runsRecorded === 0) row.errors += 1
  else {
    row.runs += 1
    row.attemptSum += outcome.runsRecorded
  }
  if (outcome.tamper === 'tampered') row.tampered += 1
  row.escapesDenied += record.tools.escapesDenied
  agreeComposition(row, record.identity.compositionSha256, first)
  if (outcome.certified) {
    row.certified += 1
    /* v8 ignore next -- a certified session states the executor of the run its certificate cites. */
    if (outcome.certificateExecutor !== undefined) row.executors.add(outcome.certificateExecutor)
    if (efficiency.costEur === undefined) row.uncostedCertified += 1
    else row.certifiedCostEur += efficiency.costEur
  }
  if (outcome.parity !== undefined) {
    row.parityRateSum += outcome.parity.weightPassed / outcome.parity.weightTotal
    row.paritySessions += 1
  }
  row.inputTokens += efficiency.inputTokens
  row.outputTokens += efficiency.outputTokens
  for (const digest of efficiency.pricingDigests) row.digests.add(digest)
  if (environment.group === undefined) return
  const batch = row.batches.get(environment.group) ?? { samples: 0, certified: 0 }
  row.batches.set(environment.group, batch)
  batch.samples += 1
  if (outcome.certified) batch.certified += 1
}

/** Close one accumulator into its row. */
function finish(row: RowAccumulator, ks: readonly number[]): ScoreboardRow {
  return {
    provider: row.environment.provider,
    model: row.environment.model,
    ...row.environment.ladder === undefined ? {} : { ladder: row.environment.ladder },
    environmentId: row.environment.environmentId,
    environmentKind: row.environment.environmentKind,
    heldOut: row.environment.heldOut,
    isolation: row.environment.isolation,
    implementer: row.environment.implementer,
    ...row.environment.district === undefined ? {} : { district: row.environment.district },
    runs: row.runs,
    errors: row.errors,
    tampered: row.tampered,
    escapesDenied: row.escapesDenied,
    ...row.compositionSha256 === undefined || row.compositionMixed
      ? {}
      : { compositionSha256: row.compositionSha256 },
    certificateExecutors: [...row.executors],
    certified: row.certified,
    certificateRate: row.runs === 0 ? 0 : row.certified / row.runs,
    ...row.paritySessions === 0 ? {} : { parity: row.parityRateSum / row.paritySessions },
    attemptsMean: row.runs === 0 ? 0 : row.attemptSum / row.runs,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    ...row.certified > 0 && row.uncostedCertified === 0
      ? { costEurPerCertified: row.certifiedCostEur / row.certified }
      : {},
    pricingDigests: [...row.digests],
    stats: statsOf(row.batches, ks),
  }
}

/**
 * Fold session facts into scoreboard rows.
 * @param records - one facts record per session, in the order the rows appear.
 * @param filter - the group and held-out conditions a stamped record must meet.
 * @param ks - the pass@k draws to estimate, ascending.
 * @returns the rows plus the counts of excluded and unstamped records.
 */
export function foldScoreboard(
  records: readonly SessionFactsRecord[],
  filter: LeaderboardFilter,
  ks: readonly number[],
): ScoreboardFold {
  const rows = new Map<string, RowAccumulator>()
  let excluded = 0
  let unstamped = 0
  for (const record of records) {
    const environment = record.identity.environment
    if (environment === undefined) {
      unstamped += 1
      continue
    }
    if (!matches(filter, environment)) {
      excluded += 1
      continue
    }
    accumulate(rows, record, environment)
  }
  return { rows: [...rows.values()].map(row => finish(row, ks)), excluded, unstamped }
}
