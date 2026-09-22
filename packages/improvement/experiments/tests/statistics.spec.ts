/**
 * The bootstrap's obligations: it draws from the frozen plan digest alone, so
 * the same strata replay to the same intervals in any process; the overall
 * interval resamples environments as well as the deltas inside them, so an
 * effect one environment carries is not read as certain; and an environment
 * with no paired delta contributes nothing rather than a zero.
 */

import { describe, expect, it } from 'vitest'
import { bootstrapIntervals, EXPERIMENT_STATISTIC, readPairedDeltas, readStatistic } from '@deepseek-ai/dsh-experiments'
import type { BootstrapRequest, DeltaStratum, ExperimentThresholds } from '@deepseek-ai/dsh-experiments'

const DIGEST = 'a'.repeat(64)
const OTHER_DIGEST = 'b'.repeat(64)
const REQUEST: BootstrapRequest = { digest: DIGEST, resamples: 500, confidenceLevel: 0.95 }

/** Alternating wins and losses: mean zero with real spread, so an interval has width. */
const MIXED: readonly number[] = [1, -1, 1, -1, 0, 0, 1, -1]

/** The seven tier-5 environments on which both arms of the 2026-09-21 E7 pair agreed on both repetitions. */
const AGREEING = ['code:build-schedule', 'code:diff3-merge', 'code:lex-states', 'code:ranked-choice', 'code:rate-limit-sim', 'code:sheet-eval', 'code:uri-resolve']

/** One environment the candidate flips on both repetitions beside seven where the arms agree: the 2026-09-21 E7 pair. */
const ONE_ENVIRONMENT_FLIPS: readonly DeltaStratum[] = [
  { key: 'code:conf-canon', deltas: [1, 1] },
  ...AGREEING.map(key => ({ key, deltas: [0, 0] })),
]

/** The proving-ground bench thresholds under the default discordant-pair minimum. */
const BENCH: ExperimentThresholds = {
  bootstrapResamples: 2000,
  confidenceLevel: 0.95,
  minimumDelta: 0.05,
  minimumDiscordantPairs: 2,
  cellTokenCap: 600000,
}

describe('bootstrapIntervals', () => {
  it('replays the same intervals for the same digest and draws elsewhere for another', () => {
    const strata: DeltaStratum[] = [{ key: 'smoke:round-trip', deltas: MIXED }]
    const first = bootstrapIntervals(strata, REQUEST)
    expect(bootstrapIntervals(strata, REQUEST)).toEqual(first)
    expect(first.overall?.lower).toBeLessThan(0)
    expect(first.overall?.upper).toBeGreaterThan(0)

    // Far below convergence the draws still show through the percentiles, which
    // is where a digest-seeded generator is distinguishable from another's.
    const coarse = { ...REQUEST, resamples: 25 }
    expect(bootstrapIntervals(strata, { ...coarse, digest: OTHER_DIGEST }))
      .not.toEqual(bootstrapIntervals(strata, coarse))
  })

  it('seeds the overall pass from the digest alone and each stratum from its own key', () => {
    const coarse = { ...REQUEST, resamples: 25 }
    const named = bootstrapIntervals([{ key: 'smoke:round-trip', deltas: MIXED }], coarse)
    const renamed = bootstrapIntervals([{ key: 'smoke:renamed', deltas: MIXED }], coarse)
    expect(renamed.overall).toEqual(named.overall)
    expect(renamed.strata[0]).not.toEqual(named.strata[0])
  })

  it('widens an effect one environment carries, which no environment\'s own resample can move', () => {
    const result = bootstrapIntervals(ONE_ENVIRONMENT_FLIPS, { ...REQUEST, resamples: 2000 })
    expect(result.strata).toEqual([{ lower: 1, upper: 1 }, ...AGREEING.map(() => ({ lower: 0, upper: 0 }))])
    // A resample draws the flipping environment k times with k binomial over
    // eight draws at one in eight, and its mean is k/8: k is zero in about 34%
    // of resamples and at most three in about 99%, which pins both percentiles.
    expect(result.overall).toEqual({ lower: 0, upper: 0.375 })
  })

  it('replays the cluster draws exactly under one digest', () => {
    const strata: DeltaStratum[] = [
      { key: 'code:conf-canon', deltas: [0, 1, 0, 0, 1, 1] },
      { key: 'code:sheet-eval', deltas: [-1, 1, 0, -1, 0, 0] },
      ...AGREEING.filter(key => key !== 'code:sheet-eval').map(key => ({ key, deltas: [0, 0, 0, 0, 0, 0] })),
    ]
    const coarse = { ...REQUEST, resamples: 40 }
    const first = bootstrapIntervals(strata, coarse)
    expect(bootstrapIntervals(strata, coarse)).toEqual(first)
    expect(bootstrapIntervals([...strata].reverse(), coarse).overall).toEqual(first.overall)
    expect(bootstrapIntervals(strata, { ...coarse, digest: OTHER_DIGEST }).overall).not.toEqual(first.overall)
  })

  it('seeds each stratum from its own key, so reordering strata keeps every interval', () => {
    const left: DeltaStratum = { key: 'smoke:round-trip', deltas: MIXED }
    const right: DeltaStratum = { key: 'smoke:unsatisfiable', deltas: [1, 1, 0, 0] }
    const forward = bootstrapIntervals([left, right], REQUEST)
    const backward = bootstrapIntervals([right, left], REQUEST)
    expect(backward.strata).toEqual([forward.strata[1], forward.strata[0]])
    expect(backward.overall).toEqual(forward.overall)
    expect(forward.strata[0]).not.toEqual(forward.strata[1])
  })

  it('leaves a stratum with no delta without an interval and out of the pooled draw', () => {
    const populated: DeltaStratum = { key: 'smoke:round-trip', deltas: MIXED }
    const empty: DeltaStratum = { key: 'smoke:unsatisfiable', deltas: [] }
    const mixed = bootstrapIntervals([populated, empty], REQUEST)
    expect(mixed.strata[1]).toBeUndefined()
    expect(mixed.overall).toEqual(bootstrapIntervals([populated], REQUEST).overall)
  })

  it('reports no interval at all when nothing paired anywhere', () => {
    const result = bootstrapIntervals([{ key: 'smoke:round-trip', deltas: [] }], REQUEST)
    expect(result.strata).toEqual([undefined])
    expect(result).not.toHaveProperty('overall')
  })

  it('collapses to the single observed value when every delta agrees, at any confidence level', () => {
    const strata: DeltaStratum[] = [{ key: 'smoke:round-trip', deltas: [1, 1, 1] }]
    expect(bootstrapIntervals(strata, REQUEST).overall).toEqual({ lower: 1, upper: 1 })
    expect(bootstrapIntervals(strata, { ...REQUEST, confidenceLevel: 1 }).overall).toEqual({ lower: 1, upper: 1 })
  })

  it('widens the interval as the confidence level rises', () => {
    const strata: DeltaStratum[] = [{ key: 'smoke:round-trip', deltas: MIXED }]
    const narrow = bootstrapIntervals(strata, { ...REQUEST, confidenceLevel: 0.5 }).overall
    const wide = bootstrapIntervals(strata, { ...REQUEST, confidenceLevel: 0.99 }).overall
    expect(wide?.lower).toBeLessThanOrEqual(narrow?.lower as number)
    expect(wide?.upper).toBeGreaterThanOrEqual(narrow?.upper as number)
  })

  it('draws exactly the requested number of resamples, down to one', () => {
    const strata: DeltaStratum[] = [{ key: 'smoke:round-trip', deltas: MIXED }]
    const single = bootstrapIntervals(strata, { ...REQUEST, resamples: 1 }).overall
    expect(single?.lower).toBe(single?.upper)
  })
})

