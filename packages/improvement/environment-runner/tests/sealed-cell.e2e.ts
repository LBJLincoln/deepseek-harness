/**
 * What the runner's per-run denial is worth against a real sandbox backend, through
 * a real `cordis.yml` and a headless process: a cell laid out the way a fleet
 * lays one out — a `cell-*` workspace beside a sibling cell, a plan, and a run
 * log — reads and writes its own workspace and reaches nothing above it, and the
 * cased check the barrier makes the runner source from its reserved script still
 * feeds every case its argv, its stdin, and its staged files.
 *
 * The suite runs on the backend `dsh-sandbox-local` resolves here, probed in the
 * provider's own chain order, and skips with a named reason only when this host
 * has none.
 */

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { launcherPath, probe as probeLandlock } from '@deepseek-ai/node-addon-landlock-run'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import type { ReadBarrierDenial } from '@deepseek-ai/dsh-read-barrier'
import type { CheckResult, RunParity } from '@deepseek-ai/dsh-verification'

const fixture = new URL('../../../../examples/headless-agent/tests/fixtures/sealed-cell/', import.meta.url)
const binScript = fileURLToPath(new URL('./driver.ts', fixture))
const configPath = fileURLToPath(new URL('./cordis.yml', fixture))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

/** The markers the fixture's scripted cell prints; `sealed-cell-llm.ts` owns them. */
const PARENT_LISTING_MARKER = 'PARENT-LISTING-'
const PLAN_LEAKED_MARKER = 'PLAN-LEAKED'
const PLAN_DENIED_MARKER = 'PLAN-DENIED'
const SIBLING_LEAKED_MARKER = 'SIBLING-LEAKED'
const SIBLING_DENIED_MARKER = 'SIBLING-DENIED'
const OWN_READ_MARKER = 'OWN-READ-OK'
const OWN_WRITE_MARKER = 'OWN-WRITE-OK'
const CANDIDATE_WRITTEN_MARKER = 'CANDIDATE-WRITTEN'

interface DriverResult {
  type: string
  certified: boolean
  escapesDenied: number
  denials: ReadBarrierDenial[]
  validations: { parity: RunParity | undefined; results: CheckResult[] }[]
  toolOutputs: string[]
  leakedPlan: string
  leakedSibling: string
  marker: boolean
  siblingIntact: string
}

/**
 * The runner `dsh-sandbox-local` resolves on this host, probed in its own chain
 * order: a functional bwrap wrap, then the Landlock launcher's own `--probe`.
 * @returns the backend name, or undefined when neither can confine here.
 */
function linuxBackend(): 'bwrap' | 'landlock' | undefined {
  const bwrap = spawnSync(
    'bwrap',
    ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--die-with-parent', '--', 'true'],
    { timeout: 5_000, stdio: 'ignore' },
  )
  if (bwrap.status === 0) return 'bwrap'
  return probeLandlock(launcherPath(), { timeoutMs: 5_000 }) === 'unusable' ? undefined : 'landlock'
}

const backend = process.platform === 'linux' ? linuxBackend() : undefined
const reason = process.platform === 'linux'
  ? 'neither bubblewrap nor the Landlock launcher can confine a command on this host'
  : `the local sandbox chain this suite pins is the Linux one, and this host is ${process.platform}`

describe.skipIf(backend === undefined)(`a sealed cell under ${backend ?? 'no backend'} (skipped: ${reason})`, () => {
  it('reads and writes its own workspace, reaches nothing above it, and records what it was refused', async () => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'sealed-cell',
      tempDirPrefix: 'sealed-cell-e2e-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath],
      tsconfigPath: repoTsconfig,
    })
    expect(stderr).toBe('')
    const result = JSON.parse(stdout.trimEnd().split('\n').at(-1) ?? '') as DriverResult
    expect(result.type).toBe('result')
    const output = result.toolOutputs.join('\n')

    // The cell's own workspace is whole: it read the file the fixture staged
    // there and created the ones its checks measure.
    expect(output).toContain(OWN_READ_MARKER)
    expect(output).toContain(OWN_WRITE_MARKER)
    expect(output).toContain(CANDIDATE_WRITTEN_MARKER)
    expect(result.marker).toBe(true)
    expect(result.certified).toBe(true)

    // Under the barrier the cased check ran from the runner's reserved script,
    // and every case reached the candidate through all three input channels:
    // one validation, both checks passed, every case and all of the weight.
    expect(result.validations).toHaveLength(1)
    expect(result.validations[0]?.parity).toEqual({ weightPassed: 6, weightTotal: 6 })
    expect(result.validations[0]?.results.map(check => [check.checkId, check.status])).toEqual([
      ['marker-file', 'pass'],
      ['echo-channels', 'pass'],
    ])
    expect(result.validations[0]?.results[1]?.cases).toEqual({ passed: 3, total: 3, weightPassed: 6, weightTotal: 6, failed: [] })

    // Nothing above it is. The listing is read by name rather than by count:
    // bubblewrap mounts an empty run directory and binds the workspace back into
    // it, so the cell sees its own directory and nothing else, while a backend
    // that refuses the listing outright leaves the line empty.
    const listing = output.split('\n').find(line => line.startsWith(PARENT_LISTING_MARKER)) ?? ''
    expect(listing, 'the confined shell listed no parent at all').not.toBe('')
    for (const name of ['cell-sibling', 'plan.json', 'run.log']) expect(listing).not.toContain(name)
    expect(output).toContain(PLAN_DENIED_MARKER)
    expect(output).not.toContain(PLAN_LEAKED_MARKER)
    expect(output).toContain(SIBLING_DENIED_MARKER)
    expect(output).not.toContain(SIBLING_LEAKED_MARKER)
    expect(result.leakedPlan).toBe('')
    expect(result.leakedSibling).toBe('')
    // The sibling cell's own file is untouched, which is what the confinement
    // is for: one cell's workspace is not another cell's material.
    expect(result.siblingIntact).toBe('export const sibling = "solution"\n')

    // The `read` tool refuses in the operation that opens the path, so that one
    // is recorded rather than silently empty, and the report carries the count.
    expect(result.denials).toEqual([{
      version: 1,
      role: 'implementer',
      capability: 'fs',
      displayPath: expect.stringContaining('plan.json') as unknown as string,
      root: expect.any(String) as unknown as string,
    }])
    expect(result.escapesDenied).toBe(1)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
