/**
 * The publication rules as they decide what a page may state: what withholding
 * removes and what it counts, when a fold goes stale, which verdicts may be
 * ranked, and which figures one row may publish.
 */

import { describe, expect, it } from 'vitest'
import type { ScoreboardRow } from '@deepseek-ai/dsh-scorekeeper/types'
import { isStale, orderRows, publishDocument, publishRow, rankable, withhold } from '@deepseek-ai/dsh-observatory'
import { experiment, row, snapshot } from './row.ts'

const DIGEST = 'a'.repeat(64)
const OTHER_DIGEST = 'b'.repeat(64)
const COMPOSITION = 'c'.repeat(64)

const WITHHOLD_WORKSHOP = { districts: ['workshop'], heldOut: true }

describe('withhold', () => {
  it('drops the withheld districts and the held-out split from the public rows and counts both', () => {
    const split = withhold([
      row({ district: 'workshop', runs: 3, errors: 1 }),
      row({ heldOut: true, runs: 2, errors: 2 }),
      row({ district: 'proving-ground', runs: 2, errors: 0 }),
      row({ runs: 1, errors: 0 }),
    ], WITHHOLD_WORKSHOP)
    expect(split.published.map(published => published.district)).toEqual(['proving-ground', undefined])
    expect(split).toMatchObject({
      districtRows: 1,
      districtSessions: 4,
      heldOutRows: 1,
      heldOutSessions: 4,
    })
  })

  it('counts a row withheld for both reasons under its district alone', () => {
    const split = withhold([row({ district: 'workshop', heldOut: true, runs: 2, errors: 0 })], WITHHOLD_WORKSHOP)
    expect(split.published).toEqual([])
    expect(split).toMatchObject({ districtRows: 1, districtSessions: 2, heldOutRows: 0, heldOutSessions: 0 })
  })

  it('publishes the held-out split when the deployment does not withhold it', () => {
    const split = withhold([row({ heldOut: true }), row({ district: 'workshop' })], { districts: [], heldOut: false })
    expect(split.published.map(published => published.heldOut)).toEqual([true, false])
    expect(split).toMatchObject({ districtRows: 0, heldOutRows: 0 })
  })
})

describe('orderRows', () => {
  it('orders by route, attempt ladder, environment, isolation, implementer, held-out split, and district whatever order the fold produced', () => {
    const escalating = [{ provider: 'cli-mock', model: 'a' }, { provider: 'cli-mock', model: 'b' }]
    const ordered = orderRows([
      row({ model: 'b', environmentId: 'smoke:round-trip' }),
      row({ model: 'a', environmentId: 'smoke:unsatisfiable', district: 'proving-ground' }),
      row({ model: 'a', environmentId: 'smoke:round-trip', heldOut: true }),
      row({ model: 'a', environmentId: 'smoke:round-trip', isolation: 'host' }),
      row({ model: 'a', environmentId: 'smoke:round-trip', implementer: 'claude-code' }),
      row({ model: 'a', environmentId: 'smoke:round-trip', ladder: escalating }),
      row({ model: 'a', environmentId: 'smoke:round-trip' }),
    ])
    const key = (entry: ScoreboardRow): unknown[] => (
      [entry.model, entry.ladder?.length ?? 0, entry.environmentId, entry.isolation, entry.implementer, entry.heldOut]
    )
    expect(ordered.map(key)).toEqual([
      ['a', 2, 'smoke:round-trip', 'none', 'route', false],
      ['a', 0, 'smoke:round-trip', 'host', 'route', false],
      ['a', 0, 'smoke:round-trip', 'none', 'claude-code', false],
      ['a', 0, 'smoke:round-trip', 'none', 'route', false],
      ['a', 0, 'smoke:round-trip', 'none', 'route', true],
      ['a', 0, 'smoke:unsatisfiable', 'none', 'route', false],
      ['b', 0, 'smoke:round-trip', 'none', 'route', false],
    ])
  })
})

describe('isStale', () => {
  it('switches at the exact threshold and treats a fold that read no session as stale', () => {
    const current = snapshot({ newestSessionAt: 1000 })
    expect(isStale(current, 1000 + 60_000, 60_000)).toBe(false)
    expect(isStale(current, 1000 + 60_001, 60_000)).toBe(true)
    const { newestSessionAt: _absent, ...empty } = current
    expect(isStale(empty, 1000, 60_000)).toBe(true)
  })
})

