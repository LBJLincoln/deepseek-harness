import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { DEFAULT_JUDGE_SYSTEM_PROMPT, evidenceText } from '@deepseek-ai/dsh-judge'
import { CheckId } from '@deepseek-ai/dsh-verification'

const fixture = new URL('../../../../examples/headless-agent/tests/fixtures/blind-judge/', import.meta.url)
const binScript = fileURLToPath(new URL('driver.ts', fixture))
const configPath = fileURLToPath(new URL('cordis.yml', fixture))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

interface DriverResult {
  type: string
  sessionId: string
  auditedSessionId: string
  attempt: number
  verdict: string
  rationale: string
  treeHash: string
  implementerCertified: boolean
  implementerResults: { checkId: string; status: string }[]
  judgeHeader: { hasParent: boolean; seedLength: number; agentPreset: string | null }
  judgeTools: string[]
  judgeHistory: { role: string; text: string }[]
  durableEvents: { type: string; data: Record<string, unknown> }[]
  sessionCount: number
  auditedSessionInHistory: boolean
}

const TASK = 'The workspace must hold both SPEC.txt and a file named MARKER. Report when it does.'

describe('the blind judge through a real cordis.yml', () => {
  it('audits one attempt from a lineage-free session holding exactly three messages', async () => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'blind-judge',
      tempDirPrefix: 'blind-judge-e2e-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath],
      tsconfigPath: repoTsconfig,
    })
    expect(stderr).toBe('')
    const result = JSON.parse(stdout.trimEnd().split('\n').at(-1) ?? '') as DriverResult
    expect(result.type).toBe('result')

    // The attempt under audit: one check passed, one failed, nothing certified.
    expect(result.implementerCertified).toBe(false)
    expect(result.implementerResults).toEqual([
      { checkId: 'spec-present', status: 'pass' },
      { checkId: 'marker-present', status: 'fail' },
    ])

    // The judge session begins at its own creation: a fresh id, no fork parent,
    // and no inherited seed.
    expect(result.sessionId.startsWith('judge-')).toBe(true)
    expect(result.sessionId).not.toBe(result.auditedSessionId)
    expect(result.judgeHeader).toEqual({ hasParent: false, seedLength: 0, agentPreset: null })
    expect(result.sessionCount).toBe(2)

    // Its history is the standing instruction, the task, and the evidence — and
    // nothing from the audited session, whose id no message names.
    expect(result.judgeHistory.map(message => message.role)).toEqual(['user', 'user', 'user', 'assistant'])
    expect(result.judgeHistory.slice(0, 3).map(message => message.text)).toEqual([
      DEFAULT_JUDGE_SYSTEM_PROMPT,
      TASK,
      evidenceText({
        attempt: 1,
        results: [
          { checkId: CheckId('spec-present'), status: 'pass', evidence: '' },
          { checkId: CheckId('marker-present'), status: 'fail', evidence: '' },
        ],
      }),
    ])
    expect(result.auditedSessionInHistory).toBe(false)

    // The shipped `judge` preset composes no tool, and this composition
    // registers none globally, so the judge reaches the model with none.
    expect(result.judgeTools).toEqual([])

    // Both records are durable, and the verdict is the one the judge answered.
    expect(result.verdict).toBe('upheld')
    expect(result.durableEvents).toEqual([
      {
        type: 'judge/session',
        data: {
          judgeSessionId: result.sessionId,
          auditedSessionId: result.auditedSessionId,
          attempt: 1,
          treeHash: result.treeHash,
        },
      },
      {
        type: 'judge/verdict',
        data: {
          auditedSessionId: result.auditedSessionId,
          attempt: 1,
          verdict: 'upheld',
          rationale: result.rationale,
        },
      },
    ])
    expect(result.rationale)
      .toBe('One of the two checks failed and no certificate was issued, which is the outcome the attempt recorded.')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
