/** Scoreboard rows the observatory specs publish, built field by field so each publication rule is exercised alone. */

import { EnvironmentId } from '@deepseek-ai/dsh-environments'
import type { ExperimentResult } from '@deepseek-ai/dsh-experiments/types'
import type { ScoreboardRow } from '@deepseek-ai/dsh-scorekeeper/types'
import type { CertificateIsolation, RunExecutor } from '@deepseek-ai/dsh-verification/types'
import type { ObservatorySnapshot } from '@deepseek-ai/dsh-observatory'

/** Fields one spec replaces on the certified round-trip row. */
export interface RowOverrides {
  readonly provider?: string
  readonly model?: string
  readonly environmentId?: string
  readonly heldOut?: boolean
  readonly district?: string
  readonly isolation?: CertificateIsolation
  readonly implementer?: string
  readonly ladder?: readonly { readonly provider: string; readonly model: string }[]
  readonly runs?: number
  readonly errors?: number
  readonly tampered?: number
  readonly compositionSha256?: string
  readonly certificateExecutors?: readonly RunExecutor[]
  readonly certified?: number
  readonly certificateRate?: number
  readonly parity?: number
  readonly costEurPerCertified?: number
  readonly pricingDigests?: readonly string[]
}

/**
 * One scoreboard row as the scorekeeper folds it.
 * @param overrides - the fields this case replaces on a certified, untampered, undistricted row.
 * @returns the row.
 */
export function row(overrides: RowOverrides = {}): ScoreboardRow {
  const {
    environmentId = 'smoke:round-trip',
    district,
    ladder,
    parity,
    compositionSha256,
    costEurPerCertified,
    ...rest
  } = overrides
  return {
    provider: 'cli-mock',
    model: 'cli-mock',
    environmentKind: 'smoke',
    heldOut: false,
    isolation: 'none',
    implementer: 'route',
    runs: 2,
    errors: 0,
    tampered: 0,
    escapesDenied: 0,
    certificateExecutors: ['runner'],
    certified: 2,
    certificateRate: 1,
    attemptsMean: 1,
    inputTokens: 24,
    outputTokens: 6,
    pricingDigests: [],
    stats: { groups: 0, samples: 0, passAtK: [] },
    ...rest,
    environmentId: EnvironmentId(environmentId),
    ...district === undefined ? {} : { district },
    ...ladder === undefined ? {} : { ladder },
    ...parity === undefined ? {} : { parity },
    ...compositionSha256 === undefined ? {} : { compositionSha256 },
    ...costEurPerCertified === undefined ? {} : { costEurPerCertified },
  }
}

/** Fields one spec replaces on the empty snapshot. */
export interface SnapshotOverrides {
  readonly rows?: readonly ScoreboardRow[]
  readonly experiments?: readonly ExperimentResult[]
  readonly newestSessionAt?: number
  readonly foldedAt?: number
  readonly refreshIntervalMs?: number
}

/**
 * One snapshot as the service folds it.
 * @param overrides - the rows, verdicts, and times this case states.
 * @returns the snapshot, with nothing withheld unless a case says otherwise.
 */
export function snapshot(overrides: SnapshotOverrides = {}): ObservatorySnapshot {
  const { newestSessionAt = 1_000_000, ...rest } = overrides
  return {
    rows: [],
    withheld: { districts: [], districtRows: 0, districtSessions: 0, heldOutRows: 0, heldOutSessions: 0 },
    experiments: [],
    sessions: 0,
    unstamped: 0,
    skipped: [],
    foldedAt: 1_000_500,
    refreshIntervalMs: 900_000,
    ...rest,
    newestSessionAt,
  }
}

/**
 * One experiment result as the experiment service folds it.
 * @param baseline - the reference arm's model id.
 * @param candidate - the model id of the arm under test.
 * @param verdict - what the overall interval said about the candidate.
 * @returns the result, with the plan digest both arm groups carry.
 */
export function experiment(
  baseline: string,
  candidate: string,
  verdict: ExperimentResult['verdict'],
): ExperimentResult {
  const digest = 'f'.repeat(64)
  return {
    digest,
    arms: {
      baseline: { model: { provider: 'cli-mock', model: baseline }, implementer: { kind: 'route' }, group: `experiment-${digest}-baseline` },
      candidate: { model: { provider: 'cli-mock', model: candidate }, implementer: { kind: 'route' }, group: `experiment-${digest}-candidate` },
    },
    cells: [],
    seedsPaired: 4,
    delta: 0.25,
    spend: { inputTokens: 40, outputTokens: 10 },
    thresholds: { bootstrapResamples: 1000, confidenceLevel: 0.95, minimumDelta: 0, cellTokenCap: 1000 },
    caps: [['maxTotalTokens', 1000]],
    verdict,
  }
}
