/**
 * With-key style e2e: it drives the REAL Claude Code product on the host's own
 * installation and account, so it self-skips unless `DSH_E2E_CLAUDE_CODE=1` is
 * set and is run by hand. Nothing in CI holds that authentication, and the run
 * costs the host's own product quota; `docs/testing.md` owns the key policy this
 * follows.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { EnvironmentDelegation } from '@deepseek-ai/dsh-environment-runner/types'
import type { FleetRunReport } from '@deepseek-ai/dsh-fleet/types'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import type { ObservatoryDocument } from '@deepseek-ai/dsh-observatory/types'
import type { FactsExportReport } from '@deepseek-ai/dsh-scorekeeper/types'
import type { TrajectoryExportReport } from '@deepseek-ai/dsh-trajectories/types'

const binScript = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/village-claude-implementer/driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/village-claude-implementer/cordis.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

/** Four real product sessions at worst — two cells, two attempts each — plus the composition's own boot. */
const PRODUCT_RUN_TIMEOUT_MS = 900_000

interface DriverResult {
  type: string
  report: FleetRunReport
  delegations: Record<string, EnvironmentDelegation[]>
  facts: FactsExportReport
  exported: TrajectoryExportReport
  document: ObservatoryDocument
}

describe.skipIf(process.env.DSH_E2E_CLAUDE_CODE !== '1')('the Proving Ground with the real product as implementer', () => {
  it('delegates every attempt to the product and certifies on the trees it left', { timeout: PRODUCT_RUN_TIMEOUT_MS + 60_000, retry: 0 }, async () => {
    let observatory = ''
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'village-claude-implementer',
      tempDirPrefix: 'village-claude-implementer-e2e-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath],
      tsconfigPath: repoTsconfig,
      processTimeoutMs: PRODUCT_RUN_TIMEOUT_MS,
      inspect: async (cwd) => {
        observatory = await readFile(join(cwd, 'observatory.html'), 'utf8')
      },
    })
    expect(stderr).toBe('')
    const result = JSON.parse(stdout.trimEnd().split('\n').at(-1) ?? '') as DriverResult
    expect(result.type).toBe('result')

    // Every cell reached the runner and was stamped with the product provider.
    expect(result.report.cells).toHaveLength(2)
    const stamps = result.report.cells.flatMap(outcome => ('report' in outcome ? [outcome.report.stamp] : []))
    expect(stamps).toHaveLength(2)
    expect(stamps.map(stamp => stamp.implementer)).toEqual(['claude-code', 'claude-code'])
    expect(result.report.leaderboard.map(row => row.implementer)).toEqual(['claude-code', 'claude-code'])

    // One child run per attempt, each recorded durably in the cell session.
    for (const outcome of result.report.cells) {
      if (!('report' in outcome)) continue
      const recorded = result.delegations[outcome.cell.environment] ?? []
      expect(recorded.map(delegation => delegation.attempt)).toEqual(outcome.report.attempts.map(attempt => attempt.attempt))
      expect(recorded.every(delegation => delegation.provider === 'claude-code')).toBe(true)
      // The product runs out of this process, so no usage of it reaches our log.
      expect(recorded.every(delegation => delegation.usage === undefined)).toBe(true)
    }

    // The publication side folds the same sessions the run left behind.
    expect(result.facts.exported).toBe(result.facts.sessions)
    expect(result.exported.skipped).toEqual([])
    expect(result.document.rows.every(row => row.implementer === 'claude-code')).toBe(true)
    expect(observatory).toContain('<th scope="col">Implementer</th>')
  })
})
