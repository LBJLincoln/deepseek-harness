#!/usr/bin/env node
/**
 * Test driver: create the temporary git repository the program delivers into,
 * sign its spec freeze and release, boot the delegating composition, and run one
 * one-goal program whose department is delegated to the real external coding
 * agent. The goal asks for one file the department's own check then reads, so
 * what the certificate cites is the tree the external agent left in the
 * worktree. The report, the delegation records, and the department's own
 * certificate are printed for the test to assert on.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { programIdFor, programSpecDigest, resolveProgramSpec } from '@deepseek-ai/dsh-program'
import type { ProgramReport, ProgramSpec } from '@deepseek-ai/dsh-program'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-signoff'
import type {} from '@deepseek-ai/dsh-subagent'
import type { CheckId } from '@deepseek-ai/dsh-verification/types'

/** The artefact both of the program's signatures attest. */
const ARTEFACT = 'e'.repeat(64)

/** The file the department is asked for and certified on. */
const DELIVERABLE = 'hello.txt'

/** One department session as the e2e asserts on it. */
interface DepartmentLine {
  readonly sessionId: string
  readonly delegations: { readonly attempt: number; readonly provider: string; readonly stopReason: string }[]
  readonly certified: boolean
}

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('program driver requires a config path')

const repository = process.env.DSH_TEST_PROGRAM_REPO
if (repository === undefined) throw new Error('program driver requires DSH_TEST_PROGRAM_REPO')

// The roster's root has to be absolute and the smoke runs in an isolated
// temporary cwd, so the presets beside this file are exported by path.
process.env.DSH_TEST_PROGRAM_PRESETS = fileURLToPath(new URL('presets', import.meta.url))

// A host that configures git through `GIT_CONFIG_COUNT` hands every child a
// command-line config the shell seam cannot forward whole, and git then refuses
// every invocation. This fixture runs against its own repository, so it drops
// the whole set rather than inheriting half of it.
for (const name of Object.keys(process.env)) {
  if (name.startsWith('GIT_CONFIG_')) Reflect.deleteProperty(process.env, name)
}

/** Create the repository the program delivers into, once, with a tagged base commit. */
function ensureRepository(root: string): void {
  if (existsSync(join(root, '.git'))) return
  mkdirSync(root, { recursive: true })
  const git = (...args: string[]): void => void execFileSync('git', args, { cwd: root, stdio: 'pipe' })
  git('init', '-q', '.')
  git('config', 'user.email', 'program@example.test')
  git('config', 'user.name', 'program fixture')
  writeFileSync(join(root, 'base.txt'), 'base\n')
  git('add', 'base.txt')
  git('commit', '-qm', 'base')
  git('tag', 'base')
}

/** The program the fixture runs: one goal, delivered by the external coding agent. */
function programSpec(): ProgramSpec {
  return {
    objective: 'deliver a greeting file',
    baseRevision: 'base',
    signoff: { artefactSha256: ARTEFACT },
    implementer: { kind: 'subagent', provider: 'claude-code', label: 'external implementer' },
    goals: [{
      key: 'greeting',
      objective: `Add a \`${DELIVERABLE}\` containing \`hello\` at the root of this worktree, and nothing else.`,
      preset: 'implementing',
      isolation: 'none',
      budget: { maxTotalTokens: 400_000, maxWallMs: 600_000 },
      dependsOn: [],
      checks: [{
        id: 'greeting-present' as CheckId,
        outcome: `${DELIVERABLE} at the worktree root reads hello`,
        run: `grep -qx hello ${DELIVERABLE}`,
      }],
    }],
    integration: {
      checks: [{ id: 'merged-greeting-present' as CheckId, outcome: `the merged head carries ${DELIVERABLE}`, run: `grep -qx hello ${DELIVERABLE}` }],
      gates: [],
    },
  }
}

/**
 * Record the spec-freeze and release signatures on the program session, the way
 * a client district's signer would before the program starts.
 */
async function sign(ctx: Awaited<ReturnType<typeof boot>>, spec: ProgramSpec, cwd: string): Promise<void> {
  const sessionId = SessionId(programIdFor(programSpecDigest(resolveProgramSpec(spec))))
  const signoffs = ctx.get('signoffs')
  const agents = ctx.get('agents')
  if (signoffs === undefined || agents === undefined) throw new Error('program driver requires the signoffs and agents services')
  const model = ctx.get('agentDefaultModel')?.currentSelection()
  if (model === undefined) throw new Error('program driver requires the default-model service')
  const handle = await agents.create({
    sessionId,
    meta: { cwd },
    agentOptions: { provider: model.provider, model: model.model },
  })
  try {
    for (const transition of ['spec-freeze', 'release'] as const) {
      signoffs.record(handle.agent, {
        transition,
        principal: { kind: 'human', id: 'program-fixture', displayName: 'Program Fixture' },
        artefactSha256: ARTEFACT,
        evidence: [{ kind: 'spec', ref: 'the frozen program spec' }],
      })
    }
    await ctx.sessions.flush(handle.agent.session)
  } finally {
    await handle.dispose()
  }
}

/** What each department session of this program recorded about its delegated attempts. */
async function readDepartments(persistence: SessionPersistence, report: ProgramReport): Promise<DepartmentLine[]> {
  const departmentIds = new Set(report.goals.flatMap(goal => (goal.sessionId === undefined ? [] : [goal.sessionId as string])))
  const departments: DepartmentLine[] = []
  for (const stored of await persistence.list()) {
    if (!departmentIds.has(stored.id)) continue
    const { events } = await persistence.inspect(stored.id)
    departments.push({
      sessionId: stored.id,
      delegations: events.flatMap((event: SessionEvent) => (event.type === 'program/delegation'
        ? [{ attempt: event.data.attempt, provider: event.data.provider, stopReason: event.data.stopReason }]
        : [])),
      certified: events.some((event: SessionEvent) => event.type === 'verification/certificate'),
    })
  }
  return departments
}

// The repository has to exist before the program plugin validates its
// workspaceRoot, so it is minted before the composition loads.
ensureRepository(repository)

const ctx = await boot('program-claude-implementer-e2e', resolveConfigPath(configPath, undefined))
try {
  await ctx.get('loader')?.await()
  const programs = ctx.get('programs')
  const persistence = ctx.get('sessionPersistence')
  if (programs === undefined || persistence === undefined) throw new Error('program driver requires the programs and session persistence services')
  const spec = programSpec()
  await sign(ctx, spec, repository)
  const report = await programs.start(spec)
  process.stdout.write(`${JSON.stringify({
    type: 'result',
    providers: ctx.get('subagents')?.list() ?? [],
    report,
    departments: await readDepartments(persistence, report),
  })}\n`)
} finally {
  await ctx.fiber.dispose()
}
