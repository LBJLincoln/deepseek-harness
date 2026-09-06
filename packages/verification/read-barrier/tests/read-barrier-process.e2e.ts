/**
 * What an `isolation: process` claim is worth on THIS host, through a real
 * `cordis.yml` and a headless process.
 *
 * The claim is only provable where a sandbox backend can express a denied read
 * root, so the suite probes exactly what the backend probes — bubblewrap and the
 * Landlock launcher, in the provider's own chain order — and asserts the one
 * outcome that host can produce: the run certifies at `process` with the shell
 * read denied, the claim is refused naming the backend that confines without
 * denying reads, or the confined executor cannot run at all and the run fails
 * before it certifies. Every branch is asserted explicitly; none is skipped.
 */

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { launcherPath, probe as probeLandlock } from '@deepseek-ai/node-addon-landlock-run'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import type { ReadBarrierEnforcementEntry } from '@deepseek-ai/dsh-read-barrier'

const fixture = new URL('../../../../examples/headless-agent/tests/fixtures/read-barrier-process/', import.meta.url)
const binScript = fileURLToPath(new URL('./driver.ts', fixture))
const configPath = fileURLToPath(new URL('./cordis.yml', fixture))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

/** Markers the fixture's scripted implementer prints for each outcome of its read; `process-mock-llm.ts` owns them. */
const DENIED_MARKER = 'STANDARD-DENIED'
const LEAKED_MARKER = 'STANDARD-LEAKED'

interface DriverResult {
  type: string
  root: string
  certified: boolean
  isolation?: string
  refusal?: { code: string; message: string }
  enforcement: ReadBarrierEnforcementEntry[]
  toolOutputs: string[]
  leaked: string
  marker: boolean
}

/**
 * What this host's sandbox chain can do, probed the way `dsh-sandbox-local`
 * probes it: a functional bwrap wrap then the Landlock launcher's own `--probe`
 * on Linux, a functional `sandbox-exec` on darwin, and the ACL runner as win32's
 * sole unprobed candidate. The ACL rung confines file effects but cannot express
 * a denied READ root at all, which is its own outcome.
 */
type BackendVerdict = 'denies-reads' | 'confines-without-read-denial' | 'unusable'

/** Probe the chain in the provider's own order. */
function backendVerdict(): BackendVerdict {
  if (process.platform === 'win32') return 'confines-without-read-denial'
  if (process.platform === 'darwin') {
    const seatbelt = spawnSync('sandbox-exec', ['-p', '(version 1) (allow default)', '--', 'true'], { timeout: 5_000, stdio: 'ignore' })
    return seatbelt.status === 0 ? 'denies-reads' : 'unusable'
  }
  if (process.platform !== 'linux') return 'unusable'
  const bwrap = spawnSync(
    'bwrap',
    ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--die-with-parent', '--', 'true'],
    { timeout: 5_000, stdio: 'ignore' },
  )
  if (bwrap.status === 0) return 'denies-reads'
  return probeLandlock(launcherPath(), { timeoutMs: 5_000 }) === 'unusable' ? 'unusable' : 'denies-reads'
}

describe('an isolation: process claim over a confined implementer', () => {
  it('certifies at process with the shell read denied, or refuses the claim naming the backend', async () => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'read-barrier-process',
      tempDirPrefix: 'read-barrier-process-e2e-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath],
      tsconfigPath: repoTsconfig,
    })
    expect(stderr).toBe('')
    const result = JSON.parse(stdout.trimEnd().split('\n').at(-1) ?? '') as DriverResult
    expect(result.type).toBe('result')

    const verdict = backendVerdict()
    if (verdict === 'denies-reads') {
      // The confined shell reached neither the standard nor its directory, and
      // the same command created MARKER, so the checks passed and the run
      // certified at the level its executors actually enforced.
      expect(result.toolOutputs.join('\n')).toContain(DENIED_MARKER)
      expect(result.toolOutputs.join('\n')).not.toContain(LEAKED_MARKER)
      expect(result.leaked).toBe('')
      expect(result.marker).toBe(true)
      expect(result.refusal).toBeUndefined()
      expect(result.certified).toBe(true)
      expect(result.isolation).toBe('process')
      // Every composed path-opening capability denied at its own executor; a
      // single `unenforced` entry would have refused the claim instead.
      expect(result.enforcement).toEqual([
        { capability: 'fs', state: 'denied-at-executor' },
        { capability: 'shell', state: 'denied-at-executor' },
        { capability: 'subprocess', state: 'denied-at-executor' },
        { capability: 'terminal', state: 'not-composed' },
        { capability: 'subagent', state: 'not-composed' },
        { capability: 'workflow', state: 'not-composed' },
      ])
      return
    }

    // Either way the claim fails rather than the barrier, and nothing certified.
    expect(result.certified).toBe(false)
    expect(result.isolation).toBeUndefined()
    expect(result.leaked).toBe('')

    if (verdict === 'confines-without-read-denial') {
      // The backend confines file effects, so the checks ran; it cannot express
      // the denied root, so the census carries its reason and the refusal
      // repeats it, naming the backend that could not enforce.
      expect(result.refusal?.code).toBe('VERIFICATION_ISOLATION_UNPROVEN')
      expect(result.refusal?.message).toContain('run cannot claim "process" isolation')
      expect(result.refusal?.message).toContain('is composed without read-barrier enforcement')
      expect(result.refusal?.message).toContain('sandbox backend')
      const unenforced = result.enforcement.filter(entry => entry.state === 'unenforced')
      expect(unenforced.length).toBeGreaterThan(0)
      for (const entry of unenforced) expect(entry.reason).toContain('cannot deny reads under')
      return
    }

    // No usable backend at all: the confined executor cannot run ANY command
    // here, so the run fails at the first check rather than reaching the
    // certificate, and the census records why no capability enforced.
    expect(result.refusal?.code).toBe('SANDBOX_UNAVAILABLE')
    expect(result.refusal?.message).toContain('no sandbox backend is usable on this host')
    const unenforced = result.enforcement.filter(entry => entry.state === 'unenforced')
    expect(unenforced.map(entry => entry.capability)).toEqual(['shell', 'subprocess'])
    for (const entry of unenforced) expect(entry.reason).toContain('no sandbox backend is usable on this host')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
