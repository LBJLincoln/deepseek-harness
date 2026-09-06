import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { componentAddress } from '@deepseek-ai/dsh-components'
import { skillComponentId } from '@deepseek-ai/dsh-components-skills'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { skillDigest, type SkillDefinition } from '@deepseek-ai/dsh-skill'

const fixture = new URL('../../../../examples/headless-agent/tests/fixtures/composition-manifest-mutation/', import.meta.url)
const binScript = fileURLToPath(new URL('driver.ts', fixture))
const configPath = fileURLToPath(new URL('cordis.yml', fixture))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

const SKILL_ID = skillComponentId('manifest-demo')
const DESCRIPTION = 'The skill this composition addresses'
const FIRST_BODY = 'First body.'
const SECOND_BODY = 'Second body.'

/** The definition the filesystem provider loads for one body of the fixture skill. */
function fixtureSkill(content: string): SkillDefinition {
  return {
    name: 'manifest-demo',
    description: DESCRIPTION,
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'project-dsh',
    provider: 'filesystem',
    content,
  }
}

async function jsonlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const paths = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return jsonlFiles(path)
    return entry.isFile() && entry.name.endsWith('.jsonl') ? [path] : []
  }))
  return paths.flat()
}

describe('a skill edited in place through a real cordis.yml and headless process', () => {
  it('replaces the address of the edited generation and leaves every other entry alone', async () => {
    let events: SessionEvent[] = []
    const { stderr } = await runLoaderSmoke({
      label: 'composition-manifest-mutation',
      tempDirPrefix: 'composition-manifest-mutation-e2e-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath],
      tsconfigPath: repoTsconfig,
      prepare: async (cwd) => {
        // A project root the local skill provider discovers, holding the body
        // whose one edited byte moves the address.
        await mkdir(join(cwd, '.git'), { recursive: true })
        await mkdir(join(cwd, '.dsh/skills/manifest-demo'), { recursive: true })
        await writeFile(
          join(cwd, '.dsh/skills/manifest-demo/SKILL.md'),
          `---\nname: manifest-demo\ndescription: ${DESCRIPTION}\n---\n\n${FIRST_BODY}\n`,
        )
      },
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
    // The composition before any load, the composition after it, and the
    // composition the edit produced.
    expect(manifests).toHaveLength(3)
    const [beforeLoad, afterLoad, afterEdit] = manifests
    if (beforeLoad === undefined || afterLoad === undefined || afterEdit === undefined) {
      throw new Error('expected three composition manifests')
    }

    // A skill reachable through the catalog but never loaded is not in play.
    expect(beforeLoad.components.some(entry => entry.kind === 'skill')).toBe(false)

    // The load adds exactly one entry, addressed by the loaded body.
    const added = afterLoad.components.filter(
      entry => !beforeLoad.components.some(before => before.id === entry.id),
    )
    expect(added).toEqual([{
      id: SKILL_ID,
      digest: skillDigest(fixtureSkill(FIRST_BODY)),
      kind: 'skill',
      digestBasis: 'content',
      provenance: 'curated',
      layer: 'global',
    }])

    // The edit moves exactly that entry's digest; every other entry is byte-identical.
    expect(afterEdit.components).toHaveLength(afterLoad.components.length)
    const moved = afterEdit.components.filter(
      entry => !afterLoad.components.some(before => componentAddress(before.id, before.digest)
        === componentAddress(entry.id, entry.digest)),
    )
    expect(moved.map(entry => entry.id)).toEqual([SKILL_ID])
    expect(moved[0]?.digest).toBe(skillDigest(fixtureSkill(SECOND_BODY)))
    expect(afterEdit.compositionSha256).not.toBe(afterLoad.compositionSha256)

    // The generation the edit replaced is gone: no manifest after it names the
    // old address, so a comparison keyed on it cannot pool the two bodies.
    const oldAddress = componentAddress(SKILL_ID, skillDigest(fixtureSkill(FIRST_BODY)))
    expect(afterEdit.components.map(entry => componentAddress(entry.id, entry.digest)))
      .not.toContain(oldAddress)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
