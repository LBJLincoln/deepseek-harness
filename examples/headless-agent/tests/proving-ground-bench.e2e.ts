import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SHIPPED_REDACTION_RULES } from '@deepseek-ai/dsh-curator'
import type { CuratedExportReport, CuratedTrajectory, ExportManifest } from '@deepseek-ai/dsh-curator'
import type { DataUsePurpose, DataUseTerms } from '@deepseek-ai/dsh-data-use'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { benchExportPurpose } from './fixtures/proving-ground-bench/export-purpose.ts'

const benchDir = fileURLToPath(new URL('./fixtures/proving-ground-bench/', import.meta.url))
const environmentsDir = join(benchDir, 'environments')
const binScript = join(benchDir, 'registry-driver.ts')
const configPath = join(benchDir, 'overlays', 'registry-only.cordis.yml')
const mockRouteConfigPath = join(benchDir, 'overlays', 'mock-route.cordis.yml')
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
/** Admission runs every task's tests twice and every hidden case twice; forty-odd tasks need minutes, not the smoke's seconds. */
const ADMISSION_TIMEOUT_MS = 900_000
/** The floor a cased task's check must reach for its verdict to rest on inputs the implementer never saw. */
const MINIMUM_HIDDEN_CASES = 80
/** The tiers whose verdict comes from a cased check: the differential tier and the multi-file pilot above it. */
const CASED_TIERS = [5, 6]

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
    expect(tasks.length).toBeGreaterThanOrEqual(44)
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
    for (const tier of [2, 3, 4, 5, 6]) expect(summary.tiers[tier]).toBe(tasks.filter(task => task.tier === tier).length)
    expect(Object.keys(summary.domains).length).toBeGreaterThanOrEqual(3)
    // Tiers 5 and 6 are the differential tiers: a verdict comes from a cased
    // check the implementer never reads, so a registration without one is
    // neither, and a task of any other tier may not carry one.
    const cased = tasks.filter(task => CASED_TIERS.includes(task.tier))
    expect(tasks.filter(task => task.tier === 5).length).toBeGreaterThanOrEqual(10)
    expect(tasks.filter(task => task.tier === 6).length).toBeGreaterThanOrEqual(4)
    for (const task of cased) {
      const counts = summary.cases[task.id] ?? []
      expect(counts.length, `${task.id} registers no cased check`).toBe(1)
      expect(counts[0], `${task.id} carries too few hidden cases`).toBeGreaterThanOrEqual(MINIMUM_HIDDEN_CASES)
    }
    expect(Object.keys(summary.cases).sort()).toEqual(cased.map(task => task.id).sort())
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('admits every task: the pre-state fails, the reference passes, and the hidden cases discriminate', async () => {
    const admission = spawnSync('node', [join(benchDir, 'admit.mjs'), environmentsDir], { encoding: 'utf8', timeout: ADMISSION_TIMEOUT_MS })
    expect(admission.stderr).toBe('')
    expect(admission.status).toBe(0)
    const admitted = admission.stdout.trim().split('\n').filter(line => line.startsWith('admit '))
    const tasks = await taskFiles()
    expect(admitted.length).toBe(tasks.length)
    // Admission prints the case count only for a task whose check carries one,
    // so the rows that name cases are exactly the tier-5 and tier-6 rows.
    const cased = admitted.filter(line => / cases=\d+$/u.test(line))
    expect(cased.length).toBe(tasks.filter(task => CASED_TIERS.includes(task.tier)).length)
    for (const line of cased) expect(Number(/ cases=(\d+)$/u.exec(line)?.[1])).toBeGreaterThanOrEqual(MINIMUM_HIDDEN_CASES)
  }, ADMISSION_TIMEOUT_MS)
})

/** What one driver run left in its run directory. */
interface DriverRun {
  readonly exported: CuratedExportReport
  readonly lines: readonly CuratedTrajectory[]
  readonly manifest: ExportManifest
  readonly linesSha256: string
}

