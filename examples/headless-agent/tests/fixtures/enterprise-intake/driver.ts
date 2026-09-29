#!/usr/bin/env node
/**
 * Driver of the intake program: read the plan `scripts/enterprise-intake.ts`
 * wrote, turn it into a program spec with one department per coordinator, run
 * the program over the clone the intake prepared without a human release gate
 * (no person signs an unattended intake; the wrapper records the spec freeze
 * and the release as the intake's own decisions), and print one result line:
 * the report, every member session's
 * spend and span, and the route limit that stopped the run, if one did.
 *
 * The same driver serves the keyless composition beside it and the Claude Code
 * overlay under `overlays/`; what differs is the route the departments are
 * driven on and the caps the composition's budget policy states.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { foldBudgetSpend } from '@deepseek-ai/dsh-budget-policy'
import { QUOTA_EXCEEDED_CODE } from '@deepseek-ai/dsh-llm'
import type { ProgramGoalBudget, ProgramReport, ProgramSpec } from '@deepseek-ai/dsh-program'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import type { CheckId } from '@deepseek-ai/dsh-verification/types'
import { ROUTE_LIMIT_BLOCK } from './route-wall.ts'

/** The plan `scripts/enterprise-intake.ts` writes; its field set changes only together with that script. */
interface IntakePlan {
  readonly objective: string
  readonly baseRevision: string
  readonly departments: readonly {
    readonly key: string
    readonly objective: string
    readonly checks: readonly { readonly id: string; readonly outcome: string; readonly run: string }[]
  }[]
  readonly gates: readonly string[]
}

/** One member session as the intake reads it. */
interface MemberLine {
  readonly sessionId: string
  readonly key: string
  readonly certified: boolean
  /** Billed input plus output tokens the session's log accounts for. */
  readonly tokens: number
  readonly startedAt: number | null
  readonly endedAt: number | null
  /** Each validation run's verdict, in log order. */
  readonly runs: readonly string[]
}

/** The first turn a route refused under `QUOTA`, which stopped the run. */
interface RouteLimitLine {
  readonly sessionId: string
  readonly provider: string
  readonly model: string
  readonly message: string
  readonly resetsAt?: number
}

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('intake driver requires a config path')

/**
 * Refuse to start without the clone the intake prepared, which the program,
 * composed with it as `workspaceRoot`, delivers into.
 */
function requirePreparedRepository(): void {
  const path = process.env['DSH_TEST_PROGRAM_REPO']
  if (path === undefined || !existsSync(join(path, '.git'))) {
    throw new Error('intake driver requires DSH_TEST_PROGRAM_REPO naming the clone the intake prepared')
  }
}

requirePreparedRepository()
const planPath = process.env['DSH_INTAKE_PLAN']
if (planPath === undefined) throw new Error('intake driver requires DSH_INTAKE_PLAN')
const planBytes = readFileSync(planPath)
const plan = JSON.parse(planBytes.toString('utf8')) as IntakePlan

// The roster's root has to be absolute, so the presets beside this file are exported by path.
process.env['DSH_TEST_PROGRAM_PRESETS'] = fileURLToPath(new URL('presets', import.meta.url))

// A host that configures git through `GIT_CONFIG_COUNT` hands every child a
// command-line config the shell seam cannot forward whole, and git then refuses
// every invocation. The program runs against the intake's own clone, so the
// whole set is dropped rather than half inherited.
for (const key of Object.keys(process.env)) {
  if (key.startsWith('GIT_CONFIG_')) Reflect.deleteProperty(process.env, key)
}

/**
 * The caps every department session runs under: the composition's own session
 * caps, read from its budget policy, so the overlay's patch of that row is what
 * sets a real run's token cap per department.
 * @param ctx - the booted application.
 * @returns the goal budget each department's `budget/caps` carries.
 */
function departmentBudget(ctx: Awaited<ReturnType<typeof boot>>): ProgramGoalBudget {
  const budgets = ctx.get('sessionBudgets')
  if (budgets === undefined) throw new Error('intake driver requires the session budget policy')
  const caps = new Map(budgets.configuredCaps())
  const maxTotalTokens = caps.get('maxTotalTokens')
  const maxWallMs = caps.get('maxWallMs')
  const maxCostEur = caps.get('maxCostEur')
  return {
    ...maxTotalTokens === undefined ? {} : { maxTotalTokens },
    ...maxWallMs === undefined ? {} : { maxWallMs },
    ...maxCostEur === undefined ? {} : { maxCostEur },
  }
}

