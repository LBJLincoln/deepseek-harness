import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import type { ReadBarrierDenial } from '@deepseek-ai/dsh-read-barrier'

const binScript = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/read-barrier/driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/read-barrier/cordis.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

interface ReadOutcome {
  isError: boolean
  code?: string
  text: string
}

interface DriverResult {
  type: string
  root: string
  check: string
  tools: string[]
  implementerCheck: ReadOutcome
  implementerWorkspace: ReadOutcome
  validatorCheck: ReadOutcome
  trustedRead: string
  denials: ReadBarrierDenial[]
  validatorDenials: number
}

describe('the read barrier through a real cordis.yml and headless process', () => {
  it('denies an implementer read of the validator root at the executor and records it', async () => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'read-barrier',
      tempDirPrefix: 'read-barrier-e2e-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath],
      tsconfigPath: repoTsconfig,
    })
    expect(stderr).toBe('')
    const result = JSON.parse(stdout.trimEnd().split('\n').at(-1) ?? '') as DriverResult
    expect(result.type).toBe('result')

    // The denial is proved through the executor, not the schema: the read tool
    // is registered and visible to the implementer.
    expect(result.tools).toContain('read')
    expect(result.implementerCheck).toEqual({
      isError: true,
      code: 'FS_READ_BARRIER_DENIED',
      text: `Error: read denied: "${result.check}" is validator-owned — it is not part of this task; continue without it`,
    })
    // The same session reads its own workspace normally.
    expect(result.implementerWorkspace.isError).toBe(false)
    expect(result.implementerWorkspace.text).toContain('implementer work')
    // The session holding no reservation reads the very same file.
    expect(result.validatorCheck.isError).toBe(false)
    expect(result.validatorCheck.text).toContain('test -f MARKER')
    // And a trusted plugin still reaches it directly through ctx.fs.
    expect(result.trustedRead).toBe('test -f MARKER\n')

    expect(result.denials).toEqual([{
      version: 1,
      role: 'implementer',
      capability: 'fs',
      displayPath: result.check,
      root: result.root,
    }])
    expect(result.validatorDenials).toBe(0)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