/**
 * Run one bench driver over the scripted-route overlay with a plan written into its run directory.
 * @param driver - which driver to launch.
 * @param plan - the plan file's content.
 * @returns the export the driver reported and the files it wrote.
 */
async function runDriver(driver: 'fleet' | 'experiment', plan: object): Promise<DriverRun> {
  let written: Omit<DriverRun, 'exported'> | undefined
  const driverScript = join(benchDir, `${driver}-driver.ts`)
  const { stdout, stderr } = await runLoaderSmoke({
    label: `proving-ground-bench-${driver}`,
    tempDirPrefix: `proving-ground-bench-${driver}-`,
    binScript: driverScript,
    libBinScript: driverScript,
    configPath: mockRouteConfigPath,
    binArgs: [mockRouteConfigPath, 'plan.json'],
    tsconfigPath,
    prepare: cwd => writeFile(join(cwd, 'plan.json'), JSON.stringify(plan)),
    inspect: async (cwd) => {
      const content = await readFile(join(cwd, 'trajectories.jsonl'), 'utf8')
      written = {
        lines: content.split('\n').filter(line => line !== '').map(line => JSON.parse(line) as CuratedTrajectory),
        manifest: JSON.parse(await readFile(join(cwd, 'export-manifest.json'), 'utf8')) as ExportManifest,
        linesSha256: createHash('sha256').update(content).digest('hex'),
      }
    },
  })
  expect(stderr).toBe('')
  const status = JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}') as { type: string; exported: CuratedExportReport }
  expect(status.type).toBe('result')
  expect(written).toBeDefined()
  return { exported: status.exported, ...written as Omit<DriverRun, 'exported'> }
}

/** The route every scripted cell runs on. */
const MOCK_MODEL = { provider: 'cli-mock', model: 'cli-mock' }

/** Every rule of the shipped profile, which is what the bench composition's default profile runs. */
const SHIPPED_RULE_IDS = SHIPPED_REDACTION_RULES.map(rule => rule.id)

/**
 * The export every driver run must leave: the curator's lines under the bench's
 * evaluation-only terms, the manifest beside them addressing exactly those
 * bytes, and every line curated and stating how its session stopped.
 */
function expectCuratedExport(run: DriverRun, records: number): void {
  expect(run.exported).toMatchObject({ exported: records, withheldByTerms: 0, heldOut: 0, skipped: [] })
  expect(run.manifest).toEqual(run.exported.manifest)
  expect(run.manifest).toMatchObject({
    version: 'dsh-export-manifest/2',
    purpose: 'evaluation',
    profile: 'village-v1',
    records,
    trajectoryFormat: 'dsh-trajectory/3',
  })
  expect(Object.keys(run.manifest.ruleHits)).toEqual(SHIPPED_RULE_IDS)
  expect(Object.keys(run.manifest.ruleRecords)).toEqual(SHIPPED_RULE_IDS)
  expect(run.manifest.recordsSha256).toBe(run.linesSha256)
  expect(run.lines).toHaveLength(records)
  for (const line of run.lines) {
    expect(line.format).toBe('dsh-trajectory/3')
    expect(line.curation).toMatchObject({
      redactionApplied: true,
      redaction: { profile: 'village-v1', profileSha256: run.manifest.profileSha256 },
      residency: 'eu-west',
    })
    // The scripted route never implements the task, and each of its turns ends on its own.
    expect(line.stopReason).toBe('completed')
    expect(line.reward).toMatchObject({ outcome: 0, basis: 'certificate' })
  }
}

