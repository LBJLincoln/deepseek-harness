import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ComponentId } from '@deepseek-ai/dsh-components'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

const fixture = new URL('../../../../examples/headless-agent/tests/fixtures/composition-quarantine/', import.meta.url)
const binScript = fileURLToPath(new URL('driver.ts', fixture))
const configPath = fileURLToPath(new URL('cordis.yml', fixture))
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

describe('a session that mounts its own package through a real cordis.yml and headless process', () => {
  it('marks the synthesized package in the manifest beside the curated rows', async () => {
    let events: SessionEvent[] = []
    const { stderr } = await runLoaderSmoke({
      label: 'composition-quarantine',
      tempDirPrefix: 'composition-quarantine-e2e-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath],
      tsconfigPath: repoTsconfig,
      inspect: async (cwd) => {
        const logs = await jsonlFiles(join(cwd, '.sessions'))
        expect(logs).toHaveLength(1)
        const lines = (await readFile(logs[0] as string, 'utf8')).trimEnd().split('\n')
        events = lines.slice(1).map(line => JSON.parse(line) as SessionEvent)
      },
    })
    expect(stderr).toBe('')

    const manifests = events
      .filter(event => event.type === 'composition/manifest')
      .map(event => event.data)
    // The curated composition, then the same composition with the package the
    // agent wrote for itself mounted into it.
    expect(manifests).toHaveLength(2)
    const [curated, mounted] = manifests
    if (curated === undefined || mounted === undefined) throw new Error('expected two composition manifests')

    // Every row of the configuration is a curated plugin addressed by its
    // registration, and nothing in that composition is synthesized. The app's
    // boot wraps the config file in one include row, so a row's entry id is
    // nested under it.
    expect(curated.components.map(entry => entry.id)).toContain(ComponentId('plugin:include:tool-cordis'))
    expect(curated.components.every(entry => entry.kind === 'plugin')).toBe(true)
    expect(curated.components.every(entry => entry.provenance === 'curated')).toBe(true)
    expect(curated.components.every(entry => entry.digestBasis === 'registration')).toBe(true)
    expect(curated.components.every(entry => entry.layer === 'global')).toBe(true)

    // The mount adds exactly one entry, and it is the one a quarantine keys on.
    const added = mounted.components.filter(
      entry => !curated.components.some(before => before.id === entry.id),
    )
    expect(added).toHaveLength(1)
    expect(added[0]).toMatchObject({
      kind: 'dynamic-package',
      provenance: 'synthesized',
      digestBasis: 'content',
      // Synthesized code is named in the session that wrote it, never globally.
      layer: 'agent',
    })
    expect(added[0]?.id).toMatch(/^dynamic-package:quar/)
    expect(added[0]?.digest).toMatch(/^[0-9a-f]{64}$/)
    expect(mounted.compositionSha256).not.toBe(curated.compositionSha256)

    // The mount is recorded after the call that mounted it and before the step
    // whose model request the mounted package can reach.
    const mountedSeq = events.find(
      event => event.type === 'composition/manifest' && event.data.compositionSha256 === mounted.compositionSha256,
    )?.seq
    const runResult = events.find(
      event => event.type === 'tool/result' && event.data.step === 2,
    )?.seq
    const thirdStep = events.find(
      event => event.type === 'step/start' && event.data.step === 3,
    )?.seq
    expect(mountedSeq).toBeGreaterThan(runResult ?? Number.POSITIVE_INFINITY)
    expect(mountedSeq).toBeLessThan(thirdStep ?? 0)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
