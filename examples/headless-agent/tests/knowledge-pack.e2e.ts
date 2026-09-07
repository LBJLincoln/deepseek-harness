import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

const binScript = fileURLToPath(new URL('./fixtures/headless-driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/knowledge-pack/cordis.yml', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const packSkillsDir = fileURLToPath(new URL('../../../data/knowledge/2026-q3/skills/', import.meta.url))

/** The skill names the pack declares, read from each bundle's frontmatter. */
async function packSkillNames(): Promise<string[]> {
  const names: string[] = []
  for (const entry of await readdir(packSkillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const text = await readFile(join(packSkillsDir, entry.name, 'SKILL.md'), 'utf8')
    const name = /^name:\s*(\S+)\s*$/m.exec(text)?.[1]
    if (name === undefined) throw new Error(`${entry.name}/SKILL.md declares no name`)
    names.push(name)
  }
  return names.sort()
}

describe('headless-agent knowledge pack', () => {
  it('publishes the pack as the session catalog and loads one of its skills through the skill tool', async () => {
    const names = await packSkillNames()
    expect(names.length).toBeGreaterThan(0)
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'knowledge-pack',
      tempDirPrefix: 'knowledge-pack-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath, 'load the state of the art'],
      tsconfigPath,
    })
    const lines = stdout.trimEnd().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    const events = lines.slice(0, -1).map(line => line['event'] as SessionEvent)
    const result = lines.at(-1)
    expect(stderr).toBe('')
    const log = JSON.stringify(events)
    // The durable catalog names every pack skill and nothing from the host's own skill roots.
    expect(log).toContain('<available_skills>')
    for (const name of names) expect(log).toContain(`- \`${name}\`:`)
    expect(log).not.toContain('- `standard-sampling`:')
    const call = events.find(event => event.type === 'tool/call' && event.data.name === 'skill')
    expect(call).toBeDefined()
    expect(names.some(name => JSON.stringify(call).includes(name))).toBe(true)
    expect(log).toContain('<skill_content name=')
    expect(String(result?.['output'])).toMatch(/^KNOWLEDGE_PACK_LOADED [a-z0-9-]+: \S/)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