describe('publishRow', () => {
  it('publishes the certificate rate as resolved and the weighted pass rate as parity, never one as the other', () => {
    const published = publishRow(row({ runs: 4, certified: 1, certificateRate: 0.25, parity: 0.75 }))
    expect(published.resolved).toBe(0.25)
    expect(published.parity).toBe(0.75)
    // Nothing on the published row merges the two, and neither is computed from the other.
    expect(Object.values(published)).not.toContain(0.5)
  })

  it('publishes no parity for a row whose sessions measured no cases', () => {
    expect(publishRow(row())).not.toHaveProperty('parity')
  })

  it('publishes the cost only beside the one pricing digest that priced the row', () => {
    const priced = publishRow(row({ costEurPerCertified: 0.000_12, pricingDigests: [DIGEST] }))
    expect(priced).toMatchObject({ costEurPerCertified: 0.000_12, pricingDigest: DIGEST })
  })

  it('publishes no cost for a row priced under two pricing tables', () => {
    const mixed = publishRow(row({ costEurPerCertified: 0.000_12, pricingDigests: [DIGEST, OTHER_DIGEST] }))
    expect(mixed).not.toHaveProperty('costEurPerCertified')
    expect(mixed).not.toHaveProperty('pricingDigest')
  })

  it('publishes no cost for a row that carries a digest but no mean, and none for a row that carries neither', () => {
    expect(publishRow(row({ pricingDigests: [DIGEST] }))).not.toHaveProperty('costEurPerCertified')
    expect(publishRow(row({ costEurPerCertified: 0.5 }))).not.toHaveProperty('pricingDigest')
  })

  it('carries the composition digest through and leaves it absent for a row that states none', () => {
    expect(publishRow(row({ compositionSha256: COMPOSITION })).compositionSha256).toBe(COMPOSITION)
    expect(publishRow(row())).not.toHaveProperty('compositionSha256')
  })

  it('states the tamper axis as not instrumented, tampered, or none', () => {
    expect(publishRow(row({ runs: 0, errors: 2, certified: 0, certificateRate: 0 })).tamper).toBe('not-instrumented')
    expect(publishRow(row({ tampered: 1 })).tamper).toBe('tampered')
    expect(publishRow(row()).tamper).toBe('none')
  })

  it('keeps the district of a districted row and states none for a row outside every district', () => {
    expect(publishRow(row({ district: 'proving-ground' })).district).toBe('proving-ground')
    expect(publishRow(row())).not.toHaveProperty('district')
  })
})

describe('rankable', () => {
  it('keeps a verdict whose two arm routes both appear in the published rows', () => {
    const rows = [row({ model: 'left' }), row({ model: 'right' })]
    expect(rankable([experiment('left', 'right', 'promote')], rows)).toHaveLength(1)
  })

  it('drops a verdict about a route the page does not publish', () => {
    const rows = [row({ model: 'left' })]
    expect(rankable([experiment('left', 'withheld', 'promote')], rows)).toEqual([])
    expect(rankable([experiment('withheld', 'left', 'promote')], rows)).toEqual([])
  })
})

describe('publishDocument', () => {
  it('publishes the rows and rankings of a current fold', () => {
    const document = publishDocument(
      snapshot({
        rows: [row({ model: 'left' }), row({ model: 'right' })],
        experiments: [experiment('left', 'right', 'inconclusive')],
      }),
      1_000_500,
      60_000,
    )
    expect(document).toMatchObject({ version: 1, stale: false, staleAfterMs: 60_000, refreshIntervalMs: 900_000 })
    expect(document.rows).toHaveLength(2)
    expect(document.rankings).toEqual([{
      digest: 'f'.repeat(64),
      baseline: { provider: 'cli-mock', model: 'left' },
      candidate: { provider: 'cli-mock', model: 'right' },
      delta: 0.25,
      verdict: 'inconclusive',
    }])
  })

  it('publishes no ranking for a fold that carries no experiment verdict', () => {
    const document = publishDocument(snapshot({ rows: [row()] }), 1_000_500, 60_000)
    expect(document.rankings).toEqual([])
    expect(document.rows).toHaveLength(1)
  })

  it('publishes no row and no ranking once the fold is stale, and keeps the withheld counts', () => {
    const stale = publishDocument(
      snapshot({ rows: [row()], experiments: [experiment('cli-mock', 'cli-mock', 'promote')] }),
      1_000_000 + 60_001,
      60_000,
    )
    expect(stale).toMatchObject({ stale: true, rows: [], rankings: [] })
    expect(stale.withheld).toEqual({ districts: [], districtRows: 0, districtSessions: 0, heldOutRows: 0, heldOutSessions: 0 })
  })

  it('states no newest session for a fold that read none', () => {
    const { newestSessionAt: _absent, ...empty } = snapshot()
    expect(publishDocument(empty, 1_000_500, 60_000)).not.toHaveProperty('newestSessionAt')
  })
})
