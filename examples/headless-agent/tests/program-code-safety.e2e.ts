/**
 * Keyless REAL-composition coverage for a program that reviews code: one boot
 * of `fixtures/program-code-safety/cordis.yml` over a temporary report
 * repository, reading the fixture's committed `sample-target/`. Six security
 * departments each certify their own findings on their own branch, and the
 * integration merges them and certifies the merged report against the examiner
 * committed before any of them started.
 *
 * The scripted implementer reports the findings pinned in the fixture's
 * `code-safety-llm.ts`, reading each `snippet` out of the target at stream
 * time. What this proves is the workflow and the examiner — that the target
 * stays read-only, that every finding resolves at the line it cites, that a
 * finding which does not is refused, and that the committed examiner decides
 * the release — not what a model finds. The overlay under the fixture's
 * `overlays/` is the same program driven on the operator's Claude Code route,
 * which is what answers that question.
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

const fixtureDir = fileURLToPath(new URL('./fixtures/program-code-safety/', import.meta.url))
const binScript = join(fixtureDir, 'driver.ts')
const configPath = join(fixtureDir, 'cordis.yml')
const sampleTarget = join(fixtureDir, 'sample-target')
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** Six departments, an integration and seven examiner runs outrun the default window. */
const PHASE_TIMEOUT_MS = 300_000

/** The six departments of the program, in the order the spec declares them. */
const DEPARTMENTS = ['secrets', 'injection', 'access', 'data', 'dependencies', 'platform']

/** Every finding id the merged `findings.json` carries, sorted. */
const FINDING_IDS = [
  'access-admin-users-unauthenticated',
  'access-self-promotion',
  'data-cleartext-transport',
  'data-md5-password',
  'data-pii-in-logs',
  'dependencies-lodash-prototype-pollution',
  'dependencies-marked-redos',
  'injection-eval-request-body',
  'injection-mongo-where',
  'injection-sql-concatenation',
  'platform-insecure-session-cookie',
  'platform-stack-trace-to-client',
  'platform-wildcard-cors-with-credentials',
  'secrets-api-token',
  'secrets-database-password',
  'secrets-session-secret',
]

/** Findings per severity the merged report states, which the examiner cross-checks against the union. */
const SEVERITY_COUNTS: Record<string, number> = { critical: 5, high: 9, medium: 2, low: 0, info: 0 }

/** Base-commit files no department and no integration may change. */
const IMMUTABLE = ['REPORTING.md', 'verify-safety-report.mjs', 'target.json']

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

