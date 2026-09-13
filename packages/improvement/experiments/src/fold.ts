/**
 * Folding two arms' fleet reports into one `ExperimentResult`: cells pair by
 * environment and repetition index, every statistic covers the paired
 * repetitions alone, and the verdict is one rule over the overall interval.
 *
 * @module @deepseek-ai/dsh-experiments/fold
 */

import type { BudgetCap } from '@deepseek-ai/dsh-budget-policy'
import type { EnvironmentRunReport } from '@deepseek-ai/dsh-environment-runner/types'
import type { EnvironmentId } from '@deepseek-ai/dsh-environments/types'
import type { FleetRunReport } from '@deepseek-ai/dsh-fleet/types'
import { bootstrapIntervals } from './statistics.ts'
import type { DeltaStratum } from './statistics.ts'
import type {
  ConfidenceInterval,
  ExperimentArmRole,
  ExperimentArms,
  ExperimentCell,
  ExperimentCellError,
  ExperimentResult,
  ExperimentSpend,
  ExperimentThresholds,
  ExperimentVerdict,
} from './types.ts'

/** What one fold needs beside the two arms' reports. */
export interface ExperimentFoldRequest {
  /** Frozen plan digest; it identifies the result and seeds every bootstrap draw. */
  readonly digest: string
  /** The arms, with the stamp group each ran under. */
  readonly arms: ExperimentArms
  /** Environments in plan order; the fold reports one cell per entry. */
  readonly environments: readonly EnvironmentId[]
  /** Repetition indexes each arm ran per environment. */
  readonly repetitions: number
  /** Thresholds the digest froze; the confidence level and minimum delta are read here. */
  readonly thresholds: ExperimentThresholds
  /** The caps the digest froze, which both arms resolved to and every cell ran under. */
  readonly caps: readonly BudgetCap[]
  /** The baseline arm's fleet report. */
  readonly baseline: FleetRunReport
  /** The candidate arm's fleet report. */
  readonly candidate: FleetRunReport
}

/** Per-repetition sums over the paired repetitions of one environment. */
interface PairedTotals {
  readonly deltas: number[]
  baselineCertified: number
  candidateCertified: number
  attempts: number
  inputTokens: number
  outputTokens: number
}

/** Key of one cell inside an arm; the pairing is exactly this key matching across arms. */
function cellKey(environment: EnvironmentId, repetition: number): string {
  return `${environment}\0${repetition}`
}

/** The runs one arm produced, keyed by cell; a cell the fleet kept as an error is absent. */
function reportsOf(report: FleetRunReport): Map<string, EnvironmentRunReport> {
  const reports = new Map<string, EnvironmentRunReport>()
  for (const outcome of report.cells) {
    if ('report' in outcome) reports.set(cellKey(outcome.cell.environment, outcome.cell.repetition), outcome.report)
  }
  return reports
}

/** The cells one arm kept as errors, in the fleet's cell order, each named by the arm it belongs to. */
function errorsOf(arm: ExperimentArmRole, report: FleetRunReport): ExperimentCellError[] {
  const errors: ExperimentCellError[] = []
  for (const outcome of report.cells) {
    if ('report' in outcome) continue
    errors.push({
      arm,
      environment: outcome.cell.environment,
      repetition: outcome.cell.repetition,
      ...outcome.error.code === undefined ? {} : { code: outcome.error.code },
      message: outcome.error.message,
    })
  }
  return errors
}

/** Model usage summed over every reported cell of both arms. */
function spendOf(arms: readonly FleetRunReport[]): ExperimentSpend {
  let inputTokens = 0
  let outputTokens = 0
  for (const arm of arms) {
    for (const outcome of arm.cells) {
      if (!('report' in outcome)) continue
      inputTokens += outcome.report.usage?.inputTokens ?? 0
      outputTokens += outcome.report.usage?.outputTokens ?? 0
    }
  }
  return { inputTokens, outputTokens }
}

