import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import type { ObservatoryPage } from '@deepseek-ai/dsh-observatory'
import { describe, expect, it } from 'vitest'

const scenarioDir = join(dirname(fileURLToPath(import.meta.url)), 'snapshots', 'observatory')
const configPath = fileURLToPath(new URL('./fixtures/observatory/cordis.yml', import.meta.url))
const binScript = fileURLToPath(new URL('./fixtures/observatory/driver.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const refreshing = process.env.DSH_SNAPSHOT === 'refresh'

/** The one instant every wall-clock time in a published page is replaced by. */
const ZERO_INSTANT = '1970-01-01T00:00:00.000Z'
const INSTANT_PATTERN = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g

/** The document fields that carry a wall-clock time, zeroed like the durable timestamps of a session stream. */
const DOCUMENT_TIMESTAMPS: readonly string[] = ['foldedAt', 'newestSessionAt']

interface DriverResult {
  type: string
  current: ObservatoryPage
  stale: ObservatoryPage
}

/** Replace every rendered instant of one page with {@link ZERO_INSTANT}. */
function normalizeHtml(html: string): string {
  return html.replace(INSTANT_PATTERN, ZERO_INSTANT)
}

/** Zero the document's wall-clock fields and print it as one stable JSON text. */
function normalizeJson(json: ObservatoryPage['json']): string {
  const zeroed = Object.fromEntries(Object.entries(json).map(([key, value]) => [
    key,
    DOCUMENT_TIMESTAMPS.includes(key) ? 0 : value,
  ]))
  return `${JSON.stringify(zeroed, null, 2)}\n`
}

/** Compare one normalized rendering against its expected output, recording it under refresh. */
async function expectRendering(name: string, actual: string): Promise<void> {
  const expected = join(scenarioDir, name)
  if (refreshing) await writeFile(expected, actual)
  expect(actual).toBe(await readFile(expected, 'utf8'))
}

describe('observatory page snapshots', () => {
  it('publishes the observatory scoreboard page and its stale rendering from the persisted logs', async () => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'observatory page snapshot',
      tempDirPrefix: 'observatory-snapshot-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath],
      tsconfigPath,
    })
    expect(stderr).toBe('')
    const result = JSON.parse(stdout.trimEnd().split('\n').at(-1) ?? '') as DriverResult
    expect(result.type).toBe('result')

    await expectRendering('current.expected.html', normalizeHtml(result.current.html))
    await expectRendering('current.expected.json', normalizeJson(result.current.json))
    await expectRendering('stale.expected.html', normalizeHtml(result.stale.html))
    await expectRendering('stale.expected.json', normalizeJson(result.stale.json))
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
