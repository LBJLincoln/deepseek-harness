/**
 * The pure scoreboard fold: one row per model route, environment, isolation
 * level, held-out split, and district; a stamped session without a recorded run
 * is an error column rather than a missing row; pass@k is estimated only over
 * the batches that hold at least `k` sessions; and a row states a cost per
 * certified session only when every certified session of the row logged one.
 */

import { describe, expect, it } from 'vitest'
import { pricingTableDigest } from '@deepseek-ai/dsh-budget-policy'
import type { BudgetRoutePricing } from '@deepseek-ai/dsh-budget-policy'
import { foldScoreboard, foldSessionFacts, unbiasedPassAtK } from '@deepseek-ai/dsh-scorekeeper'
import type { SessionFactsRecord } from '@deepseek-ai/dsh-scorekeeper'
import { cellLog, header, Log, MOCK_ROUTE, stamp } from './log.ts'

/** The rates one deployment priced the mock route at, and the rates that replaced them. */
const RATES: BudgetRoutePricing = { inputEurPerMillionTokens: 1, outputEurPerMillionTokens: 2 }
const NEXT_RATES: BudgetRoutePricing = { inputEurPerMillionTokens: 3, outputEurPerMillionTokens: 4 }

const ROUTE_KEY = `${MOCK_ROUTE.provider}/${MOCK_ROUTE.model}`
const DIGEST = pricingTableDigest({ [ROUTE_KEY]: RATES })
const NEXT_DIGEST = pricingTableDigest({ [ROUTE_KEY]: NEXT_RATES })

/** What one cell's twelve-in three-out step costs at the given rates. */
function costOf(rates: BudgetRoutePricing): number {
  return (12 * rates.inputEurPerMillionTokens + 3 * rates.outputEurPerMillionTokens) / 1_000_000
}

/** One cell's facts record, as the service folds it out of persistence. */
function cell(id: string, options: {
  readonly certified: boolean
  readonly runs: number
  readonly group?: string
  readonly repetition?: number
  readonly heldOut?: boolean
  readonly environmentId?: string
  readonly isolation?: string
  readonly district?: string
  readonly pricing?: { readonly rates: BudgetRoutePricing; readonly digest: string }
}): SessionFactsRecord {
  const overrides = {
    ...options.group === undefined ? {} : { group: options.group },
    ...options.repetition === undefined ? {} : { repetition: options.repetition },
    ...options.heldOut === undefined ? {} : { heldOut: options.heldOut },
    ...options.environmentId === undefined ? {} : { environmentId: options.environmentId },
    ...options.isolation === undefined ? {} : { isolation: options.isolation },
    ...options.district === undefined ? {} : { district: options.district },
  }
  return foldSessionFacts(header(id), cellLog({
    stamp: stamp(overrides),
    certified: options.certified,
    runs: options.runs,
    ...options.pricing === undefined ? {} : { pricing: options.pricing },
  }))
}

/** A session no runner stamped. */
function unstamped(id: string): SessionFactsRecord {
  const log = new Log()
  log.assistant({ inputTokens: 1, outputTokens: 1 })
  return foldSessionFacts(header(id), log.events)
}

describe('unbiasedPassAtK', () => {
  it('is one when fewer than k sessions missed and rises with the certified share otherwise', () => {
    expect(unbiasedPassAtK(4, 3, 2)).toBe(1)
    expect(unbiasedPassAtK(2, 1, 1)).toBe(0.5)
    expect(unbiasedPassAtK(4, 0, 2)).toBe(0)
    expect(unbiasedPassAtK(4, 1, 2)).toBeCloseTo(0.5, 10)
  })
})