describe('readPairedDeltas', () => {
  it('reads the 2026-09-21 E7 pair as inconclusive where resampling inside each environment promoted it', () => {
    const reading = readPairedDeltas(ONE_ENVIRONMENT_FLIPS, { digest: DIGEST, thresholds: BENCH })
    expect(reading).toEqual({
      statistic: EXPERIMENT_STATISTIC,
      strata: [{ lower: 1, upper: 1 }, ...AGREEING.map(() => ({ lower: 0, upper: 0 }))],
      interval: { lower: 0, upper: 0.375 },
      discordantPairs: 2,
      verdict: 'inconclusive',
      verdictBasis: 'interval',
    })
  })

  it('withholds a verdict the interval would give while fewer pairs than the minimum disagree', () => {
    // One environment, both repetitions flipped: the interval cannot move and would promote.
    const flipped: DeltaStratum[] = [{ key: 'code:conf-canon', deltas: [1, 1] }]
    expect(readPairedDeltas(flipped, { digest: DIGEST, thresholds: BENCH }))
      .toMatchObject({ interval: { lower: 1, upper: 1 }, discordantPairs: 2, verdict: 'promote', verdictBasis: 'interval' })
    expect(readPairedDeltas(flipped, { digest: DIGEST, thresholds: { ...BENCH, minimumDiscordantPairs: 3 } }))
      .toMatchObject({ interval: { lower: 1, upper: 1 }, discordantPairs: 2, verdict: 'inconclusive', verdictBasis: 'too-few-discordant-pairs' })

    const worse: DeltaStratum[] = [{ key: 'code:conf-canon', deltas: [-1, 0] }]
    expect(readPairedDeltas(worse, { digest: DIGEST, thresholds: BENCH }))
      .toMatchObject({ discordantPairs: 1, verdict: 'inconclusive', verdictBasis: 'too-few-discordant-pairs' })
    expect(readPairedDeltas(worse, { digest: DIGEST, thresholds: { ...BENCH, minimumDiscordantPairs: 0 } }))
      .toMatchObject({ verdict: 'inconclusive', verdictBasis: 'interval' })
  })

  it('reads the absence of pairs, with no interval, when nothing paired', () => {
    const reading = readPairedDeltas([{ key: 'code:conf-canon', deltas: [] }], { digest: DIGEST, thresholds: BENCH })
    expect(reading).toEqual({
      statistic: EXPERIMENT_STATISTIC,
      strata: [undefined],
      discordantPairs: 0,
      verdict: 'inconclusive',
      verdictBasis: 'no-pairs',
    })
  })
})

describe('readStatistic', () => {
  it('reads a stored result that names no statistic as the one that resampled inside environments alone', () => {
    expect(readStatistic(undefined)).toBe('paired-bootstrap/0')
    expect(readStatistic('paired-bootstrap/0')).toBe('paired-bootstrap/0')
    expect(readStatistic('paired-cluster-bootstrap/1')).toBe(EXPERIMENT_STATISTIC)
  })

  it('refuses a statistic this package does not define', () => {
    expect(() => readStatistic('paired-cluster-bootstrap/2')).toThrow(new TypeError('unknown experiment statistic "paired-cluster-bootstrap/2"'))
    expect(() => readStatistic(1)).toThrow(TypeError)
  })
})
