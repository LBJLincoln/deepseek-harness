/**
 * Keyless REAL-composition coverage for a program that builds software: one
 * boot of `fixtures/program-csv-tools/cordis.yml` over a temporary git
 * repository seeded with the csv-tools specification, command line and test
 * suite. Three departments deliver the reader, `stats`, `filter` and `join` on
 * their own branches; the integration merges them and certifies the merged head
 * against the committed suite.
 *
 * The scripted implementer writes the modules committed under the fixture's
 * `scripted/`, so what this proves is the wiring — the spec freezes, the
 * departments are staffed and certified over committed trees, the branches
 * merge, and the committed verifier decides the release — not what a model can
 * build. The overlay under the fixture's `overlays/` is the same program driven
 * on the operator's Claude Code route, which is what answers that question.
 */

import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { INTEGRATION_KEY } from '@deepseek-ai/dsh-program'
import type { ProgramEnd, ProgramGoalRecord, ProgramIntegrationRecord, ProgramStart } from '@deepseek-ai/dsh-program'

const fixtureDir = fileURLToPath(new URL('./fixtures/program-csv-tools/', import.meta.url))
const binScript = join(fixtureDir, 'driver.ts')
const configPath = join(fixtureDir, 'cordis.yml')
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** Three departments, an integration and a full node:test suite outrun the default window. */
const PHASE_TIMEOUT_MS = 300_000

/** Every path the released tree carries, which is the seed plus the four delivered modules. */
const DELIVERABLE = [
  'SPEC.md',
  'bin/csv-tools.js',
  'package.json',
  'src/csv.js',
  'src/filter.js',
  'src/join.js',
  'src/stats.js',
  'test/cli.test.js',
  'test/csv.test.js',
  'test/filter.test.js',
  'test/join.test.js',
  'test/stats.test.js',
]

/** Seed files no department may change, checked byte for byte against the merged tree. */
const IMMUTABLE = ['SPEC.md', 'bin/csv-tools.js', 'test/cli.test.js']

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

