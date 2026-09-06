/**
 * With-key style e2e: it drives the REAL Claude Code product on the host's own
 * installation and account, so it self-skips unless `DSH_E2E_CLAUDE_CODE=1` is
 * set and is run by hand. Nothing in CI holds that authentication, the run
 * costs the host's own product quota, and the host's permission settings must
 * allow unattended file edits and `node` commands, as the fixture's cordis.yml
 * states; `docs/testing.md` owns the key policy this follows.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const binScript = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/village-live/driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/village-live/cordis.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

/** Three program cells at two attempts each, two at a time, plus the composition's own boot. */
const PRODUCT_RUN_TIMEOUT_MS = 1_800_000

interface Status {
  type: string
  phase: string
  ledgers: { sessionId: string; cells: number; ended: boolean; outcome?: unknown }[]
  rows: { environmentId: string; implementer: string }[]
}

describe.skipIf(process.env.DSH_E2E_CLAUDE_CODE !== '1')('the live Proving Ground with the real product as implementer', () => {
  it('runs the due slot of the district over the program tasks and publishes its rows', { timeout: PRODUCT_RUN_TIMEOUT_MS + 60_000, retry: 0 }, async () => {
    let status = ''
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'village-live',
      tempDirPrefix: 'village-live-e2e-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath, '--once'],
      tsconfigPath: repoTsconfig,
      processTimeoutMs: PRODUCT_RUN_TIMEOUT_MS,
      inspect: async (cwd) => {
        status = await readFile(join(cwd, 'status.json'), 'utf8')
      },
    })
    expect(stderr).toBe('')
    const result = JSON.parse(stdout.trimEnd().split('\n').at(-1) ?? '') as Status
    expect(result.type).toBe('status')
    expect(result.phase).toBe('once')

    // One slot, one ledger, every training-eligible environment run once.
    expect(result.ledgers).toHaveLength(1)
    expect(result.ledgers[0]).toMatchObject({ cells: 3, ended: true, outcome: 'completed' })

    // Every published row names the product as its implementer; the held-out task never ran.
    expect(result.rows.length).toBeGreaterThan(0)
    expect(result.rows.every(row => row.implementer === 'claude-code')).toBe(true)
    expect(result.rows.some(row => row.environmentId === 'code:csv-sum')).toBe(false)
    expect((JSON.parse(status) as Status).phase).toBe('once')
  })
})
