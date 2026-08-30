import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { decodeGoalChange } from '@deepseek-ai/dsh-goal'
import {
  decodeCertificateChange,
  decodeDirectiveChange,
  decodeStandardChange,
} from '@deepseek-ai/dsh-verification'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const binScript = fileURLToPath(new URL('../../../../examples/headless-agent/tests/fixtures/headless-driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL(
  '../../../../examples/headless-agent/tests/fixtures/verification-domain/cordis.yml',
  import.meta.url,
))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

async function jsonlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const paths = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return jsonlFiles(path)
    return entry.isFile() && entry.name.endsWith('.jsonl') ? [path] : []
  }))
  return paths.flat()
}

describe('certificate-gated completion through a real cordis.yml and headless process', () => {
  it('refuses the uncertified completion, certifies a passing run, then admits it', async () => {
    let events: SessionEvent[] = []
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'verification-domain',
      tempDirPrefix: 'verification-domain-e2e-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath, 'prove the certificate-gated completion'],
      tsconfigPath: repoTsconfig,
      inspect: async (cwd) => {
        const logs = await jsonlFiles(join(cwd, '.sessions'))
        expect(logs).toHaveLength(1)
        const lines = (await readFile(logs[0] as string, 'utf8')).trimEnd().split('\n')
        events = lines.slice(1).map(line => JSON.parse(line) as SessionEvent)
      },
    })
    expect(stderr).toBe('')
    const result = JSON.parse(stdout.trimEnd().split('\n').at(-1) ?? '') as Record<string, unknown>
    expect(result).toMatchObject({ type: 'result' })
    expect(result['output']).toBeTypeOf('string')
    expect(result['output']).toContain('CLI tool round trip complete')

    const domainSequence = events
      .filter(event => event.type === 'goal/change' || event.type.startsWith('verification/'))
      .map(event => event.type)
    expect(domainSequence).toEqual([
      'goal/change',
      'verification/standard',
      'verification/directive',
      'verification/certificate',
      'goal/change',
    ])

    const changes = events.filter(event => event.type === 'goal/change')
    const operations = changes.map((event) => {
      const change = decodeGoalChange(event.data)
      if (change === undefined) throw new Error('expected durable goal change')
      return change.operation
    })
    expect(operations).toEqual(['create', 'complete'])

    const standardEvent = events.find(event => event.type === 'verification/standard')
    const standard = decodeStandardChange(standardEvent?.data)
    if (standard === undefined) throw new Error('expected durable standard change')
    expect(standard.operation).toBe('author')
    expect(standard.standard.checks.map(check => check.id)).toEqual(['round-trip-prints', 'final-answer-quotes'])

    const directiveEvent = events.find(event => event.type === 'verification/directive')
    const directive = decodeDirectiveChange(directiveEvent?.data)
    if (directive === undefined) throw new Error('expected durable directive')
    expect(directive.rootCause).toBe('uncertified completion refused')
    expect(directive.detail).toContain('no covering certificate')

    const certificateEvent = events.find(event => event.type === 'verification/certificate')
    const certificate = decodeCertificateChange(certificateEvent?.data)
    if (certificate === undefined) throw new Error('expected durable certificate')
    expect(certificate.certificate.isolation).toBe('process')
    expect(certificate.certificate.results.map(item => item.checkId)).toEqual(['round-trip-prints', 'final-answer-quotes'])

    const certificateSeq = certificateEvent?.seq ?? Number.NaN
    const completeSeq = changes.at(-1)?.seq ?? Number.NaN
    expect(certificateSeq).toBeLessThan(completeSeq)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
