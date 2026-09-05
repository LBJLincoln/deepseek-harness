import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import type { ReadBarrierScope } from '@deepseek-ai/dsh-read-barrier'

const fixture = new URL('../../../../examples/headless-agent/tests/fixtures/read-barrier-guard/', import.meta.url)
const binScript = fileURLToPath(new URL('driver.ts', fixture))
const configPath = fileURLToPath(new URL('cordis.yml', fixture))
const presetsRoot = fileURLToPath(new URL('presets', fixture))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

interface Claim {
  certified: boolean
  code?: string
  message?: string
  isolation?: string
  executor?: string
}

interface DriverResult {
  type: string
  mountRefusal?: string
  refusedSessionExists: boolean
  guarded: { isError: boolean; text: string }
  openTools: string[]
  implementerTools: string[]
  scope?: ReadBarrierScope
  hostClaim: Claim
  reportedClaim: Claim
  processClaim: Claim
}

describe('tool authority and the enforcement-backed certificate through a real cordis.yml', () => {
  it('refuses the composition, denies the late tool, and certifies only what the census proves', async () => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'read-barrier-guard',
      tempDirPrefix: 'read-barrier-guard-e2e-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath],
      tsconfigPath: repoTsconfig,
      env: { DSH_READ_BARRIER_GUARD_PRESETS: presetsRoot },
    })
    expect(stderr).toBe('')
    const result = JSON.parse(stdout.trimEnd().split('\n').at(-1) ?? '') as DriverResult
    expect(result.type).toBe('result')

    // The mount audit refuses an implementer composition that holds a
    // log-reading tool, naming the tool and the authority to remove.
    expect(result.mountRefusal).toBe(
      'agent-presets: preset "log-reading" declares role "implementer" but composes "session_search", which carries the "session-log" authority',
    )
    expect(result.refusedSessionExists).toBe(false)
    // The same tools compose freely for a preset that claims no role.
    expect(result.openTools).toContain('session_search')
    expect(result.implementerTools).not.toContain('session_search')

    // The guard covers what no composition audit saw: a tool registered into
    // the agent's own layer afterwards. It is visible and still not callable.
    expect(result.implementerTools).toContain('late_session_read')
    expect(result.guarded).toEqual({
      isError: true,
      text: 'Error: "late_session_read" carries the "session-log" authority and is not callable in an implementer session',
    })

    // The census is the durable answer to what the session composed.
    expect(result.scope).toMatchObject({
      version: 1,
      role: 'implementer',
      presetId: 'implementing',
      enforcement: [
        { capability: 'fs', state: 'denied-at-executor' },
        { capability: 'shell', state: 'not-composed' },
        { capability: 'subprocess', state: 'not-composed' },
        { capability: 'terminal', state: 'not-composed' },
        { capability: 'subagent', state: 'not-composed' },
        { capability: 'workflow', state: 'not-composed' },
      ],
    })
    // Every tool the session started with, and no authority among them.
    expect(result.scope?.census.map(entry => entry.name)).toContain('read')
    expect(result.scope?.census.every(entry => entry.authority.length === 0)).toBe(true)
    // The census is a snapshot: the tool registered after it is exactly what
    // the runtime guard, not the census, has to cover.
    expect(result.scope?.census.map(entry => entry.name)).not.toContain('late_session_read')

    // `host` needs evidence from outside this process, which no in-process
    // component can produce for itself.
    expect(result.hostClaim).toEqual({
      certified: false,
      code: 'VERIFICATION_ISOLATION_UNPROVEN',
      message: 'run cannot claim "host" isolation: no verified read-barrier/attestation places the standard outside this account',
    })
    // An agent-reported run is the session's own account of its checks.
    expect(result.reportedClaim).toEqual({
      certified: false,
      code: 'VERIFICATION_ISOLATION_UNPROVEN',
      message: 'run cannot claim "process" isolation: the run was agent-reported, so no validator executed its checks',
    })
    // What the census does prove certifies, and carries the executor forward.
    expect(result.processClaim).toEqual({ certified: true, isolation: 'process', executor: 'runner' })
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
