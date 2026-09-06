#!/usr/bin/env node
/**
 * Test driver: create the temporary git repository the programs deliver into,
 * boot the delegating composition, and run two one-goal programs whose
 * departments are staffed through the subagent seam — one whose check the mock
 * route's child satisfies, one whose check nothing can — then print each
 * report, the delegation records each department session left, and the child
 * sessions those runs published.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-program'
import type { ProgramReport, ProgramSpec } from '@deepseek-ai/dsh-program'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-subagent'
import type { CheckId } from '@deepseek-ai/dsh-verification/types'

/** One department session as the e2e asserts on it. */
interface DepartmentLine {
  readonly sessionId: string
  /** Every `program/delegation` the department recorded, in log order. */
  readonly delegations: { readonly attempt: number; readonly provider: string; readonly runId: string; readonly stopReason: string }[]
  /** Whether the department's own log carries a certificate. */
  readonly certified: boolean
  /** Whether the department session itself ever took a model turn. */
  readonly requests: number
}

/** One child session a delegated run published, as the e2e asserts on it. */
interface ChildLine {
  readonly sessionId: string
  /** The delegating department session. */
  readonly parentSession: string | undefined
  /** The workspace the child worked in, which a provider derives from its parent. */
  readonly cwd: string | undefined
}

/** What one program of this fixture came to. */
interface ProgramLine {
  readonly report: ProgramReport
  readonly departments: DepartmentLine[]
  readonly children: ChildLine[]
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

/** Create the repository the programs deliver into, once, with a tagged base commit. */
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

/**
 * One delegating program of one goal.
 * @param label - what distinguishes this program's identity from the other's.
 * @param check - the shell command the department is certified against.
 * @returns the spec, staffed through the subagent seam.
 */
function programSpec(label: string, check: string): ProgramSpec {
  return {
    objective: `deliver the ${label} release`,
    baseRevision: 'base',
    implementer: { kind: 'subagent', provider: 'spawn', label: 'external implementer' },
    goals: [{
      key: 'api',
      objective: 'Deliver the api of this program on its own branch.',
      preset: 'implementing',
      isolation: 'none',
      budget: { maxTotalTokens: 400_000, maxWallMs: 300_000 },
      dependsOn: [],
      checks: [{ id: 'api-check' as CheckId, outcome: `the branch satisfies: ${check}`, run: check }],
    }],
    integration: {
      checks: [{ id: 'merged-base-present' as CheckId, outcome: 'the merged head carries the base file', run: 'test -f base.txt' }],
      gates: [],
    },
  }
}

/** Read back what one program's departments and their children left in the persistence root. */
async function readProgram(persistence: SessionPersistence, report: ProgramReport): Promise<ProgramLine> {
  const departments: DepartmentLine[] = []
  const children: ChildLine[] = []
  const departmentIds = new Set(report.goals.flatMap(goal => (goal.sessionId === undefined ? [] : [goal.sessionId as string])))
  for (const stored of await persistence.list()) {
    const { meta, events } = await persistence.inspect(stored.id)
    if (departmentIds.has(stored.id)) {
      departments.push({
        sessionId: stored.id,
        delegations: events.flatMap((event: SessionEvent) => (event.type === 'program/delegation'
          ? [{
            attempt: event.data.attempt,
            provider: event.data.provider,
            runId: event.data.runId,
            stopReason: event.data.stopReason,
          }]
          : [])),
        certified: events.some((event: SessionEvent) => event.type === 'verification/certificate'),
        requests: events.filter((event: SessionEvent) => event.type === 'request/header').length,
      })
      continue
    }
    if (meta.parentSession !== undefined && departmentIds.has(meta.parentSession)) {
      children.push({ sessionId: stored.id, parentSession: meta.parentSession, cwd: meta.cwd })
    }
  }
  return { report, departments, children }
}

// The repository has to exist before the program plugin validates its
// workspaceRoot, so it is minted before the composition loads.
ensureRepository(repository)

const ctx = await boot('program-external-implementer-e2e', resolveConfigPath(configPath, undefined))
try {
  // Loader siblings mount concurrently; the program mounts presets and reads
  // persisted sessions, so the driver drives only the settled application.
  await ctx.get('loader')?.await()
  const programs = ctx.get('programs')
  const persistence = ctx.get('sessionPersistence')
  if (programs === undefined || persistence === undefined) throw new Error('program driver requires the programs and session persistence services')

  const certifying = await programs.start(programSpec('certifying', 'test -f base.txt'))
  const failing = await programs.start(programSpec('failing', 'test -f absent.txt'))
  process.stdout.write(`${JSON.stringify({
    type: 'result',
    providers: ctx.get('subagents')?.list() ?? [],
    certifying: await readProgram(persistence, certifying),
    failing: await readProgram(persistence, failing),
  })}\n`)
} finally {
  await ctx.fiber.dispose()
}
