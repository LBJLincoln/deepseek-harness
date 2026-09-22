/**
 * The paired cluster bootstrap: percentile confidence intervals of paired
 * certificate-rate deltas that resample the environments as well as the
 * repetitions inside them, drawn by generators seeded from the frozen plan
 * digest so the same plan over the same certificates always yields the same
 * intervals. The
 * [cluster-bootstrap Agent Note](../../../.agents/notes/proposed/architecture/2026-09-22-cluster-bootstrap-for-paired-experiments.md)
 * owns the rationale.
 *
 * @module @deepseek-ai/dsh-experiments/statistics
 */

import type { ConfidenceInterval, ExperimentStatistic } from './types.ts'

/** The statistic {@link bootstrapIntervals} computes; every result the fold writes names it. */
export const EXPERIMENT_STATISTIC = 'paired-cluster-bootstrap/1' satisfies ExperimentStatistic

/** The statistic of a stored result written before results named theirs. */
const UNNAMED_STATISTIC = 'paired-bootstrap/0' satisfies ExperimentStatistic

/** One environment's paired deltas, in repetition order. */
export interface DeltaStratum {
  /**
   * Environment identity, distinct across one call. It seeds this stratum's
   * own interval together with the digest and orders the clusters the overall
   * pass draws from.
   */
  readonly key: string
  /** `candidate - baseline` per paired repetition; empty when nothing paired. */
  readonly deltas: readonly number[]
}

/** How to draw the intervals. */
export interface BootstrapRequest {
  /** Frozen plan digest; the only source of randomness in the fold. */
  readonly digest: string
  /** Resamples to draw, at least one. */
  readonly resamples: number
  /** Coverage of the reported intervals, between `0` and `1`. */
  readonly confidenceLevel: number
}

/** Intervals of one bootstrap pass. */
export interface BootstrapResult {
  /**
   * One entry per requested stratum, in request order: the interval of that
   * stratum's mean with its own deltas resampled; absent for a stratum with no
   * delta.
   */
  readonly strata: readonly (ConfidenceInterval | undefined)[]
  /** Cluster interval of the mean over every paired delta, absent when no stratum holds a delta. */
  readonly overall?: ConfidenceInterval
}

/** A seeded generator of values in `[0, 1)`. */
type Generator = () => number

/** 32-bit FNV-1a hash of a UTF-16 code-unit sequence; the generator's seed. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193)
  }
  return hash >>> 0
}

/** Mulberry32: a seeded generator of values in `[0, 1)`, used for every draw. */
function mulberry32(seed: number): Generator {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = Math.imul(state ^ (state >>> 15), state | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 0x100000000
  }
}

/** Value at a quantile of an ascending sample, by nearest rank. */
function quantile(ascending: readonly number[], fraction: number): number {
  return ascending[Math.round(fraction * (ascending.length - 1))] as number
}

/** The percentile interval of one resampled distribution at a confidence level. */
function intervalOf(draws: number[], confidenceLevel: number): ConfidenceInterval {
  const ascending = [...draws].sort((left, right) => left - right)
  const tail = (1 - confidenceLevel) / 2
  return { lower: quantile(ascending, tail), upper: quantile(ascending, 1 - tail) }
}

/** Sum of as many draws from `values`, with replacement, as it holds. */
function resampledSum(values: readonly number[], next: Generator): number {
  let sum = 0
  for (let draw = 0; draw < values.length; draw += 1) {
    sum += values[Math.floor(next() * values.length)] as number
  }
  return sum
}

/** Interval of one stratum's mean, drawn from the generator its own key seeds. */
function stratumInterval(stratum: DeltaStratum, request: BootstrapRequest): ConfidenceInterval {
  const next = mulberry32(fnv1a(`${request.digest}:${stratum.key}`))
  const draws: number[] = []
  for (let resample = 0; resample < request.resamples; resample += 1) {
    draws.push(resampledSum(stratum.deltas, next) / stratum.deltas.length)
  }
  return intervalOf(draws, request.confidenceLevel)
}

/** Code-unit order of stratum keys, so the cluster draw is independent of the order strata arrive in. */
function byKey(left: DeltaStratum, right: DeltaStratum): number {
  return left.key < right.key ? -1 : Number(left.key > right.key)
}

/**
 * Interval of the mean over every paired delta, resampled in two stages. A
 * resample draws as many clusters as there are, with replacement, then within
 * each drawn cluster as many of its deltas as it holds, with replacement; its
 * statistic is the sum of the drawn deltas over their count, so a cluster
 * weighs by its paired count as the point estimate does.
 * @param clusters - the strata holding at least one delta, in key order.
 * @param request - the digest that alone seeds this pass, the resample count, and the confidence level.
 * @returns the percentile interval of the resampled means.
 */
function clusterInterval(clusters: readonly DeltaStratum[], request: BootstrapRequest): ConfidenceInterval {
  const next = mulberry32(fnv1a(request.digest))
  const draws: number[] = []
  for (let resample = 0; resample < request.resamples; resample += 1) {
    let sum = 0
    let units = 0
    for (let draw = 0; draw < clusters.length; draw += 1) {
      const cluster = clusters[Math.floor(next() * clusters.length)] as DeltaStratum
      sum += resampledSum(cluster.deltas, next)
      units += cluster.deltas.length
    }
    draws.push(sum / units)
  }
  return intervalOf(draws, request.confidenceLevel)
}

/**
 * Draw percentile bootstrap intervals for every stratum and for the mean over
 * all of them. A stratum's own interval resamples its paired deltas, drawn
 * from a generator seeded with `<digest>:<key>`. The overall interval is a
 * cluster bootstrap: each resample draws the strata that hold a delta with
 * replacement and then each drawn stratum's deltas with replacement, from one
 * generator seeded with the digest alone, so an overall effect carried by few
 * environments widens with the chance of drawing them or not. A stratum with
 * no delta is neither interval's unit and contributes nothing rather than a
 * zero.
 * @param strata - the per-environment paired deltas, in the order the result reports them.
 * @param request - the plan digest that seeds every draw, the resample count, and the confidence level.
 * @returns one interval per stratum and the overall interval, both absent where no delta was drawn.
 */
export function bootstrapIntervals(strata: readonly DeltaStratum[], request: BootstrapRequest): BootstrapResult {
  const intervals = strata.map(stratum => (stratum.deltas.length === 0 ? undefined : stratumInterval(stratum, request)))
  const clusters = strata.filter(stratum => stratum.deltas.length > 0).sort(byKey)
  if (clusters.length === 0) return { strata: intervals }
  return { strata: intervals, overall: clusterInterval(clusters, request) }
}

/**
 * The statistic a stored result was read by, validated where the result is
 * read back from a file.
 * @param stored - the result's `statistic` field, `undefined` for a result that carries none.
 * @returns the named statistic, or `paired-bootstrap/0` for a result that names none.
 * @throws {TypeError} when the field names a statistic this package does not define.
 */
export function readStatistic(stored: unknown): ExperimentStatistic {
  if (stored === undefined) return UNNAMED_STATISTIC
  if (stored === UNNAMED_STATISTIC || stored === EXPERIMENT_STATISTIC) return stored
  throw new TypeError(`unknown experiment statistic ${JSON.stringify(stored)}`)
}
