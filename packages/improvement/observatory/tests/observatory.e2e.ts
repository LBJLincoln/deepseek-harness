import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import type { ObservatoryPage, ObservatorySnapshot } from '@deepseek-ai/dsh-observatory'

const binScript = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/observatory/driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/observatory/cordis.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

interface DriverResult {
  type: string
  snapshot: ObservatorySnapshot
  current: ObservatoryPage
  stale: ObservatoryPage
}

describe('the observatory through a real cordis.yml and headless process', () => {
  it('withholds the Workshop district from the public page and counts what it withheld', async () => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'observatory',
      tempDirPrefix: 'observatory-e2e-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath],
      tsconfigPath: repoTsconfig,
    })
    expect(stderr).toBe('')
    const result = JSON.parse(stdout.trimEnd().split('\n').at(-1) ?? '') as DriverResult
    expect(result.type).toBe('result')

    // Two training-eligible environments ran once in each district, so the fold
    // reads four sessions and publishes only the two outside the Workshop.
    const { snapshot } = result
    expect(snapshot).toMatchObject({ sessions: 4, unstamped: 0, skipped: [], refreshIntervalMs: 900_000 })
    expect(snapshot.withheld).toEqual({
      districts: ['workshop'],
      districtRows: 2,
      districtSessions: 2,
      heldOutRows: 0,
      heldOutSessions: 0,
    })
    expect(snapshot.rows.map(row => [row.environmentId, row.district])).toEqual([
      ['smoke:round-trip', 'proving-ground'],
      ['smoke:unsatisfiable', 'proving-ground'],
    ])
    expect(snapshot.newestSessionAt).toBeGreaterThan(0)

    // No verdict reaches the page from the logs alone, so no ranking is published.
    expect(snapshot.experiments).toEqual([])

    const { current } = result
    expect(current.json).toMatchObject({ version: 1, stale: false, staleAfterMs: 3_600_000 })
    expect(current.json.rows.map(row => [row.resolved, row.tamper, row.certificateExecutors])).toEqual([
      [1, 'none', ['runner']],
      [0, 'none', []],
    ])
    // The runner's certificate rate is published under its own name; the
    // caseless checks of these environments measure no case weight at all.
    expect(current.json.rows.every(row => !('parity' in row))).toBe(true)
    // No plugin of this composition writes a `composition/manifest`, so the
    // page attributes no row to a composition.
    expect(current.json.rows.every(row => !('compositionSha256' in row))).toBe(true)
    expect(current.html).toContain('<td>pending</td>')
    // The Workshop is named only where the page counts what it withheld.
    expect(current.html).not.toContain('<td>workshop</td>')
    expect(current.html).toContain('Withheld districts: workshop. District rows withheld: 2 (2 sessions).')

    // The same fold past its threshold shows the notice in place of the figures.
    expect(result.stale.json).toMatchObject({ stale: true, rows: [], rankings: [] })
    expect(result.stale.html).not.toContain('<table>')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