describe('foldScoreboard', () => {
  it('folds one row per cell with its rates, token sums, and pass@k over each batch', () => {
    const records = [
      cell('a0', { certified: true, runs: 1, group: 'batch-1', repetition: 0 }),
      cell('a1', { certified: false, runs: 2, group: 'batch-1', repetition: 1 }),
      cell('b0', { certified: true, runs: 1, group: 'batch-2', repetition: 0 }),
      cell('c0', { certified: false, runs: 2, environmentId: 'smoke:unsatisfiable' }),
    ]
    const fold = foldScoreboard(records, {}, [1, 2, 3])
    expect(fold).toMatchObject({ excluded: 0, unstamped: 0 })
    expect(fold.rows).toHaveLength(2)
    expect(fold.rows[0]).toMatchObject({
      provider: 'cli-mock',
      model: 'cli-mock',
      environmentId: 'smoke:round-trip',
      environmentKind: 'smoke',
      heldOut: false,
      isolation: 'none',
      runs: 3,
      errors: 0,
      certified: 2,
      attemptsMean: 4 / 3,
      inputTokens: 36,
      outputTokens: 9,
    })
    expect(fold.rows[0]?.certificateRate).toBeCloseTo(2 / 3, 10)
    expect(fold.rows[0]?.stats).toEqual({
      groups: 2,
      samples: 3,
      passAtK: [
        { k: 1, value: 0.75, groups: 2 },
        { k: 2, value: 1, groups: 1 },
      ],
    })
    expect(fold.rows[1]).toMatchObject({ environmentId: 'smoke:unsatisfiable', runs: 1, certified: 0, certificateRate: 0 })
    expect(fold.rows[1]?.stats).toEqual({ groups: 0, samples: 0, passAtK: [] })
  })

  it('keeps a stamped session that recorded no run as an error column with zeroed rates', () => {
    const fold = foldScoreboard([cell('errored', { certified: false, runs: 0 })], {}, [1])
    expect(fold.rows[0]).toMatchObject({ runs: 0, errors: 1, certified: 0, certificateRate: 0, attemptsMean: 0 })
  })

  it('splits rows by isolation level and by the held-out flag', () => {
    const fold = foldScoreboard([
      cell('none', { certified: true, runs: 1 }),
      cell('host', { certified: true, runs: 1, isolation: 'host' }),
      cell('reserved', { certified: true, runs: 1, heldOut: true }),
    ], {}, [1])
    expect(fold.rows.map(row => [row.isolation, row.heldOut])).toEqual([['none', false], ['host', false], ['none', true]])
  })

  it('splits rows by district and never merges two districts of the same cell', () => {
    const fold = foldScoreboard([
      cell('workshop-0', { certified: true, runs: 1, district: 'workshop' }),
      cell('proving-0', { certified: true, runs: 1, district: 'proving-ground' }),
      cell('proving-1', { certified: false, runs: 1, district: 'proving-ground' }),
      cell('undistricted', { certified: true, runs: 1 }),
    ], {}, [1])
    expect(fold.rows.map(row => [row.district, row.runs, row.certified]))
      .toEqual([['workshop', 1, 1], ['proving-ground', 2, 1], [undefined, 1, 1]])
    expect(fold.rows[2]).not.toHaveProperty('district')
  })

  it('averages cost over the certified sessions and unions the pricing digests of every session', () => {
    const fold = foldScoreboard([
      cell('priced-0', { certified: true, runs: 1, pricing: { rates: RATES, digest: DIGEST } }),
      cell('priced-1', { certified: true, runs: 1, pricing: { rates: NEXT_RATES, digest: NEXT_DIGEST } }),
      // An uncertified session of the row pays into the digests but not the mean.
      cell('priced-2', { certified: false, runs: 1, pricing: { rates: RATES, digest: DIGEST } }),
    ], {}, [1])
    expect(fold.rows).toHaveLength(1)
    expect(fold.rows[0]?.pricingDigests).toEqual([DIGEST, NEXT_DIGEST])
    expect(fold.rows[0]?.costEurPerCertified).toBeCloseTo((costOf(RATES) + costOf(NEXT_RATES)) / 2, 15)
  })

  it('states no cost per certified session when one certified session of the row logged none', () => {
    const fold = foldScoreboard([
      cell('priced', { certified: true, runs: 1, pricing: { rates: RATES, digest: DIGEST } }),
      cell('unpriced', { certified: true, runs: 1 }),
    ], {}, [1])
    expect(fold.rows[0]?.costEurPerCertified).toBeUndefined()
    expect(fold.rows[0]).toMatchObject({ certified: 2, pricingDigests: [DIGEST] })
  })

  it('states no cost per certified session for a row that certified nothing', () => {
    const fold = foldScoreboard([
      cell('failed', { certified: false, runs: 2, pricing: { rates: RATES, digest: DIGEST } }),
    ], {}, [1])
    expect(fold.rows[0]?.costEurPerCertified).toBeUndefined()
    expect(fold.rows[0]?.pricingDigests).toEqual([DIGEST])
  })

  it('excludes stamped sessions the group and held-out conditions reject, and rows no stamp names', () => {
    const records = [
      cell('kept', { certified: true, runs: 1, group: 'batch-1' }),
      cell('other-batch', { certified: true, runs: 1, group: 'batch-2' }),
      cell('reserved', { certified: true, runs: 1, group: 'batch-1', heldOut: true }),
      unstamped('no-stamp'),
    ]
    const fold = foldScoreboard(records, { group: 'batch-1', heldOut: false }, [1])
    expect(fold).toMatchObject({ excluded: 2, unstamped: 1 })
    expect(fold.rows).toHaveLength(1)
    expect(fold.rows[0]?.runs).toBe(1)
  })
})