/**
 * The intake program: one department per coordinator, each measured by its
 * admission check, and an integration gated on the merged tree being clean.
 * @param budget - the caps every department runs under.
 * @returns the spec, frozen and digested before anything runs.
 */
function programSpec(budget: ProgramGoalBudget): ProgramSpec {
  return {
    objective: plan.objective,
    baseRevision: plan.baseRevision,
    goals: plan.departments.map(department => ({
      key: department.key,
      objective: department.objective,
      preset: 'proposing',
      isolation: 'none',
      budget,
      dependsOn: [],
      checks: department.checks.map(check => ({ id: check.id as CheckId, outcome: check.outcome, run: check.run })),
    })),
    integration: { checks: [], gates: [...plan.gates] },
  }
}

/** The first turn of a session that ended in the seam's `QUOTA` failure. */
function quotaTurnEnd(events: readonly SessionEvent[]): SessionEvent<'turn/end'> | undefined {
  return events.find((event): event is SessionEvent<'turn/end'> =>
    event.type === 'turn/end' && event.data.reason.kind === 'error' && event.data.reason.error.code === QUOTA_EXCEEDED_CODE)
}

/**
 * Every member session of the program, and the route limit that stopped it.
 * @param persistence - the backend the composition mounted.
 * @param report - the report whose program the members belong to.
 * @param route - the route every department was created with.
 * @returns the member lines, the sessions the wall refused without a request, and the limit.
 */
async function readMembers(
  persistence: SessionPersistence,
  report: ProgramReport,
  route: { readonly provider: string; readonly model: string },
): Promise<{ members: MemberLine[]; walled: string[]; routeLimit?: RouteLimitLine }> {
  const members: MemberLine[] = []
  const walled: string[] = []
  let routeLimit: RouteLimitLine | undefined
  let limitAt = Number.POSITIVE_INFINITY
  for (const stored of await persistence.list()) {
    const { events } = await persistence.inspect(stored.id)
    const member = events.find((event): event is SessionEvent<'program/member'> => event.type === 'program/member')
    if (member === undefined || member.data.programId !== report.programId) continue
    const refused = quotaTurnEnd(events)
    if (refused !== undefined && refused.time < limitAt && refused.data.reason.kind === 'error') {
      limitAt = refused.time
      const { error } = refused.data.reason
      routeLimit = {
        sessionId: stored.id,
        provider: route.provider,
        model: route.model,
        message: error.message,
        ...error.providerRetryAfterMs === undefined ? {} : { resetsAt: refused.time + error.providerRetryAfterMs },
      }
    }
    const goal = report.goals.find(candidate => candidate.key === member.data.key)
    if (refused === undefined && goal?.status === 'blocked' && goal.reason === ROUTE_LIMIT_BLOCK) walled.push(stored.id)
    members.push({
      sessionId: stored.id,
      key: member.data.key,
      certified: events.some(event => event.type === 'verification/certificate'),
      tokens: foldBudgetSpend(events, {}).totalTokens,
      startedAt: events[0]?.time ?? null,
      endedAt: events.at(-1)?.time ?? null,
      runs: events.flatMap(event => (event.type === 'verification/run' ? [event.data.verdict] : [])),
    })
  }
  return { members, walled, ...routeLimit === undefined ? {} : { routeLimit } }
}

const ctx = await boot('enterprise-intake', resolveConfigPath(configPath, undefined))
try {
  // Loader siblings mount concurrently; the program mounts presets and reads
  // persisted sessions, so the driver drives only the settled application.
  await ctx.get('loader')?.await()
  const programs = ctx.get('programs')
  const persistence = ctx.get('sessionPersistence')
  const route = ctx.get('agentDefaultModel')?.currentSelection()
  if (programs === undefined || persistence === undefined || route === undefined) {
    throw new Error('intake driver requires the programs, session persistence and default-model services')
  }
  const spec = programSpec(departmentBudget(ctx))
  const report = await programs.start(spec)
  const observed = await readMembers(persistence, report, route)
  process.stdout.write(`${JSON.stringify({ type: 'result', report, ...observed })}\n`)
} finally {
  await ctx.fiber.dispose()
}
