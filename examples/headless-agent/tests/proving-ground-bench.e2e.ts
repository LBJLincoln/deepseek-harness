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
/** Admission runs every task's tests twice and every hidden case twice; forty tasks need minutes, not the smoke's seconds. */
const ADMISSION_TIMEOUT_MS = 900_000
/** The floor a tier-5 task's cased check must reach for its verdict to rest on inputs the implementer never saw. */
const MINIMUM_HIDDEN_CASES = 80

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
  it('registers every task file with its tier, domain, held-out flag, reference, and hidden cases', async () => {
    const tasks = await taskFiles()
    expect(tasks.length).toBeGreaterThanOrEqual(40)
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
      cases: Record<string, number[]>
      ids: string[]
    }
    expect(summary.total).toBe(tasks.length)
    expect(summary.heldOut).toBe(tasks.filter(task => task.heldOut).length)
    expect(summary.withReference).toBe(tasks.length)
    expect(summary.ids).toEqual(tasks.map(task => task.id).sort())
    for (const tier of [2, 3, 4, 5]) expect(summary.tiers[tier]).toBe(tasks.filter(task => task.tier === tier).length)
    expect(Object.keys(summary.domains).length).toBeGreaterThanOrEqual(3)
    // Tier 5 is the differential tier: its verdict comes from a cased check the
    // implementer never reads, so a registration without one is not tier 5.
    const tierFive = tasks.filter(task => task.tier === 5)
    expect(tierFive.length).toBeGreaterThanOrEqual(10)
    for (const task of tierFive) {
      const counts = summary.cases[task.id] ?? []
      expect(counts.length, `${task.id} registers no cased check`).toBe(1)
      expect(counts[0], `${task.id} carries too few hidden cases`).toBeGreaterThanOrEqual(MINIMUM_HIDDEN_CASES)
    }
    expect(Object.keys(summary.cases).sort()).toEqual(tierFive.map(task => task.id).sort())
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('admits every task: the pre-state fails, the reference passes, and the hidden cases discriminate', async () => {
    const admission = spawnSync('node', [join(benchDir, 'admit.mjs'), environmentsDir], { encoding: 'utf8', timeout: ADMISSION_TIMEOUT_MS })
    expect(admission.stderr).toBe('')
    expect(admission.status).toBe(0)
    const admitted = admission.stdout.trim().split('\n').filter(line => line.startsWith('admit '))
    const tasks = await taskFiles()
    expect(admitted.length).toBe(tasks.length)
    // Admission prints the case count only for a task whose check carries one,
    // so the tier-5 rows are exactly the rows that name cases.
    const cased = admitted.filter(line => / cases=\d+$/u.test(line))
    expect(cased.length).toBe(tasks.filter(task => task.tier === 5).length)
    for (const line of cased) expect(Number(/ cases=(\d+)$/u.exec(line)?.[1])).toBeGreaterThanOrEqual(MINIMUM_HIDDEN_CASES)
  }, ADMISSION_TIMEOUT_MS)
})
