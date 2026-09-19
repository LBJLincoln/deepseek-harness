import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ExperimentResult } from '@deepseek-ai/dsh-experiments'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { describe, expect, it } from 'vitest'

const scenarioDir = join(dirname(fileURLToPath(import.meta.url)), 'snapshots', 'experiment-presets')
const configPath = fileURLToPath(new URL('./fixtures/experiment/presets.cordis.yml', import.meta.url))
const binScript = fileURLToPath(new URL('./fixtures/experiment/presets-driver.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const expectedPath = join(scenarioDir, 'experiment.expected.json')
const refreshing = process.env.DSH_SNAPSHOT === 'refresh'

/** One cell session of the run, as the driver reports it. */
interface CellRecord {
  arm: string
  environment: string
  repetition: number
  preset?: string
  persona: string
}

interface DriverResult {
  type: string
  result: ExperimentResult
  cells: readonly CellRecord[]
}

describe('an experiment whose two arms differ only in their agent preset', () => {
  it('freezes the presets into the digest, stamps each cell with its own, and hands each model its own prompt', async () => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'experiment presets',
      tempDirPrefix: 'experiment-presets-snapshot-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath],
      tsconfigPath,
    })
    expect(stderr).toBe('')
    const driver = JSON.parse(stdout.trimEnd().split('\n').at(-1) ?? '') as DriverResult
    expect(driver.type).toBe('result')

    const actual = `${JSON.stringify({ result: driver.result, cells: driver.cells }, null, 2)}\n`
    if (refreshing) await writeFile(expectedPath, actual)
    expect(actual).toBe(await readFile(expectedPath, 'utf8'))
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
