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
import type { RunExecutor, RunVerdict } from '@deepseek-ai/dsh-verification/types'
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
  readonly implementer?: string
  readonly ladder?: readonly { readonly provider: string; readonly model: string }[]
  readonly district?: string
  readonly verdict?: RunVerdict
  readonly weightPassed?: number
  readonly executor?: RunExecutor
  readonly composition?: string
  readonly pricing?: { readonly rates: BudgetRoutePricing; readonly digest: string }
}): SessionFactsRecord {
  const overrides = {
    ...options.group === undefined ? {} : { group: options.group },
    ...options.repetition === undefined ? {} : { repetition: options.repetition },
    ...options.heldOut === undefined ? {} : { heldOut: options.heldOut },
    ...options.environmentId === undefined ? {} : { environmentId: options.environmentId },
    ...options.isolation === undefined ? {} : { isolation: options.isolation },
    ...options.implementer === undefined ? {} : { implementer: options.implementer },
    ...options.ladder === undefined ? {} : { ladder: options.ladder },
    ...options.district === undefined ? {} : { district: options.district },
  }
  return foldSessionFacts(header(id), cellLog({
    stamp: stamp(overrides),
    certified: options.certified,
    runs: options.runs,
    ...options.verdict === undefined ? {} : { verdict: options.verdict },
    ...options.weightPassed === undefined ? {} : { weightPassed: options.weightPassed },
    ...options.executor === undefined ? {} : { executor: options.executor },
    ...options.composition === undefined ? {} : { composition: options.composition },
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

  it('splits rows by implementer, so an external coding agent never averages with the route', () => {
    const fold = foldScoreboard([
      cell('routed', { certified: true, runs: 1 }),
      cell('delegated', { certified: false, runs: 1, implementer: 'claude-code' }),
    ], {}, [1])
    expect(fold.rows.map(row => [row.implementer, row.certified])).toEqual([['route', 1], ['claude-code', 0]])
  })

  it('splits rows by attempt ladder, so a laddered cell never averages with a plain one on its first rung', () => {
    const escalating = [{ ...MOCK_ROUTE }, { provider: 'mock', model: 'large' }]
    const fold = foldScoreboard([
      cell('plain', { certified: true, runs: 1 }),
      cell('escalated', { certified: false, runs: 1, ladder: escalating }),
      cell('downshifted', { certified: false, runs: 1, ladder: [{ ...MOCK_ROUTE }, { ...MOCK_ROUTE }] }),
    ], {}, [1])
    expect(fold.rows.map(row => [row.model, row.ladder, row.certified])).toEqual([
      [MOCK_ROUTE.model, undefined, 1],
      [MOCK_ROUTE.model, escalating, 0],
      [MOCK_ROUTE.model, [MOCK_ROUTE, MOCK_ROUTE], 0],
    ])
    expect(fold.rows[0]).not.toHaveProperty('ladder')
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

  it('means the weighted pass rate over the row sessions that carry one, beside the certificate rate', () => {
    const fold = foldScoreboard([
      cell('cased-0', { certified: false, runs: 1, weightPassed: 1 }),
      cell('cased-1', { certified: false, runs: 1, weightPassed: 4 }),
      // A caseless session of the same cell pays into the certificate rate and
      // leaves the weighted mean to the sessions that measured cases.
      cell('caseless', { certified: true, runs: 1 }),
    ], {}, [1])
    expect(fold.rows).toHaveLength(1)
    expect(fold.rows[0]?.parity).toBeCloseTo((1 / 6 + 4 / 6) / 2, 12)
    expect(fold.rows[0]).toMatchObject({ runs: 3, certified: 1 })
    expect(fold.rows[0]?.certificateRate).toBeCloseTo(1 / 3, 12)
  })

  it('states no weighted pass rate for a row whose sessions measured no cases', () => {
    const fold = foldScoreboard([cell('caseless', { certified: true, runs: 1 })], {}, [1])
    expect(fold.rows[0]).not.toHaveProperty('parity')
  })

  it('counts the tampered sessions of the row and leaves a row with no run without a verdict to read', () => {
    const fold = foldScoreboard([
      cell('tampered-0', { certified: false, runs: 1, verdict: 'tampered' }),
      cell('failed-0', { certified: false, runs: 1 }),
      cell('errored-0', { certified: false, runs: 0 }),
    ], {}, [1])
    expect(fold.rows).toHaveLength(1)
    expect(fold.rows[0]).toMatchObject({ runs: 2, errors: 1, tampered: 1 })
  })

  it('states the composition digest only when every session of the row states the same one', () => {
    const shared = foldScoreboard([
      cell('composed-0', { certified: true, runs: 1, composition: 'd'.repeat(64) }),
      cell('composed-1', { certified: false, runs: 1, composition: 'd'.repeat(64) }),
    ], {}, [1])
    expect(shared.rows[0]?.compositionSha256).toBe('d'.repeat(64))

    const disagreeing = foldScoreboard([
      cell('composed-0', { certified: true, runs: 1, composition: 'd'.repeat(64) }),
      cell('composed-2', { certified: false, runs: 1, composition: 'e'.repeat(64) }),
    ], {}, [1])
    expect(disagreeing.rows[0]).not.toHaveProperty('compositionSha256')

    const partial = foldScoreboard([
      cell('composed-0', { certified: true, runs: 1, composition: 'd'.repeat(64) }),
      cell('bare-0', { certified: false, runs: 1 }),
    ], {}, [1])
    expect(partial.rows[0]).not.toHaveProperty('compositionSha256')

    const none = foldScoreboard([cell('bare-0', { certified: false, runs: 1 })], {}, [1])
    expect(none.rows[0]).not.toHaveProperty('compositionSha256')
  })

  it('unions the certificate executors of the row and states none for a row that certified nothing', () => {
    const mixed = foldScoreboard([
      cell('runner-0', { certified: true, runs: 1 }),
      cell('reported-0', { certified: true, runs: 1, executor: 'agent-reported' }),
      cell('runner-1', { certified: true, runs: 1 }),
    ], {}, [1])
    expect(mixed.rows[0]?.certificateExecutors).toEqual(['runner', 'agent-reported'])

    const uncertified = foldScoreboard([cell('failed-0', { certified: false, runs: 1 })], {}, [1])
    expect(uncertified.rows[0]?.certificateExecutors).toEqual([])
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
