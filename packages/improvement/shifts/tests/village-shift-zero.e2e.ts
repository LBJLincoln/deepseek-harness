import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import type { ObservatoryDocument } from '@deepseek-ai/dsh-observatory'
import type { FactsExportReport } from '@deepseek-ai/dsh-scorekeeper'
import type { TrajectoryExportReport } from '@deepseek-ai/dsh-trajectories'

const binScript = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/village-shift-zero/driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/village-shift-zero/cordis.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

interface DriverResult {
  type: string
  ledgers: { sessionId: string; events: { type: string; data: unknown }[] }[]
  document: ObservatoryDocument
  facts: FactsExportReport
  exported: TrajectoryExportReport
}

describe('a keyless shift zero of the Village through one cordis.yml', () => {
  it('runs both districts, publishes only the Proving Ground, and exports facts and withheld trajectories', async () => {
    let html = ''
    let trajectoryLines: string[] = []
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'village-shift-zero',
      tempDirPrefix: 'village-shift-zero-e2e-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath],
      tsconfigPath: repoTsconfig,
      inspect: async (cwd) => {
        html = await readFile(join(cwd, 'observatory.html'), 'utf8')
        trajectoryLines = (await readFile(join(cwd, 'trajectories.jsonl'), 'utf8')).trimEnd().split('\n')
      },
    })
    expect(stderr).toBe('')
    const result = JSON.parse(stdout.trimEnd().split('\n').at(-1) ?? '') as DriverResult
    expect(result.type).toBe('result')

    // One ledger per district, each opened and closed in this process.
    expect(result.ledgers).toHaveLength(2)
    for (const ledger of result.ledgers) {
      expect(ledger.events[0]?.type).toBe('shift/start')
      expect(ledger.events.at(-1)?.type).toBe('shift/end')
    }
    const cellsPerLedger = result.ledgers.map(ledger => ledger.events.filter(event => event.type === 'shift/cell').length).sort()
    expect(cellsPerLedger).toEqual([1, 4])

    // The page publishes the Proving Ground and withholds the Workshop, counted.
    expect(result.document.stale).toBe(false)
    expect(result.document.rows.map(row => [row.environmentId, row.district])).toEqual([
      ['smoke:round-trip', 'proving-ground'],
      ['smoke:unsatisfiable', 'proving-ground'],
    ])
    expect(result.document.withheld).toMatchObject({ districts: ['workshop'], districtRows: 1, districtSessions: 1 })
    const certified = result.document.rows[0]
    expect(certified).toMatchObject({ runs: 2, certified: 2, resolved: 1, tamper: 'none', certificateExecutors: ['runner'] })
    expect(certified?.costEurPerCertified).toBeGreaterThan(0)
    expect(certified?.pricingDigest).toMatch(/^[0-9a-f]{64}$/)
    // The page names the withheld district in its counts and never as a row.
    expect(html).toContain('smoke:round-trip')
    expect(result.document.rows.some(row => row.district === 'workshop')).toBe(false)

    // Every session folds into facts; the export withholds the Workshop session.
    expect(result.facts).toMatchObject({ sessions: 7, exported: 7, skipped: [] })
    expect(result.exported).toMatchObject({ sessions: 7, exported: 6, rewarded: 2, withheld: 1, skipped: [] })
    expect(trajectoryLines).toHaveLength(6)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
