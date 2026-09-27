/**
 * Keyless REAL-composition coverage for a program that builds a tool for this
 * repository: one boot of `fixtures/program-readme-rows/cordis.yml` over a
 * temporary git repository seeded with the task statement, three recorded runs
 * and their committed README rows. One department delivers
 * `data/proving-ground/tools/readme-rows.mjs` and its test on its own branch;
 * the integration merges the branch and certifies the merged head against the
 * committed rows.
 *
 * The scripted implementer writes the files committed under the fixture's
 * `scripted/`, so what this proves is the wiring — the spec freezes, the
 * department is staffed and certified over a committed tree, the branch
 * merges, and the committed rows decide the release — not what a model can
 * build. The overlay under the fixture's `overlays/` is the same program driven
 * on the operator's Claude Code route, and
 * `data/proving-ground/2026-09-27-readme-rows-program/` is what that run left.
 */

import { execFileSync } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { INTEGRATION_KEY } from '@deepseek-ai/dsh-program'
import type { ProgramEnd, ProgramGoalRecord, ProgramIntegrationRecord, ProgramStart } from '@deepseek-ai/dsh-program'

const fixtureDir = fileURLToPath(new URL('./fixtures/program-readme-rows/', import.meta.url))
const seedDir = join(fixtureDir, 'seed')
const binScript = join(fixtureDir, 'driver.ts')
const configPath = join(fixtureDir, 'cordis.yml')
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** One department, an integration and the golden diffs over three records outrun the default window. */
const PHASE_TIMEOUT_MS = 300_000

/** What the department delivers, beside the seed. */
const TOOL = 'data/proving-ground/tools/readme-rows.mjs'
const TEST = 'data/proving-ground/tools/readme-rows.test.mjs'

/** The two trailer lines the objective requires on every commit. */
const TRAILERS = [
  'Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>',
  'Claude-Session: https://claude.ai/code/session_01HEXjzxR7CyMizem5kFAB4C',
]

/** The five committed row sets the spec's goldens name, as the driver spells them. */
const GOLDENS = [
  { id: 'hidden-pair-en', record: '2026-09-26-bench-completion-hidden-pair', lang: 'en', implementer: '`route` (harness loop on `claude-code`/`{model}`), sealed, completion family' },
  { id: 'hidden-pair-zh', record: '2026-09-26-bench-completion-hidden-pair', lang: 'zh', implementer: '`route`（harness 循环，走 `claude-code`/`{model}`），密封，补全任务族' },
  { id: 't6-haiku-en', record: '2026-09-26-bench-completion-t6-haiku', lang: 'en', implementer: '`route` (harness loop on `claude-code`/`{model}`), sealed, completion family' },
  { id: 'e12-en', record: '2026-09-27-bench-e12-self-review-sonnet-t5t6', lang: 'en', implementer: '`route`, `sonnet` on one rung vs `sonnet` on one rung `+review` (a self-review turn before the validation), sealed' },
  { id: 'e12-zh', record: '2026-09-27-bench-e12-self-review-sonnet-t5t6', lang: 'zh', implementer: '`route`，`sonnet` 单级梯 对 `sonnet` 单级梯 `+review`（验证前的一个自审回合），密封' },
] as const

interface RunLine {
  attempt: number
  verdict: string
  results: { checkId: string; status: string }[]
}

interface MemberLine {
  sessionId: string
  programId: string
  key: string
  certified: boolean
  caps: unknown
  runs: RunLine[]
  directives: string[]
}

interface DriverResult {
  type: string
  report: {
    programId: string
    sessionId: string
    outcome?: string
    mergedRevision?: string
    goals: { key: string; status: string; revision?: string; tree?: string }[]
  }
  ledgers: { sessionId: string; events: { type: string; data: unknown }[]; signoffs: string[] }[]
  members: MemberLine[]
  denials: { sessionId: string; capability: string; displayPath: string }[]
  deliverable: string[]
}

const roots: string[] = []