describe('a program that builds csv-tools through a real cordis.yml', () => {
  it('certifies three departments over committed trees and releases the merged command line', async () => {
    const sessions = await mkdtemp(join(tmpdir(), 'csv-tools-sessions-'))
    const repository = await mkdtemp(join(tmpdir(), 'csv-tools-repo-'))
    roots.push(sessions, repository)

    const { stdout, stderr } = await runLoaderSmoke({
      label: 'program-csv-tools',
      tempDirPrefix: 'program-csv-tools-e2e-',
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
    expect(observed.report.goals.map(goal => [goal.key, goal.status]))
      .toEqual([['stats', 'merged'], ['filter', 'merged'], ['join', 'merged']])

    const ledger = observed.ledgers.find(candidate => candidate.sessionId === observed.report.programId)
    expect(ledger, 'no ledger for the program').toBeDefined()
    const events = ledger?.events ?? []
    const opened = events[0]?.data as ProgramStart
    expect(events[0]?.type).toBe('program/start')
    expect(opened.specSha256).toBe(observed.report.programId.replace('program-', ''))
    expect(opened.baseRevision).toBe('base')
    // The spec is frozen before anything runs, and the route the departments are
    // driven on is not part of it: the overlay's real run is this same program.
    expect(opened.implementer).toEqual({ kind: 'route' })
    expect(ledger?.signoffs).toEqual(['spec-freeze', 'release'])

    // `filter` and `join` depend on the department that owns the reader, so
    // neither starts before that one holds a certificate.
    expect(statuses(events, 'stats')).toEqual(['pending', 'running', 'certified', 'merged'])
    expect(statuses(events, 'filter')).toEqual(['pending', 'running', 'certified', 'merged'])
    expect(statuses(events, 'join')).toEqual(['pending', 'running', 'certified', 'merged'])
    const integrations = events
      .filter(event => event.type === 'program/integration')
      .map(event => event.data as ProgramIntegrationRecord)
    expect(integrations.map(record => record.status)).toEqual(['running', 'certified'])
    const closing = events.at(-1)?.data as ProgramEnd
    expect(events.at(-1)?.type).toBe('program/end')
    expect(closing.outcome).toBe('released')

    // Every department was certified over a commit of its own, and the ledger
    // records both the revision and the tree that certificate covers.
    const certified = observed.report.goals.map(goal => goal.revision)
    expect(certified.every(revision => /^[0-9a-f]{40}$/.test(revision ?? ''))).toBe(true)
    expect(new Set(certified).size).toBe(3)
    expect(observed.report.goals.every(goal => /^[0-9a-f]{40}$/.test(goal.tree ?? ''))).toBe(true)
    expect(certified).not.toContain(observed.report.mergedRevision)

    // The `join` department leaves its first attempt uncommitted: the program
    // refuses to measure that worktree, names why, and certifies the attempt
    // that commits.
    const joinDepartment = memberOf(observed, 'join')
    expect(joinDepartment.directives).toEqual(['the worktree carries work that no commit on this branch carries'])
    expect(joinDepartment.runs.map(run => run.verdict)).toEqual(['passed'])
    expect(joinDepartment.certified).toBe(true)

    // Each department runs under the caps the spec gave it and is certified on
    // exactly two checks: its own part of the committed suite, and the rule that
    // it installed nothing.
    for (const key of ['stats', 'filter', 'join']) {
      const department = memberOf(observed, key)
      expect(department.caps).toEqual({ maxTotalTokens: 2_000_000, maxWallMs: 1_500_000 })
      expect(department.runs.at(-1)?.results.map(result => [result.checkId, result.status]))
        .toEqual([[`${key}-suite`, 'pass'], [`${key}-no-dependencies`, 'pass']])
    }
    expect(observed.members.filter(member => member.programId === observed.report.programId).map(member => member.key).sort())
      .toEqual(['@integration', 'filter', 'join', 'stats'])

    // The committed verifier is what releases the program: the whole suite,
    // including the command line no department branch can satisfy, plus the two
    // gates the certificate carries.
    const integration = memberOf(observed, INTEGRATION_KEY)
    expect(integration.runs).toHaveLength(1)
    expect(integration.runs[0]?.results.map(result => [result.checkId, result.status]))
      .toEqual([['csv-tools-suite', 'pass'], ['gate-1', 'pass'], ['gate-2', 'pass']])
    // The merged head passed on the merge alone, so the integration session was
    // never given a turn and refused no read; the denial it ran under is still
    // recorded on the closing record.
    expect(observed.denials).toEqual([])
    expect(integrations.at(-1)?.denied).toEqual([join(repository, observed.report.programId)])

    // The released tree is the seed plus exactly the four modules the three
    // departments own, with every file the spec froze unchanged.
    expect(observed.deliverable).toEqual(DELIVERABLE)
    for (const path of IMMUTABLE) {
      const merged = execFileSync('git', ['show', `${observed.report.mergedRevision}:${path}`], { cwd: repository, encoding: 'utf8' })
      expect(merged).toBe(await readFile(join(fixtureDir, 'seed', path), 'utf8'))
    }

    // The command line the program delivered runs: one subcommand from each
    // department, from the integration worktree the release was certified on.
    const samples = await mkdtemp(join(tmpdir(), 'csv-tools-samples-'))
    roots.push(samples)
    const people = join(samples, 'people.csv')
    const cities = join(samples, 'cities.csv')
    await writeFile(people, 'name,age\nalice,30\nbob,9\n')
    await writeFile(cities, 'name,city\nbob,Lyon\nalice,Paris\n')
    const cli = (...args: string[]): string => execFileSync(
      process.execPath,
      [join(repository, observed.report.programId, INTEGRATION_KEY, 'bin', 'csv-tools.js'), ...args],
      { cwd: samples, encoding: 'utf8' },
    )
    expect(cli('stats', people)).toBe('column,count,min,max,mean\nage,2,9,30,19.5\n')
    expect(cli('filter', people, 'name', 'contains', 'o')).toBe('name,age\nbob,9\n')
    expect(cli('join', people, cities, 'name')).toBe('name,age,city\nalice,30,Paris\nbob,9,Lyon\n')
  }, PHASE_TIMEOUT_MS + LOADER_SMOKE_TEST_TIMEOUT_MS)
})
