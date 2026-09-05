/**
 * The bootstrap's two obligations: it draws from the frozen plan digest alone,
 * so the same strata replay to the same interval in any process, and an
 * environment with no paired delta contributes nothing rather than a zero.
 */

import { describe, expect, it } from 'vitest'
import { bootstrapIntervals } from '@deepseek-ai/dsh-experiments'
import type { BootstrapRequest, DeltaStratum } from '@deepseek-ai/dsh-experiments'

const DIGEST = 'a'.repeat(64)
const OTHER_DIGEST = 'b'.repeat(64)
const REQUEST: BootstrapRequest = { digest: DIGEST, resamples: 500, confidenceLevel: 0.95 }

/** Alternating wins and losses: mean zero with real spread, so an interval has width. */
const MIXED: readonly number[] = [1, -1, 1, -1, 0, 0, 1, -1]

describe('bootstrapIntervals', () => {
  it('replays the same intervals for the same digest and draws elsewhere for another', () => {
    const strata: DeltaStratum[] = [{ key: 'smoke:round-trip', deltas: MIXED }]
    const first = bootstrapIntervals(strata, REQUEST)
    expect(bootstrapIntervals(strata, REQUEST)).toEqual(first)
    expect(first.overall?.lower).toBeLessThan(0)
    expect(first.overall?.upper).toBeGreaterThan(0)
    expect(first.strata[0]).toEqual(first.overall)

    // Far below convergence the draws still show through the percentiles, which
    // is where a digest-seeded generator is distinguishable from another's.
    const coarse = { ...REQUEST, resamples: 25 }
    expect(bootstrapIntervals(strata, { ...coarse, digest: OTHER_DIGEST }))
      .not.toEqual(bootstrapIntervals(strata, coarse))
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
