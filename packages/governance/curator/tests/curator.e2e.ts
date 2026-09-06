/**
 * Keyless REAL-composition coverage for the curator: one boot of one
 * `cordis.yml` composing the environment registration, the runner, the budget
 * policy, persistence, the checkpoint policy, the trajectory exporter,
 * data-use terms admitting delivery and evaluation, and the curator with the
 * shipped rules. The scripted answer carries a fake address and a fake key; the
 * `training` export writes nothing and the `evaluation` export writes the
 * redacted record its terms admit.
 */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import type { CuratedExportReport, CuratedTrajectory, ExportManifest } from '@deepseek-ai/dsh-curator'

const binScript = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/curator/driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/curator/cordis.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

/** The fake credentials the fixture's scripted answer carries. */
const FAKE_ADDRESS = 'nobody@example.invalid'
const FAKE_KEY = 'sk-test-0000'

interface DriverResult {
  type: string
  training: CuratedExportReport
  evaluation: CuratedExportReport
}

/** What the export left in the process working directory. */
interface Written {
  evaluationLines: string[]
  evaluationDigest: string
  trainingLines: string[]
  manifest: ExportManifest
}

describe('the curator through a real cordis.yml and headless process', () => {
  it('withholds every session from a training export and writes the redacted evaluation record', async () => {
    let written: Written | undefined
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'curator',
      tempDirPrefix: 'curator-e2e-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath],
      tsconfigPath: repoTsconfig,
      inspect: async (cwd) => {
        const evaluation = await readFile(join(cwd, 'evaluation.jsonl'), 'utf8')
        written = {
          evaluationLines: evaluation.split('\n').filter(line => line !== ''),
          evaluationDigest: createHash('sha256').update(evaluation).digest('hex'),
          trainingLines: (await readFile(join(cwd, 'training.jsonl'), 'utf8')).split('\n').filter(line => line !== ''),
          manifest: JSON.parse(await readFile(join(cwd, 'evaluation-manifest.json'), 'utf8')) as ExportManifest,
        }
      },
    })
    expect(stderr).toBe('')
    const observed = JSON.parse(stdout.trimEnd().split('\n').at(-1) ?? '') as DriverResult
    expect(observed.type).toBe('result')

    // Terms admitting delivery and evaluation withhold both sessions from a
    // training export, and the file it opened stays empty.
    expect(observed.training).toMatchObject({ sessions: 2, exported: 0, withheldByTerms: 2, skipped: [] })
    expect(observed.training.manifest.withheld).toEqual({ heldOut: 0, districts: 0, terms: 2 })
    expect(written?.trainingLines).toEqual([])

    // The same store exports for evaluation: the held-out environment is still
    // withheld by its stamp, and the ordinary session is written once.
    expect(observed.evaluation).toMatchObject({
      sessions: 2,
      exported: 1,
      rewarded: 1,
      heldOut: 1,
      withheldByDistrict: 0,
      withheldByTerms: 0,
      skipped: [],
    })
    expect(observed.evaluation.manifest).toMatchObject({
      version: 'dsh-export-manifest/1',
      purpose: 'evaluation',
      profile: 'village-v1',
      records: 1,
      withheld: { heldOut: 1, districts: 0, terms: 0 },
      trajectoryFormat: 'dsh-trajectory/1',
      ruleHits: {
        'shipped:email': 1,
        'shipped:bearer-token': 0,
        'shipped:api-key': 1,
        'shipped:ipv4': 0,
        'shipped:e164-phone': 0,
      },
    })

    // The manifest addresses exactly the bytes the sink received.
    expect(written?.manifest).toEqual(observed.evaluation.manifest)
    expect(written?.manifest.recordsSha256).toBe(written?.evaluationDigest)

    expect(written?.evaluationLines).toHaveLength(1)
    const line = written?.evaluationLines[0] as string
    expect(line).not.toContain(FAKE_ADDRESS)
    expect(line).not.toContain(FAKE_KEY)
    const record = JSON.parse(line) as CuratedTrajectory
    expect(record.curation).toEqual({
      redactionApplied: true,
      redaction: {
        profile: 'village-v1',
        profileSha256: observed.evaluation.manifest.profileSha256,
        hits: { 'shipped:email': 1, 'shipped:api-key': 1 },
      },
      residency: 'eu-west',
    })
    expect(record.environment).toMatchObject({ environmentId: 'smoke:round-trip', heldOut: false })
    expect(record.reward.outcome).toBe(1)
    const answers = record.messages
      .filter(message => message.role === 'assistant')
      .flatMap(message => message.content)
      .filter(block => block.type === 'text')
    expect(answers.map(block => block.text))
      .toEqual(['Round trip done. Ask [redacted:email], key [redacted:api-key], before publishing.'])
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
