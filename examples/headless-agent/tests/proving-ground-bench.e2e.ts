import { spawnSync } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const benchDir = fileURLToPath(new URL('./fixtures/proving-ground-bench/', import.meta.url))
const environmentsDir = join(benchDir, 'environments')
const binScript = join(benchDir, 'registry-driver.ts')
const configPath = join(benchDir, 'overlays', 'registry-only.cordis.yml')
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
/** Admission runs every task's tests twice; thirty tasks need minutes, not the smoke's seconds. */
const ADMISSION_TIMEOUT_MS = 600_000

interface TaskFile {
  readonly id: string
  readonly tier: number
  readonly domain: string
  readonly heldOut: boolean
}

/** Every task file of the bench, as the registrar reads them. */
async function taskFiles(): Promise<TaskFile[]> {
  const tasks: TaskFile[] = []
  for (const entry of await readdir(environmentsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    tasks.push(JSON.parse(await readFile(join(environmentsDir, entry.name, 'task.json'), 'utf8')) as TaskFile)
  }
  return tasks
}

describe('proving-ground bench', () => {
  it('registers every task file with its tier, domain, held-out flag, and reference', async () => {
    const tasks = await taskFiles()
    expect(tasks.length).toBeGreaterThanOrEqual(30)
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'proving-ground-bench',
      tempDirPrefix: 'proving-ground-bench-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath],
      tsconfigPath,
    })
    expect(stderr).toBe('')
    const summary = JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}') as {
      total: number
      heldOut: number
      tiers: Record<string, number>
      domains: Record<string, number>
      withReference: number
      ids: string[]
    }
    expect(summary.total).toBe(tasks.length)
    expect(summary.heldOut).toBe(tasks.filter(task => task.heldOut).length)
    expect(summary.withReference).toBe(tasks.length)
    expect(summary.ids).toEqual(tasks.map(task => task.id).sort())
    for (const tier of [2, 3, 4]) expect(summary.tiers[tier]).toBe(tasks.filter(task => task.tier === tier).length)
    expect(Object.keys(summary.domains).length).toBeGreaterThanOrEqual(3)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('admits every task: the pre-state fails its own tests and the hidden reference passes them', async () => {
    const admission = spawnSync('node', [join(benchDir, 'admit.mjs'), environmentsDir], { encoding: 'utf8', timeout: ADMISSION_TIMEOUT_MS })
    expect(admission.stderr).toBe('')
    expect(admission.status).toBe(0)
    const admitted = admission.stdout.trim().split('\n').filter(line => line.startsWith('admit '))
    expect(admitted.length).toBe((await taskFiles()).length)
  }, ADMISSION_TIMEOUT_MS)
})