interface Finding {
  id: string
  cwe: string
  severity: string
  confidence: string
  file: string
  line: number
  snippet: string
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
  target: { root: string; files: number; sha256: string }
  elapsedSeconds: number
  ledgers: { sessionId: string; events: { type: string; data: unknown }[]; signoffs: string[] }[]
  members: MemberLine[]
  denials: { sessionId: string; capability: string; displayPath: string }[]
  deliverable: string[]
  safetyReport: string
  findings: string
  verifier: { exitCode: number; output: string }
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

/** Run the committed examiner in one worktree, returning its exit code and output. */
function examine(workspace: string, args: readonly string[]): { exitCode: number; output: string } {
  try {
    const output = execFileSync(process.execPath, ['verify-safety-report.mjs', ...args], { cwd: workspace, encoding: 'utf8', stdio: 'pipe' })
    return { exitCode: 0, output }
  } catch (error) {
    const failed = error as { status?: number; stdout?: string; stderr?: string }
    return { exitCode: failed.status ?? -1, output: `${failed.stdout ?? ''}${failed.stderr ?? ''}` }
  }
}

describe('a program that reviews code through a real cordis.yml', () => {
  it('certifies six departments over verified findings and releases one examined report', async () => {
    const sessions = await mkdtemp(join(tmpdir(), 'code-safety-sessions-'))
    const repository = await mkdtemp(join(tmpdir(), 'code-safety-repo-'))
    roots.push(sessions, repository)

    const { stdout, stderr } = await runLoaderSmoke({
      label: 'program-code-safety',
      tempDirPrefix: 'program-code-safety-e2e-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath],
      tsconfigPath: repoTsconfig,
      processTimeoutMs: PHASE_TIMEOUT_MS,
      env: {
        DSH_TEST_SESSION_ROOT: sessions,
        DSH_CODE_SAFETY_REPORT_REPO: repository,
        DSH_CODE_SAFETY_TARGET: sampleTarget,
      },
    })
    expect(stderr).toBe('')
    const observed = JSON.parse(stdout.trimEnd().split('\n').at(-1) ?? '') as DriverResult
    expect(observed.type).toBe('result')

    expect(observed.report.outcome).toBe('released')
    expect(observed.report.goals.map(goal => [goal.key, goal.status]))
      .toEqual(DEPARTMENTS.map(key => [key, 'merged']))

    const ledger = observed.ledgers.find(candidate => candidate.sessionId === observed.report.programId)
    expect(ledger, 'no ledger for the program').toBeDefined()
    const events = ledger?.events ?? []
    const opened = events[0]?.data as ProgramStart
    expect(events[0]?.type).toBe('program/start')
    expect(opened.specSha256).toBe(observed.report.programId.replace('program-', ''))
    expect(opened.baseRevision).toBe('base')
    // The spec is frozen before anything runs, and the route the departments
    // are driven on is not part of it: the overlay's real run is this same
    // program over a different target.
    expect(opened.implementer).toEqual({ kind: 'route' })
    expect(ledger?.signoffs).toEqual(['spec-freeze', 'release'])

    // No department depends on another: six analysts read one tree.
    for (const key of DEPARTMENTS) {
      expect(statuses(events, key), key).toEqual(['pending', 'running', 'certified', 'merged'])
    }
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
    expect(new Set(certified).size).toBe(DEPARTMENTS.length)
    expect(observed.report.goals.every(goal => /^[0-9a-f]{40}$/.test(goal.tree ?? ''))).toBe(true)
    expect(certified).not.toContain(observed.report.mergedRevision)

    // Each department runs under the caps the spec gave it and is certified on
    // exactly two checks: the examiner over its own findings, and the rule that
    // it wrote its own section of the report.
    for (const key of DEPARTMENTS) {
      const department = memberOf(observed, key)
      expect(department.certified, key).toBe(true)
      expect(department.caps).toEqual({ maxTotalTokens: 4_000_000, maxWallMs: 2_400_000 })
      expect(department.runs.at(-1)?.results.map(result => [result.checkId, result.status]))
        .toEqual([[`${key}-findings`, 'pass'], [`${key}-section`, 'pass']])
    }
    // The `platform` department leaves its first attempt uncommitted: the
    // program refuses to measure that worktree, names why, and certifies the
    // attempt that commits.
    expect(memberOf(observed, 'platform').directives)
      .toEqual(['the worktree carries work that no commit on this branch carries'])
    expect(observed.members.filter(member => member.programId === observed.report.programId).map(member => member.key).sort())
      .toEqual([INTEGRATION_KEY, ...DEPARTMENTS].sort())

    // The integration is handed no objective: its first attempt discovers that
    // the merge carries no report, and its second one writes it.
    const integration = memberOf(observed, INTEGRATION_KEY)
    expect(integration.runs.map(run => run.verdict)).toEqual(['failed', 'passed'])
    expect(integration.runs.at(-1)?.results.map(result => [result.checkId, result.status]))
      .toEqual([['safety-report', 'pass'], ['gate-1', 'pass'], ['gate-2', 'pass']])
    expect(observed.denials).toEqual([])
    expect(integrations.at(-1)?.denied).toEqual([join(repository, observed.report.programId)])

    // The committed examiner is what releases the program, and the driver ran
    // it once more over the released worktree.
    expect(observed.verifier.exitCode).toBe(0)
    expect(observed.verifier.output).toContain('SAFETY-REPORT.md and findings.json verified')

    // The union carries every department's findings, each resolving at the line
    // it cites in the tree the base commit locked.
    const findings = JSON.parse(observed.findings) as Finding[]
    expect(findings.map(finding => finding.id).sort()).toEqual(FINDING_IDS)
    expect(observed.target.files).toBe(8)
    for (const finding of findings) {
      const text = await readFile(join(sampleTarget, finding.file), 'utf8')
      expect(text.split('\n')[finding.line - 1], `${finding.id} cites ${finding.file}:${String(finding.line)}`)
        .toContain(finding.snippet.split('\n')[0]?.trim())
    }
    for (const [severity, count] of Object.entries(SEVERITY_COUNTS)) {
      expect(findings.filter(finding => finding.severity === severity), severity).toHaveLength(count)
      expect(observed.safetyReport).toContain(`- ${severity}: ${String(count)}`)
    }
    // The report says what it is and refuses the claim it cannot support.
    expect(observed.safetyReport).toContain('does not certify the absence of vulnerabilities')
    expect(observed.safetyReport).toContain(`Target tree: ${observed.target.sha256}`)
    expect(observed.safetyReport).not.toMatch(/\bno vulnerabilities\b|\bfree of vulnerabilities\b/)

    // The released tree is the base commit plus each department's two files and
    // the integration's two, with the examiner and the lock unchanged.
    expect(observed.deliverable).toEqual([
      'REPORTING.md',
      'SAFETY-REPORT.md',
      'findings.json',
      'findings/.gitkeep',
      ...DEPARTMENTS.map(key => `findings/${key}.json`).sort(),
      'report/.gitkeep',
      ...DEPARTMENTS.map(key => `report/${key}.md`).sort(),
      'target.json',
      'verify-safety-report.mjs',
    ])
    for (const path of IMMUTABLE) {
      const merged = execFileSync('git', ['show', `${observed.report.mergedRevision}:${path}`], { cwd: repository, encoding: 'utf8' })
      const seeded = path === 'target.json'
        ? await readFile(join(repository, path), 'utf8')
        : await readFile(join(fixtureDir, 'seed', path), 'utf8')
      expect(merged, path).toBe(seeded)
    }

    // The negative case: a finding whose line moved is refused by the same
    // committed examiner, over the same released worktree.
    const workspace = join(repository, observed.report.programId, INTEGRATION_KEY)
    const moved = { ...findings[0], id: 'moved-finding', line: (findings[0]?.line ?? 1) + 3, endLine: undefined }
    await writeFile(join(workspace, 'findings.json'), `${JSON.stringify([...findings, moved], null, 2)}\n`)
    const refused = examine(workspace, ['--report'])
    expect(refused.exitCode).toBe(1)
    expect(refused.output).toContain('moved-finding: snippet does not match')
    // And the examiner names it to the integration rather than only failing:
    // `--list-invalid` is how a dropped finding gets disclosed.
    expect(examine(workspace, ['--findings', 'findings.json', '--list-invalid']))
      .toEqual({ exitCode: 0, output: 'moved-finding\n' })
  }, PHASE_TIMEOUT_MS + LOADER_SMOKE_TEST_TIMEOUT_MS)
})
