/**
 * The paired bootstrap: percentile confidence intervals over per-environment
 * strata of paired deltas, drawn by a generator seeded from the frozen plan
 * digest so the same plan over the same certificates always yields the same
 * interval.
 *
 * @module @deepseek-ai/dsh-experiments/statistics
 */

import type { ConfidenceInterval } from './types.ts'

/** One environment's paired deltas, in repetition order. */
export interface DeltaStratum {
  /** Stratum identity; it seeds this stratum's generator together with the digest. */
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
  /** One entry per requested stratum, in request order; absent for a stratum with no delta. */
  readonly strata: readonly (ConfidenceInterval | undefined)[]
  /** Interval of the mean over every drawn unit, absent when no stratum holds a delta. */
  readonly overall?: ConfidenceInterval
}

/** 32-bit FNV-1a hash of a UTF-16 code-unit sequence; the generator's seed. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193)
  }
  return hash >>> 0
}

/** Mulberry32: a seeded generator of values in `[0, 1)`, used for every draw. */
function mulberry32(seed: number): () => number {
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

/**
 * Draw percentile bootstrap intervals for every stratum and for their pooled
 * mean. Each resample draws, within every stratum, as many paired deltas as
 * that stratum holds, with replacement; the overall statistic of a resample is
 * the mean over every drawn delta, so a stratum weighs by its paired count and
 * an empty stratum contributes nothing rather than a zero.
 * @param strata - the per-environment paired deltas, in the order the result reports them.
 * @param request - the plan digest that seeds every draw, the resample count, and the confidence level.
 * @returns one interval per stratum and the overall interval, both absent where no delta was drawn.
 */
export function bootstrapIntervals(strata: readonly DeltaStratum[], request: BootstrapRequest): BootstrapResult {
  const units = strata.reduce((total, stratum) => total + stratum.deltas.length, 0)
  if (units === 0) return { strata: strata.map(() => undefined) }
  const generators = strata.map(stratum => mulberry32(fnv1a(`${request.digest}:${stratum.key}`)))
  const stratumDraws = strata.map(() => [] as number[])
  const overallDraws: number[] = []
  for (let resample = 0; resample < request.resamples; resample += 1) {
    let pooled = 0
    strata.forEach((stratum, index) => {
      if (stratum.deltas.length === 0) return
      const next = generators[index] as () => number
      let sum = 0
      for (let draw = 0; draw < stratum.deltas.length; draw += 1) {
        sum += stratum.deltas[Math.floor(next() * stratum.deltas.length)] as number
      }
      ;(stratumDraws[index] as number[]).push(sum / stratum.deltas.length)
      pooled += sum
    })
    overallDraws.push(pooled / units)
  }
  return {
    strata: strata.map((stratum, index) => (
      stratum.deltas.length === 0 ? undefined : intervalOf(stratumDraws[index] as number[], request.confidenceLevel)
    )),
    overall: intervalOf(overallDraws, request.confidenceLevel),
  }
}