afterAll(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/** The statuses one ledger recorded for one goal key, in log order. */
function statuses(events: { type: string; data: unknown }[], key: string): string[] {
  return events
    .filter(event => event.type === 'program/goal' && (event.data as ProgramGoalRecord).key === key)
    .map(event => (event.data as ProgramGoalRecord).status)
}

/** The member line of one goal key, which every key of a released program has. */
function memberOf(observed: DriverResult, key: string): MemberLine {
  const found = observed.members.find(member => member.programId === observed.report.programId && member.key === key)
  expect(found, `no member session for ${key}`).toBeDefined()
  return found as MemberLine
}

/** Every file of the seed, relative and sorted: the files no department may change. */
async function seedFiles(): Promise<string[]> {
  const entries = await readdir(seedDir, { recursive: true, withFileTypes: true })
  return entries
    .filter(entry => entry.isFile())
    .map(entry => relative(seedDir, join(entry.parentPath, entry.name)).split('\\').join('/'))
    .sort()
}

/** The committed rows of one record in one language, as `grep -F` on the seed README reads them. */
async function committedRows(record: string, lang: 'en' | 'zh'): Promise<string> {
  const readme = await readFile(join(seedDir, 'data', 'proving-ground', lang === 'zh' ? 'README.zh.md' : 'README.md'), 'utf8')
  return readme.split('\n').filter(line => line.startsWith(`| [${record}]`)).map(line => `${line}\n`).join('')
}

describe('a program that builds readme-rows through a real cordis.yml', () => {
  it('certifies the department over a committed tree and releases the tool that reproduces the committed rows', async () => {
    const sessions = await mkdtemp(join(tmpdir(), 'readme-rows-sessions-'))
    const repository = await mkdtemp(join(tmpdir(), 'readme-rows-repo-'))
    roots.push(sessions, repository)

    const { stdout, stderr } = await runLoaderSmoke({
      label: 'program-readme-rows',
      tempDirPrefix: 'program-readme-rows-e2e-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath],
      tsconfigPath: repoTsconfig,
      processTimeoutMs: PHASE_TIMEOUT_MS,
      env: { DSH_TEST_SESSION_ROOT: sessions, DSH_TEST_PROGRAM_REPO: repository },
    })
    expect(stderr).toBe('')
    const observed = JSON.parse(stdout.trimEnd().split('\n').at(-1) ?? '') as DriverResult
    expect(observed.type).toBe('result')

    expect(observed.report.outcome).toBe('released')
    expect(observed.report.goals.map(goal => [goal.key, goal.status])).toEqual([['readme-rows', 'merged']])

    const ledger = observed.ledgers.find(candidate => candidate.sessionId === observed.report.programId)
    expect(ledger, 'no ledger for the program').toBeDefined()
    const events = ledger?.events ?? []
    const opened = events[0]?.data as ProgramStart
    expect(events[0]?.type).toBe('program/start')
    expect(opened.specSha256).toBe(observed.report.programId.replace('program-', ''))
    expect(opened.baseRevision).toBe('base')
    // The spec is frozen before anything runs, and the route the department is
    // driven on is not part of it: the overlay's real run is this same goal
    // under the caps its composition states.
    expect(opened.implementer).toEqual({ kind: 'route' })
    expect(ledger?.signoffs).toEqual(['spec-freeze', 'release'])

    expect(statuses(events, 'readme-rows')).toEqual(['pending', 'running', 'certified', 'merged'])
    const integrations = events
      .filter(event => event.type === 'program/integration')
      .map(event => event.data as ProgramIntegrationRecord)
    expect(integrations.map(record => record.status)).toEqual(['running', 'certified'])
    const closing = events.at(-1)?.data as ProgramEnd
    expect(events.at(-1)?.type).toBe('program/end')
    expect(closing.outcome).toBe('released')

    // The department was certified over a commit of its own, the ledger records
    // the revision and the tree that certificate covers, and the merged head is
    // a different commit: the integration's merge of that branch.
    const [goal] = observed.report.goals
    expect(goal?.revision).toMatch(/^[0-9a-f]{40}$/)
    expect(goal?.tree).toMatch(/^[0-9a-f]{40}$/)
    expect(observed.report.mergedRevision).toMatch(/^[0-9a-f]{40}$/)
    expect(goal?.revision).not.toBe(observed.report.mergedRevision)

    // The department's one attempt was committed, measured and certified on
    // the test it wrote, the five goldens and the rule that it installed nothing.
    const department = memberOf(observed, 'readme-rows')
    expect(department.directives).toEqual([])
    expect(department.caps).toEqual({ maxTotalTokens: 2_000_000, maxWallMs: 1_500_000 })
    expect(department.runs.map(run => run.verdict)).toEqual(['passed'])
    expect(department.runs[0]?.results.map(result => [result.checkId, result.status])).toEqual([
      ['readme-rows-test', 'pass'],
      ...GOLDENS.map(golden => [`readme-rows-${golden.id}`, 'pass']),
      ['readme-rows-no-dependencies', 'pass'],
    ])
    expect(department.certified).toBe(true)
    expect(observed.members.filter(member => member.programId === observed.report.programId).map(member => member.key).sort())
      .toEqual(['@integration', 'readme-rows'])

    // The certified commit ends with the two trailer lines the objective requires.
    const message = execFileSync('git', ['log', '-1', '--format=%B', goal?.revision ?? ''], { cwd: repository, encoding: 'utf8' }).trimEnd()
    expect(message.split('\n').slice(-2)).toEqual(TRAILERS)

    // The committed rows are what release the program: the integration repeats
    // the test and the five goldens over the merged head, then the two gates.
    const integration = memberOf(observed, INTEGRATION_KEY)
    expect(integration.runs).toHaveLength(1)
    expect(integration.runs[0]?.results.map(result => [result.checkId, result.status])).toEqual([
      ['merged-test', 'pass'],
      ...GOLDENS.map(golden => [`merged-${golden.id}`, 'pass']),
      ['gate-1', 'pass'],
      ['gate-2', 'pass'],
    ])
    // The merged head passed on the merge alone, so the integration session was
    // never given a turn and refused no read; the denial it ran under is still
    // recorded on the closing record.
    expect(observed.denials).toEqual([])
    expect(integrations.at(-1)?.denied).toEqual([join(repository, observed.report.programId)])

    // The released tree is the seed plus exactly the tool and its test, with
    // every seed file — the records, the rows, `summarize-run.mjs`, the task —
    // unchanged.
    const seed = await seedFiles()
    expect(observed.deliverable).toEqual([...seed, TOOL, TEST].sort())
    for (const path of seed) {
      const merged = execFileSync('git', ['show', `${observed.report.mergedRevision}:${path}`], { cwd: repository })
      expect(merged.equals(await readFile(join(seedDir, path))), `${path} changed in the merged tree`).toBe(true)
    }

    // The tool the program delivered runs from the integration worktree the
    // release was certified on, and prints the committed rows of each golden.
    const cwd = join(repository, observed.report.programId, INTEGRATION_KEY)
    for (const golden of GOLDENS) {
      const printed = execFileSync(
        process.execPath,
        [TOOL, `data/proving-ground/${golden.record}`, '--lang', golden.lang, '--implementer', golden.implementer],
        { cwd, encoding: 'utf8' },
      )
      expect(printed, golden.id).toBe(await committedRows(golden.record, golden.lang))
    }
  }, PHASE_TIMEOUT_MS + LOADER_SMOKE_TEST_TIMEOUT_MS)
})
