import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ComponentId, componentAddress } from '@deepseek-ai/dsh-components'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { compositionSha256, isComponentAddress } from '@deepseek-ai/dsh-components-manifest'
import type { CompositionManifest } from '@deepseek-ai/dsh-components-manifest'

const fixture = new URL('../../../../examples/headless-agent/tests/fixtures/composition-manifest/', import.meta.url)
const binScript = fileURLToPath(new URL('driver.ts', fixture))
const configPath = fileURLToPath(new URL('cordis.yml', fixture))
const presetsRoot = fileURLToPath(new URL('presets', fixture))
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

/** Every address of one manifest, in the order the payload records them. */
function addresses(manifest: CompositionManifest): string[] {
  return manifest.components.map(entry => componentAddress(entry.id, entry.digest))
}

describe('the composition manifest through a real cordis.yml and headless process', () => {
  it('records one manifest per composition change and none for an unchanged step', async () => {
    let events: SessionEvent[] = []
    const { stderr } = await runLoaderSmoke({
      label: 'composition-manifest',
      tempDirPrefix: 'composition-manifest-e2e-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath],
      tsconfigPath: repoTsconfig,
      env: { DSH_COMPOSITION_MANIFEST_PRESETS: presetsRoot },
      inspect: async (cwd) => {
        const logs = await jsonlFiles(join(cwd, '.sessions'))
        expect(logs).toHaveLength(1)
        const lines = (await readFile(logs[0] as string, 'utf8')).trimEnd().split('\n')
        events = lines.slice(1).map(line => JSON.parse(line) as SessionEvent)
      },
    })
    expect(stderr).toBe('')

    const manifests = events.filter(event => event.type === 'composition/manifest')
    // Three turns, one step each: the first records the composition, the second
    // changes nothing, and the third follows the tool the driver registered.
    expect(manifests).toHaveLength(2)
    const [first, second] = manifests.map(event => event.data)
    if (first === undefined || second === undefined) throw new Error('expected two composition manifests')

    // The first manifest precedes the session's first model request.
    const firstHeader = events.find(event => event.type === 'request/header')
    expect(manifests[0]?.seq).toBeLessThan(firstHeader?.seq ?? Number.POSITIVE_INFINITY)

    // Every entry is addressable and every hash is a recomputation from the log.
    for (const manifest of [first, second]) {
      expect(manifest.version).toBe(1)
      expect(addresses(manifest).every(isComponentAddress)).toBe(true)
      expect(manifest.compositionSha256).toBe(compositionSha256(addresses(manifest)))
      expect([...addresses(manifest)].sort()).toEqual(addresses(manifest))
    }
    expect(first.compositionSha256).not.toBe(second.compositionSha256)

    // The three composition-time adapters each put their kind in play: the
    // deployment's tool in the global layer, the preset's own prompt sections in
    // that session's layer, and the standing mount the session was composed from.
    const byId = new Map(first.components.map(entry => [entry.id, entry]))
    expect(byId.get(ComponentId('tool:todo_write'))).toMatchObject({
      kind: 'tool', layer: 'global', digestBasis: 'content', provenance: 'curated',
    })
    expect(byId.get(ComponentId('prompt-section:preset:manifest'))).toMatchObject({
      kind: 'prompt-section', layer: 'agent', digestBasis: 'content',
    })
    expect(byId.get(ComponentId('preset:manifest'))).toMatchObject({
      kind: 'preset', layer: 'global', digestBasis: 'content', provenance: 'curated',
    })
    // A section whose text is a provider is addressed by its registration alone.
    expect(byId.get(ComponentId('prompt-section:preset:manifest-assembled'))).toMatchObject({
      kind: 'prompt-section', layer: 'agent', digestBasis: 'registration',
    })
    // Ordered by address rather than by id, so the `@` separator decides
    // between two ids where one is a prefix of the other.
    expect([...byId.keys()]).toEqual([
      'preset:manifest',
      'prompt-section:deployment:persona',
      'prompt-section:harness:identity',
      'prompt-section:preset:manifest-assembled',
      'prompt-section:preset:manifest',
      'tool:todo_write',
    ])

    // The tool the driver registered is exactly what the second manifest adds.
    const added = second.components.filter(entry => !byId.has(entry.id))
    expect(added.map(entry => entry.id)).toEqual(['tool:late_note'])
    expect(second.components.filter(entry => byId.has(entry.id))).toHaveLength(first.components.length)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