describe('the purpose a bench run exports for', () => {
  /** The bench composition's terms with the purposes under test. */
  const terms = (purposes: DataUsePurpose[]): DataUseTerms => ({
    clientId: 'daliesk-lab',
    agreementId: 'proving-ground-bench',
    purposes,
    residency: 'eu-west',
    retentionDays: 90,
    redactionProfile: 'village-v1',
  })

  it('exports for training where the terms admit it, and for evaluation otherwise', () => {
    expect(benchExportPurpose(terms(['training', 'evaluation']))).toBe('training')
    expect(benchExportPurpose(terms(['evaluation', 'training']))).toBe('training')
    expect(benchExportPurpose(terms(['delivery', 'evaluation']))).toBe('evaluation')
  })

  it('refuses terms that admit neither, which a curated export would withhold every cell under', () => {
    expect(() => benchExportPurpose(terms(['delivery'])))
      .toThrow('the composition pins agreement proving-ground-bench admitting delivery; a bench run exports for training or evaluation')
  })
})

describe('the bench drivers on a scripted route', () => {
  it('exports a fleet\'s cells through the curator and writes the export manifest beside them', async () => {
    const run = await runDriver('fleet', {
      name: 'mock-route-fleet',
      environments: ['code:interval-ops'],
      models: [MOCK_MODEL],
      repetitions: 1,
      seed: 1,
      district: 'bench-mock',
    })
    expectCuratedExport(run, 1)
    expect(run.lines[0]?.reward.attempts).toBe(3)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('exports both arms of an experiment through the curator and writes the export manifest beside them', async () => {
    const run = await runDriver('experiment', {
      name: 'mock-route-pair',
      environments: ['code:interval-ops'],
      repetitions: 1,
      baseline: MOCK_MODEL,
      candidate: { ...MOCK_MODEL, ladder: [{}] },
      seed: 1,
    })
    expectCuratedExport(run, 2)
    expect(run.lines.map(line => line.reward.attempts).sort()).toEqual([1, 3])
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})

describe('proving-ground bench completion family', () => {
  it('registers a completion child beside the curated 44, under the same bench kind', async () => {
    const completionConfigPath = join(benchDir, 'overlays', 'registry-only-with-completion.cordis.yml')
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'proving-ground-bench-completion',
      tempDirPrefix: 'proving-ground-bench-completion-',
      binScript,
      libBinScript: binScript,
      configPath: completionConfigPath,
      binArgs: [completionConfigPath],
      tsconfigPath,
    })
    expect(stderr).toBe('')
    const summary = JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}') as { total: number; tiers: Record<string, number>; ids: string[] }
    const tasks = await taskFiles()
    // uri-resolve's normalizePercent is long enough to survive the factory's
    // min-lines filter and is exercised by uri-resolve's own visible suite, so
    // its completion child is expected to admit and register.
    const completionId = 'code:uri-resolve--complete-normalizePercent'
    expect(summary.ids).toContain(completionId)
    expect(summary.total).toBeGreaterThan(tasks.length)
    expect(summary.tiers['5']).toBeGreaterThan(tasks.filter(task => task.tier === 5).length)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})

describe('proving-ground bench repository family', () => {
  it('registers a repository child beside the curated tasks, in domain repository, judged on its hidden cases', async () => {
    const repositoryConfigPath = join(benchDir, 'overlays', 'registry-only-with-repository.cordis.yml')
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'proving-ground-bench-repository',
      tempDirPrefix: 'proving-ground-bench-repository-',
      binScript,
      libBinScript: binScript,
      configPath: repositoryConfigPath,
      binArgs: [repositoryConfigPath],
      tsconfigPath,
    })
    expect(stderr).toBe('')
    const summary = JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}') as {
      total: number
      domains: Record<string, number>
      cases: Record<string, number[]>
      ids: string[]
    }
    const tasks = await taskFiles()
    // output-retention's describeOmitted is documented, exported, and reached
    // by seven blocks of the package's own spec, so its child is expected to
    // admit and register with those blocks as its cases.
    const repositoryId = 'code:output-retention--implement-describeOmitted'
    const repositoryCells = summary.domains.repository ?? 0
    expect(summary.ids).toContain(repositoryId)
    expect(summary.total).toBe(tasks.length + repositoryCells)
    expect(repositoryCells).toBeGreaterThanOrEqual(2)
    expect(summary.cases[repositoryId]).toEqual([7])
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