/** Accumulate one environment's paired repetitions from the two arms' runs. */
function pairedTotals(
  environment: EnvironmentId,
  repetitions: number,
  baseline: ReadonlyMap<string, EnvironmentRunReport>,
  candidate: ReadonlyMap<string, EnvironmentRunReport>,
): PairedTotals {
  const totals: PairedTotals = {
    deltas: [],
    baselineCertified: 0,
    candidateCertified: 0,
    attempts: 0,
    inputTokens: 0,
    outputTokens: 0,
  }
  for (let repetition = 0; repetition < repetitions; repetition += 1) {
    const key = cellKey(environment, repetition)
    const before = baseline.get(key)
    const after = candidate.get(key)
    if (before === undefined || after === undefined) continue
    const beforeCertified = before.certified ? 1 : 0
    const afterCertified = after.certified ? 1 : 0
    totals.deltas.push(afterCertified - beforeCertified)
    totals.baselineCertified += beforeCertified
    totals.candidateCertified += afterCertified
    totals.attempts += after.attempts.length - before.attempts.length
    totals.inputTokens += (after.usage?.inputTokens ?? 0) - (before.usage?.inputTokens ?? 0)
    totals.outputTokens += (after.usage?.outputTokens ?? 0) - (before.usage?.outputTokens ?? 0)
  }
  return totals
}

/** A mean over the paired repetitions, `0` when nothing paired. */
function perPair(total: number, pairs: number): number {
  return pairs === 0 ? 0 : total / pairs
}

/**
 * The verdict rule. `promote` is tested first, so a deployment configuring a
 * negative minimum delta still gets the promoting branch instead of an
 * order-dependent answer.
 */
function verdictOf(interval: ConfidenceInterval | undefined, minimumDelta: number): ExperimentVerdict {
  if (interval === undefined) return 'inconclusive'
  if (interval.lower > minimumDelta) return 'promote'
  if (interval.upper < 0) return 'reject'
  return 'inconclusive'
}

/**
 * Fold both arms' fleet reports into the experiment's record.
 * @param request - the frozen digest and arms, the environments and repetitions that were run, the thresholds, and the two reports.
 * @returns one cell per environment in plan order, every cell an arm kept as an
 *   error, the pooled delta and its interval, the spend, and the verdict.
 */
export function foldExperiment(request: ExperimentFoldRequest): ExperimentResult {
  const baseline = reportsOf(request.baseline)
  const candidate = reportsOf(request.candidate)
  const totals = request.environments.map(environment => (
    pairedTotals(environment, request.repetitions, baseline, candidate)
  ))
  const strata: DeltaStratum[] = request.environments.map((environment, index) => ({
    key: environment,
    deltas: (totals[index] as PairedTotals).deltas,
  }))
  const bootstrap = bootstrapIntervals(strata, {
    digest: request.digest,
    resamples: request.thresholds.bootstrapResamples,
    confidenceLevel: request.thresholds.confidenceLevel,
  })
  const cells: ExperimentCell[] = request.environments.map((environment, index) => {
    const total = totals[index] as PairedTotals
    const pairs = total.deltas.length
    const interval = bootstrap.strata[index]
    return {
      environment,
      pairs,
      unpaired: request.repetitions - pairs,
      baselineRate: perPair(total.baselineCertified, pairs),
      candidateRate: perPair(total.candidateCertified, pairs),
      delta: perPair(total.candidateCertified - total.baselineCertified, pairs),
      ...interval === undefined ? {} : { interval },
      attemptsDelta: perPair(total.attempts, pairs),
      inputTokenDelta: total.inputTokens,
      outputTokenDelta: total.outputTokens,
    }
  })
  const seedsPaired = cells.reduce((sum, cell) => sum + cell.pairs, 0)
  const pooled = totals.reduce((sum, total) => sum + total.candidateCertified - total.baselineCertified, 0)
  return {
    digest: request.digest,
    arms: request.arms,
    cells,
    errors: [
      ...errorsOf('baseline', request.baseline),
      ...errorsOf('candidate', request.candidate),
    ],
    seedsPaired,
    delta: perPair(pooled, seedsPaired),
    ...bootstrap.overall === undefined ? {} : { interval: bootstrap.overall },
    spend: spendOf([request.baseline, request.candidate]),
    thresholds: request.thresholds,
    caps: request.caps,
    verdict: verdictOf(bootstrap.overall, request.thresholds.minimumDelta),
  }
}
