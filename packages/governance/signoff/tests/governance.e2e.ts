/**
 * Keyless REAL-composition coverage for the governance group: one boot of one
 * `cordis.yml` composing the signoff service, the data-use service, the
 * approval seam under its strict policy, a mock route, persistence, and the
 * checkpoint policy. One turn of the mock model calls `bash`, the fixture's
 * gate puts that call to the approval seam, and the driver then signs a
 * transition and tries to widen the session's data-use purposes.
 */

import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import type { DataUseTerms } from '@deepseek-ai/dsh-data-use'
import type { SignoffRecord } from '@deepseek-ai/dsh-signoff'
import { approvalArgumentsDigest } from '@deepseek-ai/dsh-user-approval'

const binScript = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/governance/driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/governance/cordis.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

/** The terms the fixture's `cordis.yml` configures for the district. */
const TERMS: DataUseTerms = {
  clientId: 'acme-industrial',
  agreementId: 'msa-2026-11',
  purposes: ['delivery', 'evaluation'],
  residency: 'eu-west',
  retentionDays: 90,
  redactionProfile: 'client-v3',
}

/** The arguments the mock route's one `bash` call carries. */
const COMMAND_ARGUMENTS = {
  command: 'printf CLI_TOOL_ROUND_TRIP',
  description: 'Prove the CLI tool round trip.',
}

interface LoggedEvent {
  type: string
  data: Record<string, unknown>
}

interface DriverResult {
  type: string
  sessionId: string
  output: string
  recorded: SignoffRecord
  folded: SignoffRecord
  widening: string
  narrowed: DataUseTerms
  events: LoggedEvent[]
}

/** Every event of one type the session log carries, in log order. */
function of(observed: DriverResult, type: string): LoggedEvent[] {
  return observed.events.filter(event => event.type === type)
}

describe('the governance plugins through a real cordis.yml and headless process', () => {
  it('pins terms at creation, attributes the decision, signs a transition, and refuses a widening pin', async () => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'governance',
      tempDirPrefix: 'governance-e2e-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath, 'run one client task'],
      tsconfigPath: repoTsconfig,
    })
    expect(stderr).toBe('')
    const observed = JSON.parse(stdout.trimEnd().split('\n').at(-1) ?? '') as DriverResult
    expect(observed.type).toBe('result')

    // The session states its terms before it does anything at all: the pin is
    // the first event of the log, ahead of the first turn.
    const [pinned, ...repinned] = of(observed, 'dataUse/terms')
    expect(observed.events[0]).toEqual({ type: 'dataUse/terms', data: TERMS })
    expect(pinned?.data).toEqual(TERMS)

    // The command reached the approval seam, and both halves of the audit pair
    // state the same arguments the call carried.
    const [asked] = of(observed, 'approval/asked')
    const [decided] = of(observed, 'approval/decided')
    const digest = approvalArgumentsDigest(COMMAND_ARGUMENTS)
    expect(asked?.data).toMatchObject({ toolName: 'bash', argumentsSha256: digest })
    expect(decided?.data).toMatchObject({
      id: asked?.data['id'],
      outcome: 'rejected',
      decidedBy: { kind: 'policy', id: 'approval-policy:never' },
      argumentsSha256: digest,
    })

    // The signature is durable and folds back out of the same log.
    const signed: SignoffRecord = {
      transition: 'review-acceptance',
      principal: { kind: 'human', id: 'lab-reviewer', displayName: 'Lab Reviewer' },
      artefactSha256: 'c'.repeat(64),
      evidence: [{ kind: 'session', ref: observed.sessionId }],
    }
    expect(observed.recorded).toEqual(signed)
    expect(observed.folded).toEqual(signed)
    expect(of(observed, 'signoff/recorded').map(event => event.data)).toEqual([signed])

    // Widening the agreement's purposes is refused and appends nothing;
    // narrowing them is recorded.
    expect(observed.widening).toContain('which the pin widens with training')
    expect(observed.narrowed.purposes).toEqual(['delivery'])
    expect(repinned.map(event => (event.data as unknown as DataUseTerms).purposes)).toEqual([['delivery']])
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
